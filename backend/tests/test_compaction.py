"""Model-aware progressive compaction: manual endpoint + gateway auto-path.

Deterministic injected fakes throughout (summarizer + adapters); no provider
HTTP. Serial, isolated DB (suite wipe between tests).
"""

import asyncio
import base64
import uuid
from types import SimpleNamespace

import pytest
from sqlalchemy.orm import Session, sessionmaker

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
from tollms.models.attachment import Attachment
from tollms.models.message import Message, MessageStatus, Role
from tollms.services import generation as generation_engine
from tollms.services.gateway import attachments as attachment_engine
from tollms.services.gateway.adapters.base import ChatMessage, MediaPart

WINDOW = 2000  # shared window: manual 20% = 400 tokens, auto 80% = 1600


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


# --- window resolution ------------------------------------------------------


def test_window_resolution_prefers_registered_model(db, client, user_factory, provider_factory, model_factory, monkeypatch):
    _, provider, model = _owned(db, client, user_factory, provider_factory, model_factory, context_window=8000)

    def _boom(*a, **k):
        raise AssertionError("repository must not be consulted when the model declares a window")

    monkeypatch.setattr(compaction, "find_for_model", _boom)
    p, m = _provider_model(db, provider, model)
    assert compaction.resolve_context_window(db, p, m) == 8000


def test_window_resolution_repository_fallback(db, client, user_factory, provider_factory, model_factory, monkeypatch):
    _, provider, model = _owned(db, client, user_factory, provider_factory, model_factory)
    monkeypatch.setattr(compaction, "find_for_model", lambda *a, **k: SimpleNamespace(context_window=64000))
    p, m = _provider_model(db, provider, model)
    assert m.context_window is None
    assert compaction.resolve_context_window(db, p, m) == 64000


def test_window_resolution_missing_and_invalid(db, client, user_factory, provider_factory, model_factory, monkeypatch):
    _, provider, model = _owned(db, client, user_factory, provider_factory, model_factory)
    monkeypatch.setattr(compaction, "find_for_model", lambda *a, **k: None)
    p, m = _provider_model(db, provider, model)
    assert compaction.resolve_context_window(db, p, m) is None
    for bad in (0, -5):
        m.context_window = bad
        assert compaction.resolve_context_window(db, p, m) is None
    # Invalid model value falls through to a valid repository value.
    monkeypatch.setattr(compaction, "find_for_model", lambda *a, **k: SimpleNamespace(context_window=32000))
    m.context_window = -1
    assert compaction.resolve_context_window(db, p, m) == 32000
    monkeypatch.setattr(compaction, "find_for_model", lambda *a, **k: SimpleNamespace(context_window=0))
    m.context_window = None
    assert compaction.resolve_context_window(db, p, m) is None


def test_threshold_constants_documented():
    assert compaction.AUTO_COMPACT_RATIO == 0.80
    assert compaction.MANUAL_COMPACT_MIN_RATIO == 0.20


def test_estimator_marks_threshold_edges():
    # window 2000: manual edge 400 tokens, auto edge 1600 tokens.
    at_manual, _ = compaction.estimate_assembled(system=None, summary_text=None, tail_contents=["x" * 1568], pending_text=None)
    assert at_manual == 400  # 1568//4 + 8
    below_manual, _ = compaction.estimate_assembled(system=None, summary_text=None, tail_contents=["x" * 1567], pending_text=None)
    assert below_manual == 399
    at_auto, _ = compaction.estimate_assembled(
        system=None, summary_text=None, tail_contents=["a" * 5600], pending_text="b" * 736)
    assert at_auto == 1600  # 1400 + 184 + 16
    below_auto, _ = compaction.estimate_assembled(
        system=None, summary_text=None, tail_contents=["a" * 5600], pending_text="b" * 732)
    assert below_auto == 1599


# --- manual endpoint --------------------------------------------------------


def test_manual_below_threshold_422(db, client, user_factory, provider_factory, model_factory):
    user_id, provider, model = _owned(db, client, user_factory, provider_factory, model_factory, context_window=WINDOW)
    conv = _conv(db, user_id, provider, model)
    add_message(db, conv.id, Role.USER, "hi", user_id=user_id)
    add_message(db, conv.id, Role.ASSISTANT, "hello", user_id=user_id)
    compaction.set_summarizer(_fake_summarizer())

    r = client.post(f"/api/v1/conversations/{conv.id}/compact")
    assert r.status_code == 422, r.text
    assert "minimum 20%" in r.json()["error"]["message"]


def test_manual_success_shape_and_tree_semantics(db, client, user_factory, provider_factory, model_factory):
    user_id, provider, model = _owned(db, client, user_factory, provider_factory, model_factory, context_window=WINDOW)
    conv = _conv(db, user_id, provider, model)
    _fill(db, conv.id, user_id)
    before_rows = conv_service.list_messages(db, conv.id, user_id)
    before_text = [m.content for m in before_rows]
    compaction.set_summarizer(_fake_summarizer())

    r = client.post(f"/api/v1/conversations/{conv.id}/compact")
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body) == {
        "status", "summary_message_id", "tokens_before", "tokens_after",
        "context_window", "usage_before", "usage_after",
        "coverage_through_message_id", "trigger",
    }, body
    assert body["status"] == "completed"
    assert body["trigger"] == "manual"
    assert body["context_window"] == WINDOW
    assert body["usage_before"] >= 0.20
    assert body["tokens_after"] < body["tokens_before"]

    db.expire_all()
    summary = db.get(Message, uuid.UUID(body["summary_message_id"]))
    assert summary is not None and summary.role == Role.SUMMARY
    assert summary.status == MessageStatus.COMPLETED
    assert summary.parent_message_id == uuid.UUID(body["coverage_through_message_id"])
    assert summary.parent_message_id == before_rows[-1].id
    assert summary.version_number == before_rows[-1].version_number + 1 or summary.version_number >= 1
    # Leaf advances to the summary; originals untouched.
    assert db.get(conv_service.Conversation, conv.id).active_leaf_message_id == summary.id
    assert [m.content for m in conv_service.list_messages(db, conv.id, user_id)[: len(before_rows)]] == before_text
    # Token internals live in metadata only — aggregates never double-count.
    assert summary.prompt_tokens is None and summary.total_cost is None
    comp = (summary.metadata_ or {}).get("compaction") or {}
    assert comp["trigger"] == "manual"
    assert comp["prev_summary_id"] is None
    assert comp["context_window"] == WINDOW
    assert comp["covered_through_message_id"] == str(before_rows[-1].id)
    assert set(comp["covered_message_ids"]) == {str(m.id) for m in before_rows}
    # Visible in history + branch navigation with a distinct type.
    path = client.get(f"/api/v1/conversations/{conv.id}/path").json()
    assert path["path"][-1]["role"] == "summary"
    assert path["active_leaf_id"] == str(summary.id)
    tree = client.get(f"/api/v1/conversations/{conv.id}/tree").json()
    node = next(n for n in tree["nodes"] if n["id"] == str(summary.id))
    assert node["role"] == "summary" and node["parent_message_id"] == str(before_rows[-1].id)


def test_manual_unknown_window_422(db, client, user_factory, provider_factory, model_factory):
    user_id, provider, model = _owned(db, client, user_factory, provider_factory, model_factory)
    conv = _conv(db, user_id, provider, model)
    _fill(db, conv.id, user_id)
    compaction.set_summarizer(_fake_summarizer())
    r = client.post(f"/api/v1/conversations/{conv.id}/compact")
    assert r.status_code == 422, r.text
    assert "context-window" in r.json()["error"]["message"]


def test_manual_unknown_and_foreign_404(db, client, user_factory, provider_factory, model_factory):
    user_factory(email="owner@tollma.ai")
    provider_factory()
    assert client.post(f"/api/v1/conversations/{uuid.uuid4()}/compact").status_code == 404
    from tollms.api.conversations.schemas import ConversationCreate as CC

    # Unscoped conversation: the authed caller is not its owner -> 404 oracle.
    other = create_conversation(db, CC(title="other"), None)
    assert client.post(f"/api/v1/conversations/{other.id}/compact").status_code == 404


def test_manual_active_generation_409(db, client, user_factory, provider_factory, model_factory):
    user_id, provider, model = _owned(db, client, user_factory, provider_factory, model_factory, context_window=WINDOW)
    conv = _conv(db, user_id, provider, model)
    _fill(db, conv.id, user_id)
    add_message(db, conv.id, Role.ASSISTANT, "", user_id=user_id, status=MessageStatus.RUNNING)
    compaction.set_summarizer(_fake_summarizer())
    r = client.post(f"/api/v1/conversations/{conv.id}/compact")
    assert r.status_code == 409, r.text


def test_manual_second_compact_no_new_coverage_409(db, client, user_factory, provider_factory, model_factory):
    user_id, provider, model = _owned(db, client, user_factory, provider_factory, model_factory, context_window=WINDOW)
    conv = _conv(db, user_id, provider, model)
    _fill(db, conv.id, user_id)
    compaction.set_summarizer(_fake_summarizer())
    assert client.post(f"/api/v1/conversations/{conv.id}/compact").status_code == 200
    r = client.post(f"/api/v1/conversations/{conv.id}/compact")
    assert r.status_code == 409, r.text
    assert "already compacted" in r.json()["error"]["message"]


def test_manual_summarizer_failure_preserves_history(db, client, user_factory, provider_factory, model_factory):
    user_id, provider, model = _owned(db, client, user_factory, provider_factory, model_factory, context_window=WINDOW)
    conv = _conv(db, user_id, provider, model)
    _fill(db, conv.id, user_id)
    before = len(conv_service.list_messages(db, conv.id, user_id))
    compaction.set_summarizer(_fake_summarizer(fail=RuntimeError("provider down")))
    r = client.post(f"/api/v1/conversations/{conv.id}/compact")
    assert r.status_code == 422, r.text
    assert len(conv_service.list_messages(db, conv.id, user_id)) == before


# --- auto path: ensure_budget ------------------------------------------------


def _auto_setup(db, client, user_factory, provider_factory, model_factory, **mkw):
    user_id, provider, model = _owned(db, client, user_factory, provider_factory, model_factory, **mkw)
    conv = _conv(db, user_id, provider, model)
    p, m = _provider_model(db, provider, model)
    return user_id, conv, p, m


def test_auto_below_threshold_no_compact(db, client, user_factory, provider_factory, model_factory):
    user_id, conv, p, m = _auto_setup(db, client, user_factory, provider_factory, model_factory, context_window=WINDOW)
    add_message(db, conv.id, Role.USER, "short question", user_id=user_id)
    rows = active_path(db, conv.id, user_id)
    compaction.set_summarizer(_fake_summarizer())

    async def _main():
        return await compaction.ensure_budget(
            db, conv_id=conv.id, user_id=user_id, provider=p, model=m,
            adapter=_adapter_ns(), pending=ChatMessage(role="user", content="follow-up"),
        )

    ensured = asyncio.run(_main())
    assert ensured.compaction is None
    assert [msg.role for msg in ensured.history] == ["user", "user"]
    assert ensured.history[-1].content == "follow-up"
    assert not [m for m in conv_service.list_messages(db, conv.id, user_id) if m.role == Role.SUMMARY]


def test_auto_at_threshold_compacts_once_with_pending_once(
    db, client, user_factory, provider_factory, model_factory
):
    user_id, conv, p, m = _auto_setup(db, client, user_factory, provider_factory, model_factory, context_window=WINDOW)
    add_message(db, conv.id, Role.USER, "a" * 5600, user_id=user_id)
    pending = ChatMessage(role="user", content="b" * 736)  # 1400 + 184 + 16 = 1600 = 80%
    compaction.set_summarizer(_fake_summarizer())

    async def _main():
        return await compaction.ensure_budget(
            db, conv_id=conv.id, user_id=user_id, provider=p, model=m,
            adapter=_adapter_ns(), pending=pending,
        )

    ensured = asyncio.run(_main())
    assert ensured.compaction is not None
    assert ensured.compaction.trigger == "auto"
    roles = [msg.role for msg in ensured.history]
    assert roles == ["system", "user"], roles  # summary-as-system + pending, each once
    assert ensured.history[0].content.startswith("Earlier conversation summary")
    assert "Canned summary" in ensured.history[0].content
    assert ensured.history[1].content == "b" * 736
    assert ensured.history_text.count("Canned summary") == 1
    assert ensured.history_text.count("b" * 736) == 1
    summaries = [m for m in conv_service.list_messages(db, conv.id, user_id) if m.role == Role.SUMMARY]
    assert len(summaries) == 1


def test_auto_just_below_threshold_skips(db, client, user_factory, provider_factory, model_factory):
    user_id, conv, p, m = _auto_setup(db, client, user_factory, provider_factory, model_factory, context_window=WINDOW)
    add_message(db, conv.id, Role.USER, "a" * 5600, user_id=user_id)
    pending = ChatMessage(role="user", content="b" * 732)  # 1599 < 1600
    compaction.set_summarizer(_fake_summarizer())

    async def _main():
        return await compaction.ensure_budget(
            db, conv_id=conv.id, user_id=user_id, provider=p, model=m,
            adapter=_adapter_ns(), pending=pending,
        )

    ensured = asyncio.run(_main())
    assert ensured.compaction is None
    assert [msg.role for msg in ensured.history] == ["user", "user"]


def test_auto_failed_compaction_never_sends(db, client, user_factory, provider_factory, model_factory):
    user_id, conv, p, m = _auto_setup(db, client, user_factory, provider_factory, model_factory, context_window=WINDOW)
    add_message(db, conv.id, Role.USER, "a" * 5600, user_id=user_id)
    record: list = []
    compaction.set_summarizer(_fake_summarizer(fail=RuntimeError("boom")))

    async def _main():
        await compaction.ensure_budget(
            db, conv_id=conv.id, user_id=user_id, provider=p, model=m,
            adapter=_adapter_ns(record), pending=ChatMessage(role="user", content="b" * 736),
        )

    try:
        asyncio.run(_main())
        raise AssertionError("expected ValidationError")
    except ValidationError:
        pass
    assert record == []  # provider adapter never invoked
    assert not [m for m in conv_service.list_messages(db, conv.id, user_id) if m.role == Role.SUMMARY]


def test_auto_unknown_window_substitutes_without_compacting(
    db, client, user_factory, provider_factory, model_factory
):
    """A pre-existing summary still renders as system context when the newly
    selected model has no window metadata — and nothing new is compacted."""
    user_id, conv, p, m = _auto_setup(db, client, user_factory, provider_factory, model_factory, context_window=WINDOW)
    _fill(db, conv.id, user_id)
    compaction.set_summarizer(_fake_summarizer())

    async def _main():
        p2, m2 = p, m
        result = await compaction.compact_request(db, conv.id, user_id)
        assert result.trigger == "manual"
        # Newly selected model without window metadata.
        m2.context_window = None
        db.commit()
        rows = active_path(db, conv.id, user_id)
        return await compaction.ensure_budget(
            db, conv_id=conv.id, user_id=user_id, provider=p2, model=m2,
            adapter=_adapter_ns(), stored_rows=rows,
            pending=ChatMessage(role="user", content="next"),
        )

    ensured = asyncio.run(_main())
    assert ensured.compaction is None  # unknown window: no new compaction
    assert ensured.history[0].role == "system"
    assert "Canned summary" in ensured.history[0].content
    assert not any(getattr(msg, "role", "") == "summary" for msg in ensured.history)


def test_recursion_guard_rejects_nested_compaction(db):
    token = compaction._IN_COMPACTION.set(True)
    try:
        try:
            asyncio.run(
                compaction.ensure_budget(
                    db, conv_id=uuid.uuid4(), user_id=None, provider=None,
                    model=None, adapter=None,
                )
            )
            raise AssertionError("expected ValidationError")
        except ValidationError:
            pass
    finally:
        compaction._IN_COMPACTION.reset(token)


# --- progressive consolidation + branches -----------------------------------


def test_progressive_consolidation_single_latest_used(db, client, user_factory, provider_factory, model_factory):
    user_id, conv, p, m = _auto_setup(db, client, user_factory, provider_factory, model_factory, context_window=WINDOW)
    _fill(db, conv.id, user_id)
    calls: list = []
    compaction.set_summarizer(_fake_summarizer(text="SUMMARY-ONE", calls=calls))

    async def _main():
        first = await compaction.compact_conversation(
            db, conv_id=conv.id, user_id=user_id, trigger="manual",
            provider=p, model=m, adapter=_adapter_ns(), window=WINDOW, min_ratio=None,
        )
        add_message(db, conv.id, Role.USER, "second round " + "q" * 600, user_id=user_id)
        add_message(db, conv.id, Role.ASSISTANT, "second answer " + "a" * 600, user_id=user_id)
        compaction.set_summarizer(_fake_summarizer(text="SUMMARY-TWO", calls=calls))
        second = await compaction.compact_conversation(
            db, conv_id=conv.id, user_id=user_id, trigger="manual",
            provider=p, model=m, adapter=_adapter_ns(), window=WINDOW, min_ratio=None,
        )
        return first, second

    first, second = asyncio.run(_main())
    # Second summary consolidates the first: prev id linked, prev text in transcript.
    assert len(calls) == 2
    assert "SUMMARY-ONE" in calls[1][1]
    db.expire_all()
    s2 = db.get(Message, second.summary_message_id)
    assert (s2.metadata_ or {})["compaction"]["prev_summary_id"] == str(first.summary_message_id)
    # History keeps both; context uses only the latest.
    rows = active_path(db, conv.id, user_id)
    summaries = [m for m in rows if m.role == Role.SUMMARY]
    assert [m.id for m in summaries] == [first.summary_message_id, second.summary_message_id]
    latest, _covered, tail = compaction.latest_applicable_summary(rows)
    assert latest is not None and latest.id == second.summary_message_id and tail == []
    history, history_text = compaction.assemble_context(
        db, system=None, stored_rows=rows, latest_summary=latest, tail_rows=tail,
        pending=None, trigger="manual", user_id=user_id, model=m, adapter=_adapter_ns(),
    )
    assert history_text.count("SUMMARY-TWO") == 1
    assert "SUMMARY-ONE" not in history_text


def test_branch_isolation_divergent_branch_unaffected(db, client, user_factory, provider_factory, model_factory):
    user_id, conv, p, m = _auto_setup(db, client, user_factory, provider_factory, model_factory, context_window=WINDOW)
    compaction.set_summarizer(_fake_summarizer(text="BRANCH-SUMMARY"))

    async def _main():
        add_message(db, conv.id, Role.USER, "root question " + "q" * 600, user_id=user_id)
        root_answer = add_message(db, conv.id, Role.ASSISTANT, "root answer " + "a" * 600, user_id=user_id)
        await compaction.compact_conversation(
            db, conv_id=conv.id, user_id=user_id, trigger="manual",
            provider=p, model=m, adapter=_adapter_ns(), window=WINDOW, min_ratio=None,
        )
        # Divergent sibling under the pre-compaction leaf (not under the summary).
        divergent = add_message(
            db, conv.id, Role.USER, "divergent question " + "d" * 100,
            user_id=user_id, parent_message_id=root_answer.id, use_active_leaf=False,
        )
        rows = active_path(db, conv.id, user_id)
        assert rows[-1].id == divergent.id
        return await compaction.ensure_budget(
            db, conv_id=conv.id, user_id=user_id, provider=p, model=m,
            adapter=_adapter_ns(), pending=ChatMessage(role="user", content="go"),
        )

    ensured = asyncio.run(_main())
    assert ensured.compaction is None
    assert "BRANCH-SUMMARY" not in ensured.history_text  # no future-leak across branches
    assert not any(getattr(msg, "role", "") == "summary" for msg in ensured.history)


# --- concurrency ------------------------------------------------------------


def test_concurrent_double_compact_one_wins(db, client, user_factory, provider_factory, model_factory):
    user_id, provider, model = _owned(db, client, user_factory, provider_factory, model_factory, context_window=WINDOW)
    conv = _conv(db, user_id, provider, model)
    _fill(db, conv.id, user_id)
    compaction.set_summarizer(_fake_summarizer(delay=0.05))
    maker = sessionmaker(bind=db.get_bind())
    outcomes: dict = {}

    async def _main():
        async def _one(idx: int, session):
            try:
                result = await compaction.compact_request(session, conv.id, user_id)
                outcomes[idx] = ("ok", result.summary_message_id)
            except ConflictError as exc:
                session.rollback()
                outcomes[idx] = ("conflict", str(exc))
            finally:
                session.close()

        s1, s2 = maker(), maker()
        await asyncio.gather(_one(0, s1), _one(1, s2))

    asyncio.run(_main())
    assert sorted(outcomes) == [0, 1]
    oks = [v for v in outcomes.values() if v[0] == "ok"]
    conflicts = [v for v in outcomes.values() if v[0] == "conflict"]
    assert len(oks) == 1 and len(conflicts) == 1
    assert "already compacted" in conflicts[0][1]
    db.expire_all()
    assert len([m for m in conv_service.list_messages(db, conv.id, user_id) if m.role == Role.SUMMARY]) == 1


def test_stale_branch_switch_aborts_persist(db, client, user_factory, provider_factory, model_factory):
    user_id, conv, p, m = _auto_setup(db, client, user_factory, provider_factory, model_factory, context_window=WINDOW)
    _fill(db, conv.id, user_id)
    rows = active_path(db, conv.id, user_id)
    main_tip = rows[-1].id
    # Divergent sibling under an older node, then back to the main tip: the
    # mid-compact select below lands (and stays) off the covered path.
    divergent = add_message(
        db, conv.id, Role.USER, "divergent " + "d" * 100,
        user_id=user_id, parent_message_id=rows[0].id, use_active_leaf=False,
    )
    conv_service.select_message(db, conv.id, main_tip, user_id)
    assert active_path(db, conv.id, user_id)[-1].id == main_tip

    async def _sneaky_summarizer(adapter, instruction, transcript):
        conv_service.select_message(db, conv.id, divergent.id, user_id)
        return "stale summary that must never attach"

    compaction.set_summarizer(_sneaky_summarizer)

    async def _main():
        try:
            await compaction.compact_request(db, conv.id, user_id)
            return "ok"
        except ConflictError:
            db.rollback()
            return "conflict"

    assert asyncio.run(_main()) == "conflict"
    db.expire_all()
    assert not [m for m in conv_service.list_messages(db, conv.id, user_id) if m.role == Role.SUMMARY]


# --- shares / exports / aggregates ------------------------------------------


def test_share_includes_summary_distinctly_without_internals(
    db, client, user_factory, provider_factory, model_factory
):
    from tollms.api.shares import service as share_service

    user_id, provider, model = _owned(db, client, user_factory, provider_factory, model_factory, context_window=WINDOW)
    conv = _conv(db, user_id, provider, model, title="Shared")
    _fill(db, conv.id, user_id)
    compaction.set_summarizer(_fake_summarizer())
    assert client.post(f"/api/v1/conversations/{conv.id}/compact").status_code == 200

    share = share_service.create_share(db, user_id, conv.id)
    public = share_service.public_share(db, share.share_token)
    roles = [m.role for m in public.messages]
    assert "summary" in roles
    assert set(roles) == {"user", "assistant", "summary"}
    serialized = public.model_dump_json()
    for leaked in ("prompt_tokens", "total_cost", "metadata", "compaction", "session_id", "api_key"):
        assert leaked not in serialized, leaked
    tree_roles = {n.role for n in public.tree.nodes}
    assert "summary" in tree_roles


def test_exports_render_summary_without_internals(db, client, user_factory, provider_factory, model_factory):
    from tollms.api.exports import service as export_service

    user_id, provider, model = _owned(db, client, user_factory, provider_factory, model_factory, context_window=WINDOW)
    conv = _conv(db, user_id, provider, model)
    _fill(db, conv.id, user_id, n_exchanges=2)
    compaction.set_summarizer(_fake_summarizer())
    assert client.post(f"/api/v1/conversations/{conv.id}/compact").status_code == 200

    _, _, _, _, _, _ = export_service.render_conversations(db, user_id, [conv.id], False, "md")
    content, _, _, _, _, _ = export_service.render_conversations(db, user_id, [conv.id], False, "json")
    import json as _json

    payload = _json.loads(content.decode())
    convo = next(c for c in payload["conversations"] if c["id"] == str(conv.id))
    summary_msgs = [m for m in convo["messages"] if m["role"] == "summary"]
    assert len(summary_msgs) == 1
    assert "usage" in summary_msgs[0] and summary_msgs[0]["usage"]["total_tokens"] is None
    md, _, _, _, _, _ = export_service.render_conversations(db, user_id, [conv.id], False, "md")
    assert "## Summary" in md.decode()


def test_usage_totals_unaffected_by_summary(db, client, user_factory, provider_factory, model_factory):
    user_id, provider, model = _owned(db, client, user_factory, provider_factory, model_factory, context_window=WINDOW)
    conv = _conv(db, user_id, provider, model)
    _fill(db, conv.id, user_id)
    before = conv_service.usage_totals(db, conv.id, user_id)
    compaction.set_summarizer(_fake_summarizer())
    assert client.post(f"/api/v1/conversations/{conv.id}/compact").status_code == 200
    after = conv_service.usage_totals(db, conv.id, user_id)
    assert (after.total_tokens, after.prompt_tokens) == (before.total_tokens, before.prompt_tokens)


# --- run_chat integration: auto-compact inline before provider call ---------


def _mock_transport(counter):
    import httpx

    sse = (
        'data: {"choices": [{"delta": {"content": "Hello"}}]}\n\n'
        'data: {"choices": [{"delta": {"content": " world"}}]}\n\n'
        'data: {"choices": [{"delta": {}}], "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15}}\n\n'
        "data: [DONE]\n\n"
    )

    def handler(request: httpx.Request) -> httpx.Response:
        counter["n"] += 1
        assert request.url.path == "/chat/completions"
        return httpx.Response(200, content=sse.encode(), headers={"content-type": "text/event-stream"})

    return httpx.MockTransport(handler)


def test_run_chat_auto_compacts_before_provider_call(db, client, user_factory, provider_factory, model_factory):
    user_factory()
    provider = provider_factory()
    model = model_factory(provider["id"], context_window=8000)
    conv = create_conversation(
        db,
        ConversationCreate(
            title="auto",
            provider_id=uuid.UUID(provider["id"]),
            model_id=uuid.UUID(model["id"]),
        ),
        None,
    )
    _fill(db, conv.id, None, n_exchanges=9, size=1500)
    compaction.set_summarizer(_fake_summarizer())
    counter = {"n": 0}
    req = ChatRequest(
        provider_id=uuid.UUID(provider["id"]), model_id=uuid.UUID(model["id"]),
        conversation_id=conv.id, message="continue please",
    )

    result = asyncio.run(gateway_service.run_chat(db, req, _mock_transport(counter), None))
    assert result.content == "Hello world"
    assert counter["n"] == 1  # summary came from the injected fake, not HTTP
    summaries = [m for m in conv_service.list_messages(db, conv.id, None) if m.role == Role.SUMMARY]
    assert len(summaries) == 1
    assert ((summaries[0].metadata_ or {}).get("compaction") or {}).get("trigger") == "auto"
    # Follow-up send works on the compacted base.
    req2 = ChatRequest(
        provider_id=uuid.UUID(provider["id"]), model_id=uuid.UUID(model["id"]),
        conversation_id=conv.id, message="and more",
    )
    result2 = asyncio.run(gateway_service.run_chat(db, req2, _mock_transport(counter), None))
    assert result2.content == "Hello world"
    assert counter["n"] == 2
    assert len([m for m in conv_service.list_messages(db, conv.id, None) if m.role == Role.SUMMARY]) == 1


def test_run_chat_failed_compaction_sends_nothing(db, client, user_factory, provider_factory, model_factory):
    user_factory()
    provider = provider_factory()
    model = model_factory(provider["id"], context_window=8000)
    conv = create_conversation(
        db,
        ConversationCreate(
            title="auto-fail",
            provider_id=uuid.UUID(provider["id"]),
            model_id=uuid.UUID(model["id"]),
        ),
        None,
    )
    _fill(db, conv.id, None, n_exchanges=9, size=1500)
    before = len(conv_service.list_messages(db, conv.id, None))
    compaction.set_summarizer(_fake_summarizer(fail=RuntimeError("summarizer down")))
    counter = {"n": 0}
    req = ChatRequest(
        provider_id=uuid.UUID(provider["id"]), model_id=uuid.UUID(model["id"]),
        conversation_id=conv.id, message="continue please",
    )
    try:
        asyncio.run(gateway_service.run_chat(db, req, _mock_transport(counter), None))
        raise AssertionError("expected ValidationError")
    except ValidationError as exc:
        assert "compaction failed" in str(exc)
    assert counter["n"] == 0  # provider never invoked with an oversized request
    assert len(conv_service.list_messages(db, conv.id, None)) == before


# --- reviewer findings -------------------------------------------------------


def _vision_adapter():
    ns = SimpleNamespace(supports_vision=True, supports_audio=True, supports_video=True, chat_calls=[])

    async def _chat(messages, tools=None, tool_choice=None):
        ns.chat_calls.append(messages)
        raise AssertionError("provider adapter must not be called during compaction tests")

    ns.chat = _chat
    return ns


def _attach(db, user_id, conv_id, message_id, kind, filename, data, mime, extracted=None):
    rel = attachment_engine.save_bytes(user_id, str(conv_id), filename, data)
    row = Attachment(
        user_id=user_id, conversation_id=conv_id, message_id=message_id,
        filename=filename, mime_type=mime, kind=kind, file_size=len(data),
        storage_path=rel, extracted_text=extracted,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def test_lock_released_during_summarize(db, client, user_factory, provider_factory, model_factory):
    """H1: the summarizer LLM call runs lock-free (another op proceeds while it
    runs); the persist is still fenced. Deterministic: the fake summarizer
    asserts the lock is free and round-trips it."""
    user_id, provider, model = _owned(db, client, user_factory, provider_factory, model_factory, context_window=WINDOW)
    conv = _conv(db, user_id, provider, model)
    _fill(db, conv.id, user_id)
    lock = generation_engine.manager.conv_lock(conv.id)

    async def _checking(adapter, instruction, transcript):
        assert not lock.locked(), "conv lock held across summarizer LLM call"
        async with lock:  # another op proceeds while we summarize
            pass
        return "unlocked summary"

    compaction.set_summarizer(_checking)

    async def _main():
        return await compaction.compact_request(db, conv.id, user_id)

    result = asyncio.run(_main())
    assert result.status == "completed"
    assert not lock.locked()
    assert len([m for m in conv_service.list_messages(db, conv.id, user_id) if m.role == Role.SUMMARY]) == 1


def test_media_reserve_triggers_auto_compact(db, client, user_factory, provider_factory, model_factory):
    """H2: text just under the auto edge stays uncompacted, but the same text
    with one native image crosses it via the media reserve."""
    user_id, conv, p, m = _auto_setup(
        db, client, user_factory, provider_factory, model_factory,
        context_window=WINDOW, supports_vision=True, email="media@tollma.ai")
    msg = add_message(db, conv.id, Role.USER, "a" * 5600, user_id=user_id)
    _attach(db, user_id, conv.id, msg.id, "image", "pic.png", b"\x89PNG" + b"\x00" * 2048, "image/png")
    pending = ChatMessage(role="user", content="b" * 100)  # text-only: 1441 < 1600
    compaction.set_summarizer(_fake_summarizer())

    async def _main():
        return await compaction.ensure_budget(
            db, conv_id=conv.id, user_id=user_id, provider=p, model=m,
            adapter=_vision_adapter(), pending=pending,
        )

    ensured = asyncio.run(_main())
    assert ensured.compaction is not None and ensured.compaction.trigger == "auto"

    async def _control():
        conv2 = create_conversation(
            db, ConversationCreate(title="control", provider_id=p.id, model_id=m.id), user_id)
        add_message(db, conv2.id, Role.USER, "a" * 5600, user_id=user_id)
        return await compaction.ensure_budget(
            db, conv_id=conv2.id, user_id=user_id, provider=p, model=m,
            adapter=_vision_adapter(), pending=ChatMessage(role="user", content="b" * 100),
        )

    # Control: identical text without the attachment stays under the edge.
    assert asyncio.run(_control()).compaction is None


def test_native_media_preserved_in_uncompacted_history(db, client, user_factory, provider_factory, model_factory):
    """H3 integration: below-threshold tail keeps the native image part (data
    intact) instead of dropping it."""
    user_id, conv, p, m = _auto_setup(
        db, client, user_factory, provider_factory, model_factory,
        context_window=WINDOW, supports_vision=True, email="native@tollma.ai")
    data = b"\x89PNG" + b"\x00" * 64
    msg = add_message(db, conv.id, Role.USER, "look at this", user_id=user_id)
    _attach(db, user_id, conv.id, msg.id, "image", "pic.png", data, "image/png")
    compaction.set_summarizer(_fake_summarizer())

    async def _main():
        return await compaction.ensure_budget(
            db, conv_id=conv.id, user_id=user_id, provider=p, model=m,
            adapter=_vision_adapter(),
        )

    ensured = asyncio.run(_main())
    assert ensured.compaction is None
    assert len(ensured.history) == 1
    assert [part.kind for part in ensured.history[0].media] == ["image"]
    assert base64.b64decode(ensured.history[0].media[0].data_b64) == data
    assert "look at this" in ensured.history[0].content


def _att_row(kind, size=2048, extracted="saved transcript", filename="f.bin"):
    return SimpleNamespace(
        id=uuid.uuid4(), kind=kind, filename=filename, mime_type=f"{kind}/x",
        storage_path=f"rel/{filename}", extracted_text=extracted, file_size=size,
    )


def _capable_model():
    return SimpleNamespace(supports_vision=True, supports_audio_input=True, metadata_={"supports_video_input": True})


def _capable_adapter():
    return SimpleNamespace(supports_vision=True, supports_audio=True, supports_video=True)


def _gated_model():
    return SimpleNamespace(supports_vision=False, supports_audio_input=False, metadata_={})


def _gated_adapter():
    return SimpleNamespace(supports_vision=False, supports_audio=False, supports_video=False)


def test_history_blocks_native_vs_transcript(monkeypatch):
    """H3 unit: native parts when the adapter renders them (no transcript
    duplication); transcript fallback when gated; images drop silently when
    gated (mirrors gateway strict=False)."""
    monkeypatch.setattr(attachment_engine, "read_bytes", lambda rel: b"\x00" * 64)
    rows = [
        _att_row("document", extracted="doc text", filename="d.txt"),
        _att_row("image", filename="p.png", extracted=None),
        _att_row("audio", filename="a.mp3"),
        _att_row("video", filename="v.mp4"),
    ]
    texts, media = compaction._history_blocks(rows, _capable_model(), _capable_adapter())
    assert {p.kind for p in media} == {"image", "audio", "video"}
    assert len(texts) == 1 and "doc text" in texts[0]  # no transcript duplication

    texts_g, media_g = compaction._history_blocks(rows, _gated_model(), _gated_adapter())
    assert media_g == []
    assert any("audio transcript" in t for t in texts_g)
    assert any("video transcript" in t for t in texts_g)
    assert any("doc text" in t for t in texts_g)
    assert not any("p.png" in t for t in texts_g)  # gated image: no fallback

    # Reserves follow the same gate, bytes-aware.
    flags = attachment_engine.model_media_flags(_capable_model())
    assert compaction.media_reserve_for_row(rows[1], flags, _capable_adapter()) == 1000 + 2048 // 1024
    assert compaction.media_reserve_for_row(rows[2], flags, _capable_adapter()) == 500 + 2048 // 512
    assert compaction.media_reserve_for_row(rows[3], flags, _capable_adapter()) == 1500 + 2048 // 512
    gated_flags = attachment_engine.model_media_flags(_gated_model())
    assert compaction.media_reserve_for_row(rows[1], gated_flags, _gated_adapter()) == 0
    assert compaction.media_reserve_for_row(rows[0], flags, _capable_adapter()) == 0  # documents: char-counted


def test_history_blocks_fail_closed(monkeypatch):
    """H3: unreadable attachments raise (never silent partial history)."""
    def _boom(rel):
        raise ValidationError("attachment content is missing from storage")

    monkeypatch.setattr(attachment_engine, "read_bytes", _boom)
    with pytest.raises(ValidationError):
        compaction._history_blocks([_att_row("image", filename="p.png", extracted=None)],
                                   _capable_model(), _capable_adapter())
    with pytest.raises(ValidationError):
        compaction._history_blocks([_att_row("weird", filename="w")],
                                   _capable_model(), _capable_adapter())


def test_estimator_adds_media_reserve():
    base, _ = compaction.estimate_assembled(system=None, summary_text=None, tail_contents=["x" * 100], pending_text=None)
    with_media, _ = compaction.estimate_assembled(
        system=None, summary_text=None, tail_contents=["x" * 100], pending_text=None, media_tokens=1000)
    assert with_media - base == 1000
    msgs = [ChatMessage(role="user", content="hi",
                         media=[MediaPart(kind="image", mime_type="image/png", data_b64="eA==")])]
    assert compaction.media_reserve_for_messages(msgs) == compaction.IMAGE_BASE_TOKENS


def test_no_duplicate_sibling_on_serialized_race(db, client, user_factory, provider_factory, model_factory):
    """M1/H1 fence: the same explicit chain compacted twice from a stale
    snapshot — the second 409s instead of orphaning a duplicate sibling."""
    user_id, conv, p, m = _auto_setup(db, client, user_factory, provider_factory, model_factory, context_window=WINDOW)
    _fill(db, conv.id, user_id)
    rows = active_path(db, conv.id, user_id)
    compaction.set_summarizer(_fake_summarizer())
    kwargs = dict(conv_id=conv.id, user_id=user_id, trigger="manual",
                  provider=p, model=m, adapter=_adapter_ns(), window=WINDOW, min_ratio=None)

    async def _main():
        first = await compaction.compact_conversation(db, rows=list(rows), **kwargs)
        try:
            await compaction.compact_conversation(db, rows=list(rows), **kwargs)
            return first, "ok"
        except ConflictError:
            db.rollback()
            return first, "conflict"

    first, outcome = asyncio.run(_main())
    assert outcome == "conflict"
    summaries = [r for r in conv_service.list_messages(db, conv.id, user_id) if r.role == Role.SUMMARY]
    assert [s.id for s in summaries] == [first.summary_message_id]
    assert summaries[0].parent_message_id == rows[-1].id


def test_covered_ids_tail_only_across_progressives(db, client, user_factory, provider_factory, model_factory):
    """M2: each summary persists only its new tail ids; prev_summary_id chains
    the rest (growth O(tail), full history recoverable via the chain)."""
    user_id, conv, p, m = _auto_setup(db, client, user_factory, provider_factory, model_factory, context_window=WINDOW)
    _fill(db, conv.id, user_id)
    first_ids = [r.id for r in active_path(db, conv.id, user_id)]
    compaction.set_summarizer(_fake_summarizer(text="SUMMARY-ONE"))
    kwargs = dict(conv_id=conv.id, user_id=user_id, trigger="manual",
                  provider=p, model=m, adapter=_adapter_ns(), window=WINDOW, min_ratio=None)

    async def _main():
        first = await compaction.compact_conversation(db, **kwargs)
        add_message(db, conv.id, Role.USER, "second round " + "q" * 600, user_id=user_id)
        add_message(db, conv.id, Role.ASSISTANT, "second answer " + "a" * 600, user_id=user_id)
        compaction.set_summarizer(_fake_summarizer(text="SUMMARY-TWO"))
        second = await compaction.compact_conversation(db, **kwargs)
        return first, second

    first, second = asyncio.run(_main())
    db.expire_all()
    s1 = db.get(Message, first.summary_message_id)
    s2 = db.get(Message, second.summary_message_id)
    c1 = (s1.metadata_ or {})["compaction"]
    c2 = (s2.metadata_ or {})["compaction"]
    assert set(c1["covered_message_ids"]) == {str(i) for i in first_ids}
    assert c1["prev_summary_id"] is None
    new_ids = [str(r.id) for r in active_path(db, conv.id, user_id) if r.role != Role.SUMMARY][-2:]
    assert set(c2["covered_message_ids"]) == set(new_ids)  # tail only, not cumulative
    assert not (set(c2["covered_message_ids"]) & set(c1["covered_message_ids"]))
    assert c2["prev_summary_id"] == str(first.summary_message_id)
    assert set(c1["covered_message_ids"]) | set(c2["covered_message_ids"]) == {
        str(r.id) for r in active_path(db, conv.id, user_id) if r.role != Role.SUMMARY
    } | {str(i) for i in first_ids}


def test_config_vs_threshold_error_codes(db, client, user_factory, provider_factory, model_factory):
    """L2: config errors (no window / no active model) are 422 with
    INVALID_CONFIGURATION; below-threshold stays 422 VALIDATION_ERROR."""
    from tollms.models.provider import Provider

    user_id, provider, model = _owned(db, client, user_factory, provider_factory, model_factory,
                                      context_window=WINDOW, email="codes@tollma.ai")
    conv = _conv(db, user_id, provider, model)
    add_message(db, conv.id, Role.USER, "hi", user_id=user_id)
    add_message(db, conv.id, Role.ASSISTANT, "hello", user_id=user_id)
    compaction.set_summarizer(_fake_summarizer())
    r = client.post(f"/api/v1/conversations/{conv.id}/compact")
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "VALIDATION_ERROR"
    assert "minimum 20%" in r.json()["error"]["message"]

    user_id2, provider2, model2 = _owned(db, client, user_factory, provider_factory, model_factory,
                                        email="nowindow@tollma.ai")
    conv2 = _conv(db, user_id2, provider2, model2)
    _fill(db, conv2.id, user_id2)
    r = client.post(f"/api/v1/conversations/{conv2.id}/compact")
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "INVALID_CONFIGURATION"
    assert "context-window" in r.json()["error"]["message"]

    # No usable pair (client is still authed as the second user): deactivating
    # their provider surfaces the config error before the window check runs.
    prov = db.get(Provider, uuid.UUID(provider2["id"]))
    prov.is_active = False
    db.commit()
    r = client.post(f"/api/v1/conversations/{conv2.id}/compact")
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "INVALID_CONFIGURATION"
    assert "no active model" in r.json()["error"]["message"]


def test_sidebar_count_excludes_summaries(db, client, user_factory, provider_factory, model_factory):
    """L4: sidebar message_count skips SUMMARY bookkeeping nodes."""
    user_id, provider, model = _owned(db, client, user_factory, provider_factory, model_factory,
                                      context_window=WINDOW, email="sidebar@tollma.ai")
    conv = _conv(db, user_id, provider, model)
    _fill(db, conv.id, user_id)
    compaction.set_summarizer(_fake_summarizer())
    assert client.post(f"/api/v1/conversations/{conv.id}/compact").status_code == 200
    rows = client.get("/api/v1/conversations").json()
    row = next(c for c in rows if c["id"] == str(conv.id))
    assert row["message_count"] == 6  # 3 exchanges, summary excluded


def test_usage_totals_drops_zero_total_groups(db, client, user_factory, provider_factory, model_factory):
    """L5: by_model/by_provider omit groups with zero tokens AND zero cost."""
    user_id, provider, model = _owned(db, client, user_factory, provider_factory, model_factory,
                                      context_window=WINDOW, email="usage@tollma.ai")
    conv = _conv(db, user_id, provider, model)
    add_message(db, conv.id, Role.ASSISTANT, "", user_id=user_id, status=MessageStatus.RUNNING)
    totals = conv_service.usage_totals(db, conv.id, user_id)
    assert totals.total_tokens == 0
    assert totals.by_model == []
    assert totals.by_provider == []
