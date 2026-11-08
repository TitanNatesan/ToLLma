"""Compaction spec-12 gap coverage: every verifiable backend behavior not
already asserted in test_compaction.py (no duplicates by design).

Deterministic injected fakes throughout (summarizer + adapters); no provider
HTTP. Serial, isolated DB (suite wipe between tests).
"""

import asyncio
import importlib.util
import inspect
import uuid
from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlalchemy.orm import sessionmaker

from tollms.api.conversations import compaction
from tollms.api.conversations import service as conv_service
from tollms.api.conversations.schemas import ConversationCreate
from tollms.api.conversations.service import (
    active_path,
    add_message,
    create_conversation,
)
from tollms.api.gateway import service as gateway_service
from tollms.api.gateway.schemas import ChatRequest
from tollms.core.exceptions import ConflictError, ValidationError
from tollms.models.message import Message, MessageStatus, Role
from tollms.services.gateway.adapters.base import ChatMessage

WINDOW = 2000  # shared small window: manual 20% = 400 tokens, auto 80% = 1600


@pytest.fixture(autouse=True)
def _reset_summarizer():
    compaction.reset_summarizer()
    yield
    compaction.reset_summarizer()


def _fake_summarizer(text="Canned summary of the covered history.", calls=None, fail=None, delay=0.0):
    async def _fn(adapter, instruction, transcript):
        if delay:
            await asyncio.sleep(delay)
        (calls if calls is not None else []).append((instruction, transcript))
        if fail is not None:
            raise fail
        return text

    return _fn


def _adapter_ns(record=None):
    ns = SimpleNamespace(supports_vision=False, chat_calls=record if record is not None else [])

    async def _chat(messages, tools=None, tool_choice=None):
        ns.chat_calls.append(messages)
        raise AssertionError("provider adapter must not be called during compaction tests")

    ns.chat = _chat
    return ns


def _user_id(client):
    return uuid.UUID(client.get("/auth/me").json()["id"])


def _owned(db, client, user_factory, provider_factory, model_factory, email="u@tollma.ai", **mkw):
    user_factory(email=email)
    provider = provider_factory()
    model = model_factory(provider["id"], **mkw)
    return _user_id(client), provider, model


def _conv(db, user_id, provider, model, title="Compact me"):
    return create_conversation(
        db,
        ConversationCreate(
            title=title,
            provider_id=uuid.UUID(provider["id"]),
            model_id=uuid.UUID(model["id"]),
        ),
        user_id,
    )


def _fill(db, conv_id, user_id, n_exchanges=3, size=620):
    for i in range(n_exchanges):
        add_message(db, conv_id, Role.USER, f"question {i} " + "q" * size, user_id=user_id)
        add_message(db, conv_id, Role.ASSISTANT, f"answer {i} " + "a" * size, user_id=user_id)


def _provider_model(db, provider, model):
    from tollms.models.provider import Provider
    from tollms.models.registered_model import AIModel

    return db.get(Provider, uuid.UUID(provider["id"])), db.get(AIModel, uuid.UUID(model["id"]))


# --- estimator: system/summary overhead counted per segment + framing --------

def test_estimator_counts_system_summary_and_per_message_overhead():
    base, base_n = compaction.estimate_assembled(
        system=None, summary_text=None, tail_contents=["x" * 100], pending_text=None)
    assert (base, base_n) == (100 // 4 + 8, 1)  # 33 tokens, 1 message

    with_system, n_sys = compaction.estimate_assembled(
        system="s" * 100, summary_text=None, tail_contents=["x" * 100], pending_text=None)
    assert (with_system, n_sys) == (200 // 4 + 16, 2)  # system body + its framing
    assert with_system - base == 100 // 4 + compaction.PER_MESSAGE_OVERHEAD_TOKENS

    with_summary, n_sum = compaction.estimate_assembled(
        system=None, summary_text="y" * 100, tail_contents=["x" * 100], pending_text=None)
    assert (with_summary, n_sum) == (200 // 4 + 16, 2)  # rendered summary counts too

    with_pending, n_pen = compaction.estimate_assembled(
        system=None, summary_text=None, tail_contents=["x" * 100], pending_text="p" * 100)
    assert (with_pending, n_pen) == (200 // 4 + 16, 2)  # pending sent exactly once

    multi, n_multi = compaction.estimate_assembled(
        system="s" * 100, summary_text="y" * 100,
        tail_contents=["a" * 100, "b" * 100], pending_text="p" * 100)
    assert n_multi == 5
    assert multi == 500 // 4 + 8 * 5

    empty, empty_n = compaction.estimate_assembled(
        system=None, summary_text=None, tail_contents=[], pending_text=None)
    assert (empty, empty_n) == (1, 0)  # floor, never zero/negative


def test_oversized_transcript_rejected_without_provider_send(
    db, client, user_factory, provider_factory, model_factory
):
    """Transcript bigger than the window 422s before any provider I/O: the
    summarizer input itself would not fit, so nothing is narrowed silently and
    nothing oversized is ever sent."""
    user_id, provider, model = _owned(db, client, user_factory, provider_factory, model_factory,
                                      context_window=WINDOW)
    conv = _conv(db, user_id, provider, model)
    _fill(db, conv.id, user_id, n_exchanges=1, size=100)
    p, m = _provider_model(db, provider, model)
    tail = [r for r in active_path(db, conv.id, user_id) if r.role != Role.SUMMARY]
    transcript = compaction.build_transcript(None, tail)
    full_input = compaction.SUMMARY_INSTRUCTION + "\n--- TRANSCRIPT ---\n" + transcript
    window = compaction.estimate_text_tokens(full_input) - 10
    assert window > 0
    record: list = []
    compaction.set_summarizer(_fake_summarizer())

    async def _main():
        await compaction.compact_conversation(
            db, conv_id=conv.id, user_id=user_id, trigger="auto",
            provider=p, model=m, adapter=_adapter_ns(record),
            window=window, min_ratio=None,
        )

    with pytest.raises(ValidationError, match="too large to summarize"):
        asyncio.run(_main())
    assert record == []  # adapter.chat never invoked
    assert not [r for r in conv_service.list_messages(db, conv.id, user_id) if r.role == Role.SUMMARY]


# --- ordering: summarizer before provider ------------------------------------

def test_run_chat_summarizer_runs_before_provider_request(
    db, client, user_factory, provider_factory, model_factory
):
    """Auto-compaction happens inline BEFORE the provider call: the event log
    proves the summary completed before the first provider byte."""
    import httpx

    user_factory()
    provider = provider_factory()
    model = model_factory(provider["id"], context_window=8000)
    conv = create_conversation(
        db, ConversationCreate(title="auto", provider_id=uuid.UUID(provider["id"]),
                               model_id=uuid.UUID(model["id"])), None)
    _fill(db, conv.id, None, n_exchanges=9, size=1500)
    events: list = []
    compaction.set_summarizer(_fake_summarizer())

    async def _summarize(adapter, instruction, transcript):
        events.append("summarize")
        return "Canned summary of the covered history."

    compaction.set_summarizer(_summarize)
    sse = (
        'data: {"choices": [{"delta": {"content": "Hello"}}]}\n\n'
        'data: {"choices": [{"delta": {}}], "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15}}\n\n'
        "data: [DONE]\n\n"
    )

    def handler(request: httpx.Request) -> httpx.Response:
        events.append("provider")
        assert request.url.path == "/chat/completions"
        return httpx.Response(200, content=sse.encode(), headers={"content-type": "text/event-stream"})

    req = ChatRequest(provider_id=uuid.UUID(provider["id"]), model_id=uuid.UUID(model["id"]),
                      conversation_id=conv.id, message="continue please")
    result = asyncio.run(gateway_service.run_chat(db, req, httpx.MockTransport(handler), None))
    assert result.content == "Hello"
    assert events == ["summarize", "provider"]
    summaries = [r for r in conv_service.list_messages(db, conv.id, None) if r.role == Role.SUMMARY]
    assert len(summaries) == 1


# --- no duplication: covered ids absent from assembled context ---------------

def test_assembled_context_excludes_covered_content(
    db, client, user_factory, provider_factory, model_factory
):
    user_id, provider, model = _owned(db, client, user_factory, provider_factory, model_factory,
                                      context_window=WINDOW)
    conv = _conv(db, user_id, provider, model)
    _fill(db, conv.id, user_id)
    p, m = _provider_model(db, provider, model)
    before = conv_service.list_messages(db, conv.id, user_id)
    compaction.set_summarizer(_fake_summarizer())
    assert client.post(f"/api/v1/conversations/{conv.id}/compact").status_code == 200

    db.expire_all()
    rows = active_path(db, conv.id, user_id)
    latest, covered, tail = compaction.latest_applicable_summary(rows)
    assert latest is not None and tail == []
    assert {r.id for r in covered} == {r.id for r in before}
    history, history_text = compaction.assemble_context(
        db, system=None, stored_rows=rows, latest_summary=latest, tail_rows=tail,
        pending=None, trigger="manual", user_id=user_id, model=m, adapter=_adapter_ns(),
    )
    assert history_text.count("Canned summary") == 1
    assert "question 0" not in history_text  # covered raw content never re-sent
    assert "answer 2" not in history_text
    assert [msg.role for msg in history] == ["system"]  # summary-as-system only
    comp = (latest.metadata_ or {}).get("compaction") or {}
    assert set(comp["covered_message_ids"]) == {str(r.id) for r in before}


# --- model switch: estimate recalculated per selected window -----------------

def test_model_switch_recalc_small_compacts_large_skips(
    db, client, user_factory, provider_factory, model_factory
):
    user_id, provider, small = _owned(db, client, user_factory, provider_factory, model_factory,
                                      context_window=WINDOW, email="s@tollma.ai")
    big = model_factory(provider["id"], model_id="mock-big", name="Big", context_window=128000)
    conv = _conv(db, user_id, provider, small)
    add_message(db, conv.id, Role.USER, "a" * 5600, user_id=user_id)
    from tollms.models.provider import Provider
    from tollms.models.registered_model import AIModel

    p = db.get(Provider, uuid.UUID(provider["id"]))
    m_small = db.get(AIModel, uuid.UUID(small["id"]))
    m_big = db.get(AIModel, uuid.UUID(big["id"]))
    compaction.set_summarizer(_fake_summarizer())

    async def _main():
        first = await compaction.ensure_budget(
            db, conv_id=conv.id, user_id=user_id, provider=p, model=m_small,
            adapter=_adapter_ns(), pending=ChatMessage(role="user", content="b" * 736),
        )
        second = await compaction.ensure_budget(
            db, conv_id=conv.id, user_id=user_id, provider=p, model=m_big,
            adapter=_adapter_ns(), pending=ChatMessage(role="user", content="next"),
        )
        return first, second

    first, second = asyncio.run(_main())
    assert first.compaction is not None and first.compaction.trigger == "auto"
    # Same history under a large window: no new compact, old summary still
    # substituted as the system base with the pending message exactly once.
    assert second.compaction is None
    assert [msg.role for msg in second.history] == ["system", "user"]
    assert "Canned summary" in second.history[0].content
    assert second.history[1].content == "next"
    db.expire_all()
    assert len([r for r in conv_service.list_messages(db, conv.id, user_id)
                if r.role == Role.SUMMARY]) == 1


def test_manual_compact_allowed_on_large_window_when_threshold_met(
    db, client, user_factory, provider_factory, model_factory
):
    user_id, provider, model = _owned(db, client, user_factory, provider_factory, model_factory,
                                      context_window=128000, email="l@tollma.ai")
    conv = _conv(db, user_id, provider, model)
    add_message(db, conv.id, Role.USER, "x" * 100000, user_id=user_id)
    add_message(db, conv.id, Role.ASSISTANT, "y" * 20000, user_id=user_id)
    compaction.set_summarizer(_fake_summarizer())

    r = client.post(f"/api/v1/conversations/{conv.id}/compact")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["trigger"] == "manual" and body["context_window"] == 128000
    assert body["usage_before"] >= 0.20


# --- regeneration / edit across the compaction boundary ----------------------

def test_regeneration_context_across_compaction_boundary(
    db, client, user_factory, provider_factory, model_factory
):
    """The regenerate/edit driver resolves its prompt chain off the active
    path; ensure_budget over that explicit chain still substitutes the latest
    summary once and never re-sends covered history."""
    user_id, provider, model = _owned(db, client, user_factory, provider_factory, model_factory,
                                      context_window=WINDOW, email="r@tollma.ai")
    conv = _conv(db, user_id, provider, model)
    _fill(db, conv.id, user_id)
    p, m = _provider_model(db, provider, model)
    compaction.set_summarizer(_fake_summarizer())
    assert client.post(f"/api/v1/conversations/{conv.id}/compact").status_code == 200
    db.expire_all()

    follow_q = add_message(db, conv.id, Role.USER, "second round " + "q" * 600, user_id=user_id)
    follow_a = add_message(db, conv.id, Role.ASSISTANT, "second answer " + "a" * 600,
                           user_id=user_id)
    assert follow_a.parent_message_id == follow_q.id
    chain = compaction.chain_rows_through(db, follow_a, user_id)
    assert chain[-1].id == follow_a.id

    async def _main():
        return await compaction.ensure_budget(
            db, conv_id=conv.id, user_id=user_id, provider=p, model=m,
            adapter=_adapter_ns(), stored_rows=chain,
        )

    ensured = asyncio.run(_main())
    assert ensured.compaction is None  # well under 80%: substitution only
    assert ensured.history[0].role == "system"
    assert "Canned summary" in ensured.history[0].content
    assert ensured.history_text.count("Canned summary") == 1
    assert "question 0" not in ensured.history_text  # pre-boundary content stays covered
    assert "second round" in ensured.history_text  # post-boundary tail intact
    assert not any(getattr(msg, "role", "") == "summary" for msg in ensured.history)


# --- multi-root + failed/cancelled nodes ---------------------------------------

def test_multi_root_and_terminal_nodes_compact_active_branch_only(
    db, client, user_factory, provider_factory, model_factory
):
    user_id, provider, model = _owned(db, client, user_factory, provider_factory, model_factory,
                                      context_window=WINDOW, email="m@tollma.ai")
    conv = _conv(db, user_id, provider, model)
    r1u = add_message(db, conv.id, Role.USER, "root one question " + "q" * 800, user_id=user_id)
    r1a = add_message(db, conv.id, Role.ASSISTANT, "root one answer " + "a" * 800, user_id=user_id)
    r2u = add_message(db, conv.id, Role.USER, "root two " + "d" * 100,
                      user_id=user_id, parent_message_id=None, use_active_leaf=False)
    assert r2u.parent_message_id is None  # second root, off the active branch
    r2f = add_message(db, conv.id, Role.ASSISTANT, "boom", user_id=user_id,
                      status=MessageStatus.FAILED)
    assert r2f.parent_message_id == r2u.id
    r2c = add_message(db, conv.id, Role.ASSISTANT, "cancelled work", user_id=user_id,
                      parent_message_id=r2u.id, use_active_leaf=False, status=MessageStatus.CANCELLED)
    conv_service.select_message(db, conv.id, r1a.id, user_id)
    assert [r.id for r in active_path(db, conv.id, user_id)] == [r1u.id, r1a.id]
    compaction.set_summarizer(_fake_summarizer())

    r = client.post(f"/api/v1/conversations/{conv.id}/compact")
    assert r.status_code == 200, r.text
    db.expire_all()
    summary = db.get(Message, uuid.UUID(r.json()["summary_message_id"]))
    comp = (summary.metadata_ or {}).get("compaction") or {}
    assert set(comp["covered_message_ids"]) == {str(r1u.id), str(r1a.id)}
    assert summary.parent_message_id == r1a.id
    # Failed/cancelled nodes on the other root are untouched and reselectable.
    live = conv_service.list_messages(db, conv.id, user_id)
    by_id = {m.id: m for m in live}
    assert by_id[r2f.id].status == MessageStatus.FAILED
    assert by_id[r2c.id].status == MessageStatus.CANCELLED
    path = client.get(f"/api/v1/conversations/{conv.id}/path").json()
    assert path["active_leaf_id"] == str(summary.id)
    conv_service.select_message(db, conv.id, r2f.id, user_id)
    other = [m["role"] for m in client.get(f"/api/v1/conversations/{conv.id}/path").json()["path"]]
    assert "summary" not in other  # sibling branch never inherits the summary


# --- concurrency: send-during-compact + auto-vs-manual race -------------------

def test_send_during_compact_returns_uncompacted_context(
    db, client, user_factory, provider_factory, model_factory
):
    """A running generation masks auto-compaction (its 409 path owns the
    conversation): the send proceeds on raw history, nothing is summarized."""
    user_id, provider, model = _owned(db, client, user_factory, provider_factory, model_factory,
                                      context_window=WINDOW, email="g@tollma.ai")
    conv = _conv(db, user_id, provider, model)
    add_message(db, conv.id, Role.USER, "a" * 5600, user_id=user_id)
    add_message(db, conv.id, Role.ASSISTANT, "", user_id=user_id, status=MessageStatus.RUNNING)
    p, m = _provider_model(db, provider, model)
    compaction.set_summarizer(_fake_summarizer())

    async def _main():
        return await compaction.ensure_budget(
            db, conv_id=conv.id, user_id=user_id, provider=p, model=m,
            adapter=_adapter_ns(), pending=ChatMessage(role="user", content="b" * 736),
        )

    ensured = asyncio.run(_main())
    assert ensured.compaction is None
    assert not any(getattr(msg, "role", "") == "system" for msg in ensured.history)
    assert not [r for r in conv_service.list_messages(db, conv.id, user_id) if r.role == Role.SUMMARY]


def test_auto_vs_manual_race_compacts_exactly_once(
    db, client, user_factory, provider_factory, model_factory
):
    user_id, provider, model = _owned(db, client, user_factory, provider_factory, model_factory,
                                      context_window=WINDOW, email="c@tollma.ai")
    conv = _conv(db, user_id, provider, model)
    add_message(db, conv.id, Role.USER, "a" * 5600, user_id=user_id)
    p, m = _provider_model(db, provider, model)
    compaction.set_summarizer(_fake_summarizer(delay=0.05))
    maker = sessionmaker(bind=db.get_bind())
    outcomes: dict = {}

    async def _main():
        async def _manual(session):
            try:
                result = await compaction.compact_request(session, conv.id, user_id)
                outcomes["manual"] = ("ok", result.summary_message_id)
            except ConflictError as exc:
                session.rollback()
                outcomes["manual"] = ("conflict", str(exc))
            finally:
                session.close()

        async def _auto(session):
            try:
                ensured = await compaction.ensure_budget(
                    session, conv_id=conv.id, user_id=user_id, provider=p, model=m,
                    adapter=_adapter_ns(), pending=ChatMessage(role="user", content="b" * 736),
                )
                outcomes["auto"] = ("compacted" if ensured.compaction is not None else "skipped",
                                    ensured.compaction)
            except ConflictError as exc:
                session.rollback()
                outcomes["auto"] = ("conflict", str(exc))
            finally:
                session.close()

        await asyncio.gather(_manual(maker()), _auto(maker()))

    asyncio.run(_main())
    assert sorted(outcomes) == ["auto", "manual"]
    db.expire_all()
    assert len([r for r in conv_service.list_messages(db, conv.id, user_id)
                if r.role == Role.SUMMARY]) == 1
    manual_ok = outcomes["manual"][0] == "ok"
    auto_compacted = outcomes["auto"][0] == "compacted"
    assert manual_ok != auto_compacted  # exactly one path performed the compact


# --- migration: enum label upgrade path + documented no-op downgrade ----------

def test_migration_summary_role_upgrade_downgrade_contract():
    path = Path(__file__).resolve().parents[1] / "alembic" / "versions" / "c41d7e2a9b03_message_summary_role.py"
    assert path.exists(), str(path)
    spec = importlib.util.spec_from_file_location("summary_role_migration", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    assert module.revision == "c41d7e2a9b03"
    assert module.down_revision == "38aa765cebc8"
    source = inspect.getsource(module.upgrade)
    assert "autocommit_block" in source  # ALTER TYPE cannot run in a transaction
    assert "ADD VALUE IF NOT EXISTS 'SUMMARY'" in source
    assert module.downgrade() is None  # documented no-op: enum labels cannot drop
    assert Role.SUMMARY.value == "summary"
