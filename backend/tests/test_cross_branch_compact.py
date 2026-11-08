"""Cross-feature integration: branches x compaction x regen x model-switch x failures x races.

Covers the TOGETHER behavior (scenarios S1/S2/S3/S9/S10 + tree/path/select with
Role.SUMMARY) that the per-feature suites (test_conversation_tree*.py,
test_compaction*.py) assert only in isolation.

Deterministic injected fakes throughout (summarizer + adapters); no provider
HTTP. Serial, isolated DB (suite wipe between tests).

Conventions mirror test_compaction.py: WINDOW=2000 (manual 20% = 400 tokens,
auto 80% = 1600), unscoped service calls where the HTTP layer adds nothing,
HTTP where the contract is the endpoint (tree/path payload shape).
"""

import asyncio
import uuid
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
from tollms.api.keys.service import ensure_primary_key
from tollms.core.exceptions import ConflictError
from tollms.models.message import Message, MessageStatus, Role
from tollms.services import generation as generation_engine
from tollms.services.gateway.adapters.base import (
    BaseProviderAdapter,
    ChatMessage,
    StreamChunk,
)

WINDOW = 2000  # shared small window: manual 20% = 400 tokens, auto 80% = 1600
SUMMARY_TEXT = "Canned cross-branch summary."


@pytest.fixture(autouse=True)
def _reset_summarizer():
    compaction.reset_summarizer()
    yield
    compaction.reset_summarizer()


def _fake_summarizer(text=SUMMARY_TEXT, calls=None, fail=None, delay=0.0):
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
        raise AssertionError("provider adapter must not be called in compaction tests")

    ns.chat = _chat
    return ns


class _StreamFake(BaseProviderAdapter):
    """In-process streaming adapter: records the exact provider payload."""

    seen: list = []

    def __init__(self, text="fresh answer"):
        super().__init__(credentials={}, model_id="fake")
        self._text = text
        self.messages = []

    async def chat_stream(self, messages):
        self.messages = list(messages)
        _StreamFake.seen.append(list(messages))
        yield StreamChunk(delta=self._text, prompt_tokens=5, completion_tokens=5, total_tokens=10)


def _user_id(client):
    return uuid.UUID(client.get("/auth/me").json()["id"])


def _owned(db, client, user_factory, provider_factory, model_factory, email="u@tollma.ai", **mkw):
    user_factory(email=email)
    provider = provider_factory()
    model = model_factory(provider["id"], **mkw)
    return _user_id(client), provider, model


def _conv(db, user_id, provider, model, title="Cross"):
    return create_conversation(
        db,
        ConversationCreate(
            title=title,
            provider_id=uuid.UUID(provider["id"]),
            model_id=uuid.UUID(model["id"]),
        ),
        user_id,
    )


def _provider_model(db, provider, model):
    from tollms.models.provider import Provider
    from tollms.models.registered_model import AIModel

    return db.get(Provider, uuid.UUID(provider["id"])), db.get(AIModel, uuid.UUID(model["id"]))


def _fresh_session(db):
    maker = sessionmaker(bind=db.get_bind())
    return maker()


# --- S1: compact branch -> switch -> no reuse -> switch back -> reload -------


def _s1_tree(db, user_id, conv, branch_text="branch"):
    root_q = add_message(db, conv.id, Role.USER, "root question", user_id=user_id)
    root_a = add_message(db, conv.id, Role.ASSISTANT, "root answer", user_id=user_id)
    branch_u = add_message(db, conv.id, Role.USER, f"{branch_text} q " + "q" * 3000,
                           user_id=user_id, parent_message_id=root_a.id)
    branch_a = add_message(db, conv.id, Role.ASSISTANT, f"{branch_text} a " + "a" * 3000,
                           user_id=user_id, parent_message_id=branch_u.id)
    return root_q, root_a, branch_u, branch_a


def test_s1_compact_branch_switch_no_reuse_switch_back_reload(
    db, client, user_factory, provider_factory, model_factory
):
    """S1: compact on branch A; divergent branch B never inherits the summary;
    the assembled provider payload on B is raw history; switching back to A
    restores summary substitution; a fresh-session re-read agrees."""
    user_id, provider, model = _owned(
        db, client, user_factory, provider_factory, model_factory,
        context_window=WINDOW, email="s1@tollma.ai")
    conv = _conv(db, user_id, provider, model)
    root_q, root_a, branch_u, branch_a = _s1_tree(db, user_id, conv)
    p, m = _provider_model(db, provider, model)
    compaction.set_summarizer(_fake_summarizer())

    async def _main():
        result = await compaction.compact_conversation(
            db, conv_id=conv.id, user_id=user_id, trigger="manual",
            provider=p, model=m, adapter=_adapter_ns(), window=WINDOW, min_ratio=None,
        )
        return result

    first = asyncio.run(_main())
    db.expire_all()
    summary = db.get(Message, first.summary_message_id)
    assert summary.parent_message_id == branch_a.id
    assert db.get(conv_service.Conversation, conv.id).active_leaf_message_id == summary.id

    # Divergent sibling off the pre-compaction node: a new branch, not under summary.
    divergent = add_message(db, conv.id, Role.USER, "divergent q " + "d" * 100,
                            user_id=user_id, parent_message_id=root_a.id,
                            use_active_leaf=False)
    assert active_path(db, conv.id, user_id)[-1].id == divergent.id

    async def _budget(rows=None, pending=None):
        return await compaction.ensure_budget(
            db, conv_id=conv.id, user_id=user_id, provider=p, model=m,
            adapter=_adapter_ns(), stored_rows=rows, pending=pending,
        )

    # On branch B: no summary substitution; payload is raw history + pending.
    ensured_b = asyncio.run(_budget(pending=ChatMessage(role="user", content="onwards")))
    assert ensured_b.compaction is None
    assert ensured_b.history_text.count(SUMMARY_TEXT) == 0
    assert not any(getattr(msg, "role", "") == "summary" for msg in ensured_b.history)
    assert [msg.role for msg in ensured_b.history] == ["user", "assistant", "user", "user"]
    assert "divergent q" in ensured_b.history_text  # branch-B content present ...
    assert "branch a" not in ensured_b.history_text  # ... branch-A content absent

    # Switch back to the summary tip: substitution returns, exactly once.
    conv_service.select_message(db, conv.id, summary.id, user_id)
    assert active_path(db, conv.id, user_id)[-1].id == summary.id
    ensured_a = asyncio.run(_budget(pending=ChatMessage(role="user", content="continue")))
    assert ensured_a.compaction is None  # well under 80%: substitution only
    assert [msg.role for msg in ensured_a.history] == ["system", "user"]
    assert ensured_a.history[0].content.startswith("Earlier conversation summary")
    assert ensured_a.history_text.count(SUMMARY_TEXT) == 1
    assert "divergent q" not in ensured_a.history_text  # B never leaks into A
    assert "branch q" not in ensured_a.history_text  # covered raw text stays covered

    # Fresh-session re-read (reload path): same tip, same latest summary, same tail.
    s2 = _fresh_session(db)
    try:
        fresh_rows = active_path(s2, conv.id, user_id)
        assert fresh_rows[-1].id == summary.id
        latest, _covered, tail = compaction.latest_applicable_summary(fresh_rows)
        assert latest is not None and latest.id == summary.id and tail == []
        assert {m.id for m in fresh_rows} == {root_q.id, root_a.id, branch_u.id, branch_a.id, summary.id}
    finally:
        s2.close()

    # Originals intact: no branch content rewritten by the compact.
    assert db.get(Message, branch_a.id).content.startswith("branch a ")
    assert db.get(Message, divergent.id).content.startswith("divergent q ")


def test_s1_tree_path_endpoints_mark_summary_across_switch(
    db, client, user_factory, provider_factory, model_factory
):
    """S1 HTTP slice: tree/path expose the summary distinctly (§1.1/1.2); the
    divergent branch path carries no summary role."""
    user_id, provider, model = _owned(
        db, client, user_factory, provider_factory, model_factory,
        context_window=WINDOW, email="s1http@tollma.ai")
    conv = _conv(db, user_id, provider, model)
    _root_q, root_a, _branch_u, branch_a = _s1_tree(db, user_id, conv)
    compaction.set_summarizer(_fake_summarizer())
    r = client.post(f"/api/v1/conversations/{conv.id}/compact")
    assert r.status_code == 200, r.text
    summary_id = r.json()["summary_message_id"]

    tree = client.get(f"/api/v1/conversations/{conv.id}/tree").json()
    node = next(n for n in tree["nodes"] if n["id"] == summary_id)
    assert node["role"] == "summary"
    assert node["parent_message_id"] == str(branch_a.id)
    assert tree["active_leaf_id"] == summary_id

    path = client.get(f"/api/v1/conversations/{conv.id}/path").json()
    assert path["path"][-1]["role"] == "summary"
    assert path["active_leaf_id"] == summary_id

    divergent = add_message(db, conv.id, Role.USER, "divergent q " + "d" * 100,
                            user_id=user_id, parent_message_id=root_a.id,
                            use_active_leaf=False)
    path_b = client.get(f"/api/v1/conversations/{conv.id}/path").json()
    assert path_b["active_leaf_id"] == str(divergent.id)
    assert "summary" not in [m["role"] for m in path_b["path"]]

    sel = client.post(f"/api/v1/conversations/{conv.id}/select",
                      json={"message_id": summary_id}).json()
    assert sel["active_leaf_id"] == summary_id
    assert sel["path"][-1]["role"] == "summary"


# --- S2: compact -> regen earlier version -> repeat after 2nd compact --------


def _s2_fill(db, conv_id, user_id):
    ids = []
    for i in range(3):
        ids.append(add_message(db, conv_id, Role.USER, f"s2 question {i} " + "q" * 620, user_id=user_id))
        ids.append(add_message(db, conv_id, Role.ASSISTANT, f"s2 answer {i} " + "a" * 620, user_id=user_id))
    return ids


def test_s2_regen_earlier_version_after_compact_no_future_leak(
    db, client, user_factory, provider_factory, model_factory, monkeypatch
):
    """S2: regenerating a covered response builds context from ITS ancestors
    (summary + its own prompt): post-compaction follow-ups never leak in; the
    old version is untouched; the new sibling is version+1; summary refs stay
    valid. The recorded adapter payload is the evidence."""
    user_id, provider, model = _owned(
        db, client, user_factory, provider_factory, model_factory,
        context_window=WINDOW, email="s2@tollma.ai")
    conv = _conv(db, user_id, provider, model)
    rows = _s2_fill(db, conv.id, user_id)
    old_user, old_answer = rows[0], rows[1]
    p, _m = _provider_model(db, provider, model)
    compaction.set_summarizer(_fake_summarizer())
    first = asyncio.run(compaction.compact_conversation(
        db, conv_id=conv.id, user_id=user_id, trigger="manual",
        provider=p, model=_m, adapter=_adapter_ns(), window=WINDOW, min_ratio=None))
    db.expire_all()

    follow_q = add_message(db, conv.id, Role.USER, "s2 follow-up FUTURE-MARK " + "f" * 600, user_id=user_id)
    follow_a = add_message(db, conv.id, Role.ASSISTANT, "s2 follow-up answer " + "g" * 600, user_id=user_id)
    assert follow_a.parent_message_id == follow_q.id  # chain linked

    _StreamFake.seen.clear()
    monkeypatch.setattr(gateway_service, "build_adapter", lambda *a, **k: _StreamFake("regen text"))
    key_id = ensure_primary_key(db, user_id).id

    async def _regen_old():
        started = await gateway_service.start_regeneration(
            db, old_answer.id, user_id=user_id, provider_id=p.id, model_id=_m.id, key_id=key_id)
        active = generation_engine.manager.get(started.message_id)
        if active is not None and active.task is not None:
            await active.task
        return started

    started = asyncio.run(_regen_old())
    assert started.message_id != old_answer.id

    db.expire_all()
    orig = conv_service.get_message(db, old_answer.id, user_id)
    assert orig.status == MessageStatus.COMPLETED and orig.content.startswith("s2 answer 0")
    sib = conv_service.get_message(db, started.message_id, user_id)
    assert sib.status == MessageStatus.COMPLETED and sib.content == "regen text"
    assert sib.parent_message_id == orig.parent_message_id == old_user.id
    assert sib.version_number == orig.version_number + 1
    sibs = conv_service.message_siblings(db, sib.id, user_id)
    assert sorted(m.version_number for m in sibs) == [1, 2]
    assert conv_service.conversation_tree(db, conv.id, user_id)["active_leaf_id"] == sib.id

    # Provider payload for the regen: ancestors-only per the documented
    # chain_rows_through contract (gateway/service.py start_child_assistant
    # builds the prompt chain from ancestors; the covering summary sits
    # BELOW the prompt so it is structurally unreachable — see O1 in the
    # scenario report: substituting it needs the regen target id, which only
    # the gateway layer owns). Pinned: bare prompt, no fabrication, no leak.
    assert len(_StreamFake.seen) == 1
    payload_roles = [m.role for m in _StreamFake.seen[0]]
    assert "summary" not in [str(r).lower() for r in payload_roles]
    payload_text = "\n".join(m.content for m in _StreamFake.seen[0])
    assert SUMMARY_TEXT not in payload_text  # O1: covering summary not substituted
    assert "s2 question 0" in payload_text  # its own prompt present ...
    assert "FUTURE-MARK" not in payload_text  # ... post-compact future absent
    assert "s2 answer 0" not in payload_text  # previous answer never feeds back

    # Summary refs still valid after the regen sibling landed: the S1 row
    # is intact with its original coverage. The regen sibling is a divergent
    # branch off the pre-compaction line, so by the branch-isolation rule it
    # inherits NO summary — the new active path is raw history only.
    db.expire_all()
    s1 = db.get(Message, first.summary_message_id)
    comp = (s1.metadata_ or {}).get("compaction") or {}
    assert set(comp["covered_message_ids"]) == {str(m.id) for m in rows}
    assert comp["prev_summary_id"] is None
    live = active_path(db, conv.id, user_id)
    assert [m.id for m in live] == [old_user.id, sib.id]
    latest, _covered, tail = compaction.latest_applicable_summary(live)
    assert latest is None and [m.id for m in tail] == [old_user.id, sib.id]

    async def _follow():
        return await compaction.ensure_budget(
            db, conv_id=conv.id, user_id=user_id, provider=p, model=_m,
            adapter=_adapter_ns(), pending=ChatMessage(role="user", content="next"))
    followed = asyncio.run(_follow())
    assert followed.compaction is None
    assert SUMMARY_TEXT not in followed.history_text  # no leak onto the new branch
    assert "regen text" in followed.history_text and "next" in followed.history_text

    # No duplicate user messages from the regen round-trip.
    users = [m for m in conv_service.list_messages(db, conv.id, user_id) if m.role == Role.USER]
    assert len(users) == 4  # 3 covered + 1 follow-up
    assert len({m.content for m in users}) == 4


def test_s2_second_compaction_preserves_regen_sibling_and_chains(
    db, client, user_factory, provider_factory, model_factory, monkeypatch
):
    """S2 repeat (divergent regen branch): the second compaction covers only
    the new branch's tail and starts a FRESH chain (prev None) — chaining
    across the divergence would inherit another branch's summary. Every prior
    version (incl. the regen sibling) stays intact; the leaf lands on S2."""
    user_id, provider, model = _owned(
        db, client, user_factory, provider_factory, model_factory,
        context_window=WINDOW, email="s2rep@tollma.ai")
    conv = _conv(db, user_id, provider, model)
    rows = _s2_fill(db, conv.id, user_id)
    p, m = _provider_model(db, provider, model)
    compaction.set_summarizer(_fake_summarizer(text="SUMMARY-ONE"))
    first = asyncio.run(compaction.compact_conversation(
        db, conv_id=conv.id, user_id=user_id, trigger="manual",
        provider=p, model=m, adapter=_adapter_ns(), window=WINDOW, min_ratio=None))
    db.expire_all()

    monkeypatch.setattr(gateway_service, "build_adapter", lambda *a, **k: _StreamFake("regen text"))
    key_id = ensure_primary_key(db, user_id).id

    async def _regen(mid, prov, mod, kid):
        started = await gateway_service.start_regeneration(
            db, mid, user_id=user_id, provider_id=prov.id, model_id=mod.id, key_id=kid)
        active = generation_engine.manager.get(started.message_id)
        if active is not None and active.task is not None:
            await active.task
        return started

    started = asyncio.run(_regen(rows[1].id, p, m, key_id))
    db.expire_all()
    regen_id = started.message_id

    add_message(db, conv.id, Role.USER, "s2 round two " + "q" * 3000, user_id=user_id)
    add_message(db, conv.id, Role.ASSISTANT, "s2 round two answer " + "a" * 100, user_id=user_id)
    compaction.set_summarizer(_fake_summarizer(text="SUMMARY-TWO"))
    second = asyncio.run(compaction.compact_conversation(
        db, conv_id=conv.id, user_id=user_id, trigger="manual",
        provider=p, model=m, adapter=_adapter_ns(), window=WINDOW, min_ratio=None))
    db.expire_all()

    s1 = db.get(Message, first.summary_message_id)
    s2 = db.get(Message, second.summary_message_id)
    c1 = (s1.metadata_ or {}).get("compaction") or {}
    c2 = (s2.metadata_ or {})["compaction"]
    assert c1["prev_summary_id"] is None and c2["prev_summary_id"] is None  # fresh chain
    assert s2.parent_message_id != s1.parent_message_id
    # New-branch tail only (shared root prefix re-covered on its own branch —
    # never inherited from the abandoned line).
    new_branch_tail = {str(m.id) for m in active_path(db, conv.id, user_id)
                       if m.role != Role.SUMMARY and m.id != s2.id}
    assert set(c2["covered_message_ids"]) == new_branch_tail
    assert regen_id in {uuid.UUID(i) for i in c2["covered_message_ids"]}  # sib covered once

    live = conv_service.list_messages(db, conv.id, user_id)
    by_id = {m.id: m for m in live}
    assert by_id[regen_id].content == "regen text"  # regen sibling untouched
    assert by_id[rows[1].id].content.startswith("s2 answer 0")  # old version untouched
    assert by_id[rows[1].id].version_number + 1 == by_id[regen_id].version_number
    assert by_id[s1.id].content == "SUMMARY-ONE"  # abandoned-line summary kept for audit
    assert db.get(conv_service.Conversation, conv.id).active_leaf_message_id == s2.id
    path = active_path(db, conv.id, user_id)
    assert [m.id for m in path if m.role == Role.SUMMARY] == [s2.id]  # branch rule: S1 not inherited
    latest, _covered, tail = compaction.latest_applicable_summary(path)
    assert latest is not None and latest.id == s2.id and tail == []


def test_s2_regen_on_compacted_line_chains_second_compact(
    db, client, user_factory, provider_factory, model_factory, monkeypatch
):
    """S2 chaining shape: regenerating a POST-compaction answer keeps the
    summary on-path (chain includes S1) — the regen payload substitutes S1
    once with no future leak — and the next compaction chains prev=S1 with
    tail-only growth."""
    user_id, provider, model = _owned(
        db, client, user_factory, provider_factory, model_factory,
        context_window=WINDOW, email="s2chain@tollma.ai")
    conv = _conv(db, user_id, provider, model)
    _s2_fill(db, conv.id, user_id)
    p, m = _provider_model(db, provider, model)
    compaction.set_summarizer(_fake_summarizer(text="SUMMARY-ONE"))
    first = asyncio.run(compaction.compact_conversation(
        db, conv_id=conv.id, user_id=user_id, trigger="manual",
        provider=p, model=m, adapter=_adapter_ns(), window=WINDOW, min_ratio=None))
    db.expire_all()

    follow_q = add_message(db, conv.id, Role.USER, "s2 follow-up CHAIN-MARK " + "f" * 600, user_id=user_id)
    follow_a = add_message(db, conv.id, Role.ASSISTANT, "s2 follow-up answer " + "g" * 600, user_id=user_id)
    key_id = ensure_primary_key(db, user_id).id
    _StreamFake.seen.clear()
    monkeypatch.setattr(gateway_service, "build_adapter", lambda *a, **k: _StreamFake("regen text"))

    async def _regen():
        started = await gateway_service.start_regeneration(
            db, follow_a.id, user_id=user_id, provider_id=p.id, model_id=m.id, key_id=key_id)
        active = generation_engine.manager.get(started.message_id)
        if active is not None and active.task is not None:
            await active.task
        return started

    started = asyncio.run(_regen())
    db.expire_all()

    # Regen payload: S1 substituted exactly once, own prompt + tail present.
    assert len(_StreamFake.seen) == 1
    payload_text = "\n".join(m.content for m in _StreamFake.seen[0])
    assert payload_text.count("SUMMARY-ONE") == 1
    assert "CHAIN-MARK" in payload_text
    sib = conv_service.get_message(db, started.message_id, user_id)
    assert sib.parent_message_id == follow_q.id
    assert conv_service.get_message(db, follow_a.id, user_id).status == MessageStatus.COMPLETED

    add_message(db, conv.id, Role.USER, "s2 round two " + "q" * 3000, user_id=user_id)
    add_message(db, conv.id, Role.ASSISTANT, "s2 round two answer " + "a" * 100, user_id=user_id)
    compaction.set_summarizer(_fake_summarizer(text="SUMMARY-TWO"))
    second = asyncio.run(compaction.compact_conversation(
        db, conv_id=conv.id, user_id=user_id, trigger="manual",
        provider=p, model=m, adapter=_adapter_ns(), window=WINDOW, min_ratio=None))
    db.expire_all()

    s1 = db.get(Message, first.summary_message_id)
    s2 = db.get(Message, second.summary_message_id)
    c1 = (s1.metadata_ or {}).get("compaction") or {}
    c2 = (s2.metadata_ or {})["compaction"]
    assert c2["prev_summary_id"] == str(s1.id)  # chains: same line, S1 applicable
    c1_ids = set(c1["covered_message_ids"])
    assert not (set(c2["covered_message_ids"]) & c1_ids)  # tail only
    assert by_id_present(db, conv.id, user_id, sib.id)  # regen sibling intact
    path = active_path(db, conv.id, user_id)
    assert [m.id for m in path if m.role == Role.SUMMARY] == [s1.id, s2.id]


def by_id_present(db, conv_id, user_id, mid) -> bool:
    return any(m.id == mid for m in conv_service.list_messages(db, conv_id, user_id))


# --- S3: model switch small<->large -------------------------------------------


def test_s3_model_switch_recalc_enforced_no_history_mutation(
    db, client, user_factory, provider_factory, model_factory
):
    """S3: the same history compacts under the small window but skips under
    the large one (thresholds recalc per selected window); switching models
    never mutates history; manual enforcement follows the CURRENT window."""
    user_id, provider, small = _owned(
        db, client, user_factory, provider_factory, model_factory,
        context_window=WINDOW, email="s3@tollma.ai")
    big = model_factory(provider["id"], model_id="mock-big", name="Big", context_window=128000)
    conv = _conv(db, user_id, provider, small)
    add_message(db, conv.id, Role.USER, "a" * 5600, user_id=user_id)
    before = [(m.id, m.content) for m in conv_service.list_messages(db, conv.id, user_id)]

    from tollms.models.provider import Provider
    from tollms.models.registered_model import AIModel

    p = db.get(Provider, uuid.UUID(provider["id"]))
    m_small = db.get(AIModel, uuid.UUID(small["id"]))
    m_big = db.get(AIModel, uuid.UUID(big["id"]))
    compaction.set_summarizer(_fake_summarizer())

    async def _main():
        over_small = await compaction.ensure_budget(
            db, conv_id=conv.id, user_id=user_id, provider=p, model=m_small,
            adapter=_adapter_ns(), pending=ChatMessage(role="user", content="b" * 736),
        )
        under_big = await compaction.ensure_budget(
            db, conv_id=conv.id, user_id=user_id, provider=p, model=m_big,
            adapter=_adapter_ns(), pending=ChatMessage(role="user", content="next"),
        )
        return over_small, under_big

    over_small, under_big = asyncio.run(_main())
    assert over_small.compaction is not None and over_small.compaction.trigger == "auto"
    assert over_small.compaction.context_window == WINDOW
    assert under_big.compaction is None  # same history: large window skips
    assert [msg.role for msg in under_big.history] == ["system", "user"]
    assert under_big.history_text.count(SUMMARY_TEXT) == 1
    assert under_big.history[1].content == "next"  # pending exactly once

    # No history mutation from the switch: only the summary row was added.
    db.expire_all()
    after = [(m.id, m.content) for m in conv_service.list_messages(db, conv.id, user_id)
             if m.role != Role.SUMMARY]
    assert after == before
    assert len([m for m in conv_service.list_messages(db, conv.id, user_id)
                if m.role == Role.SUMMARY]) == 1

    # Backend enforcement follows the CURRENT window: the identical content
    # that auto-compacted on small is far below manual threshold on big.
    conv2 = _conv(db, user_id, provider, big)
    add_message(db, conv2.id, Role.USER, "a" * 5600, user_id=user_id)
    r = client.post(f"/api/v1/conversations/{conv2.id}/compact")
    assert r.status_code == 422, r.text
    assert "minimum 20%" in r.json()["error"]["message"]


# --- S9: failed/cancelled + compaction + regen-failed --------------------------


def _s9_tree(db, user_id, conv):
    u1 = add_message(db, conv.id, Role.USER, "s9 q1 " + "q" * 800, user_id=user_id)
    a1 = add_message(db, conv.id, Role.ASSISTANT, "s9 a1 " + "a" * 800, user_id=user_id)
    u2 = add_message(db, conv.id, Role.USER, "s9 q2 " + "q" * 800, user_id=user_id)
    failed = add_message(db, conv.id, Role.ASSISTANT, "s9 boom FAILED-MARK " + "f" * 800,
                         user_id=user_id, status=MessageStatus.FAILED,
                         parent_message_id=u2.id, use_active_leaf=False)
    failed.error = "provider blew up"
    cancelled = add_message(db, conv.id, Role.ASSISTANT, "s9 cancelled CANCEL-MARK " + "c" * 800,
                            user_id=user_id, status=MessageStatus.CANCELLED,
                            parent_message_id=u2.id, use_active_leaf=False)
    db.commit()
    return u1, a1, u2, failed, cancelled


def test_s9_failed_cancelled_survive_compaction_undeleted_untouched(
    db, client, user_factory, provider_factory, model_factory
):
    """S9: compacting the active branch preserves FAILED/CANCELLED statuses,
    creates no duplicate user messages, and leaves the off-path failed
    sibling reselectable with no summary leaking onto it."""
    user_id, provider, model = _owned(
        db, client, user_factory, provider_factory, model_factory,
        context_window=WINDOW, email="s9@tollma.ai")
    conv = _conv(db, user_id, provider, model)
    u1, a1, u2, failed, cancelled = _s9_tree(db, user_id, conv)
    # Leaf sits on the CANCELLED tip: active path covers u1/a1/u2/cancelled.
    assert active_path(db, conv.id, user_id)[-1].id == cancelled.id
    users_before = [m.id for m in conv_service.list_messages(db, conv.id, user_id)
                    if m.role == Role.USER]
    compaction.set_summarizer(_fake_summarizer())

    r = client.post(f"/api/v1/conversations/{conv.id}/compact")
    assert r.status_code == 200, r.text
    db.expire_all()

    live = conv_service.list_messages(db, conv.id, user_id)
    by_id = {m.id: m for m in live}
    assert by_id[failed.id].status == MessageStatus.FAILED  # off-path failed untouched
    assert by_id[failed.id].content.startswith("s9 boom FAILED-MARK")
    assert by_id[cancelled.id].status == MessageStatus.CANCELLED  # covered cancelled kept
    assert by_id[cancelled.id].content.startswith("s9 cancelled CANCEL-MARK")
    assert [m.id for m in live if m.role == Role.USER] == users_before  # no dup user msgs
    summary = db.get(Message, uuid.UUID(r.json()["summary_message_id"]))
    comp = (summary.metadata_ or {}).get("compaction") or {}
    assert set(comp["covered_message_ids"]) == {str(u1.id), str(a1.id), str(u2.id), str(cancelled.id)}
    assert str(failed.id) not in comp["covered_message_ids"]  # off-path node never covered

    # The off-path FAILED sibling reselects cleanly with no summary on its path.
    conv_service.select_message(db, conv.id, failed.id, user_id)
    other = [m["role"] for m in client.get(f"/api/v1/conversations/{conv.id}/path").json()["path"]]
    assert "summary" not in other
    assert other == ["user", "assistant", "user", "assistant"]


def test_s9_regen_failed_after_compact_sibling_not_rewrite(
    db, client, user_factory, provider_factory, model_factory, monkeypatch
):
    """S9: regenerating a FAILED response covered by a summary creates a new
    COMPLETED sibling (version+1, leaf moves); the failure row keeps its
    status/content/error — never rewritten as a success; no user-msg dup."""
    user_id, provider, model = _owned(
        db, client, user_factory, provider_factory, model_factory,
        context_window=WINDOW, email="s9regen@tollma.ai")
    conv = _conv(db, user_id, provider, model)
    u1 = add_message(db, conv.id, Role.USER, "s9 q1 " + "q" * 800, user_id=user_id)
    add_message(db, conv.id, Role.ASSISTANT, "s9 a1 " + "a" * 800, user_id=user_id)
    u2 = add_message(db, conv.id, Role.USER, "s9 q2 " + "q" * 800, user_id=user_id)
    failed = add_message(db, conv.id, Role.ASSISTANT, "s9 boom FAILED-MARK " + "f" * 800,
                         user_id=user_id, status=MessageStatus.FAILED)
    failed.error = "provider blew up"
    db.commit()
    assert active_path(db, conv.id, user_id)[-1].id == failed.id
    compaction.set_summarizer(_fake_summarizer())
    assert client.post(f"/api/v1/conversations/{conv.id}/compact").status_code == 200
    db.expire_all()
    users_before = [m.id for m in conv_service.list_messages(db, conv.id, user_id)
                    if m.role == Role.USER]

    p, m = _provider_model(db, provider, model)
    monkeypatch.setattr(gateway_service, "build_adapter", lambda *a, **k: _StreamFake("recovered"))
    key_id = ensure_primary_key(db, user_id).id

    async def _regen_failed():
        started = await gateway_service.start_regeneration(
            db, failed.id, user_id=user_id, provider_id=p.id, model_id=m.id, key_id=key_id)
        active = generation_engine.manager.get(started.message_id)
        if active is not None and active.task is not None:
            await active.task
        return started

    started = asyncio.run(_regen_failed())
    db.expire_all()

    orig = conv_service.get_message(db, failed.id, user_id)
    assert orig.status == MessageStatus.FAILED  # never rewritten as success
    assert orig.error == "provider blew up" and "FAILED-MARK" in orig.content
    retry = conv_service.get_message(db, started.message_id, user_id)
    assert retry.status == MessageStatus.COMPLETED and retry.content == "recovered"
    assert retry.parent_message_id == orig.parent_message_id == u2.id
    assert retry.version_number == orig.version_number + 1
    assert conv_service.conversation_tree(db, conv.id, user_id)["active_leaf_id"] == retry.id
    assert [m.id for m in conv_service.list_messages(db, conv.id, user_id)
            if m.role == Role.USER] == users_before  # regen adds no user row


# --- S10: concurrency -----------------------------------------------------------


def test_s10_double_manual_serial_race_single_summary_leaf(
    db, client, user_factory, provider_factory, model_factory
):
    """S10: two manual compacts from independent sessions over the same
    coverage — exactly one persists; the loser 409s; the leaf is the winner."""
    user_id, provider, model = _owned(
        db, client, user_factory, provider_factory, model_factory,
        context_window=WINDOW, email="s10double@tollma.ai")
    conv = _conv(db, user_id, provider, model)
    for i in range(3):
        add_message(db, conv.id, Role.USER, f"s10 q{i} " + "q" * 620, user_id=user_id)
        add_message(db, conv.id, Role.ASSISTANT, f"s10 a{i} " + "a" * 620, user_id=user_id)
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

        await asyncio.gather(_one(0, maker()), _one(1, maker()))

    asyncio.run(_main())
    assert sorted(outcomes) == [0, 1]
    oks = [v for v in outcomes.values() if v[0] == "ok"]
    assert len(oks) == 1
    db.expire_all()
    summaries = [m for m in conv_service.list_messages(db, conv.id, user_id) if m.role == Role.SUMMARY]
    assert [s.id for s in summaries] == [oks[0][1]]
    assert db.get(conv_service.Conversation, conv.id).active_leaf_message_id == oks[0][1]


def test_s10_auto_vs_manual_race_exactly_once(
    db, client, user_factory, provider_factory, model_factory
):
    """S10: an auto ensure_budget racing a manual compact performs exactly one
    persist — no duplicate summaries, no partial context."""
    user_id, provider, model = _owned(
        db, client, user_factory, provider_factory, model_factory,
        context_window=WINDOW, email="s10race@tollma.ai")
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
                    adapter=_adapter_ns(), pending=ChatMessage(role="user", content="b" * 736))
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
    assert (outcomes["manual"][0] == "ok") != (outcomes["auto"][0] == "compacted")


def test_s10_message_during_summarize_aborts_no_partial(
    db, client, user_factory, provider_factory, model_factory
):
    """S10: a message landing mid-summarize moves the tip — phase 2 sees the
    stale tip and 409s: no summary row, the new message intact, leaf on it."""
    user_id, provider, model = _owned(
        db, client, user_factory, provider_factory, model_factory,
        context_window=WINDOW, email="s10msg@tollma.ai")
    conv = _conv(db, user_id, provider, model)
    for i in range(3):
        add_message(db, conv.id, Role.USER, f"s10 q{i} " + "q" * 620, user_id=user_id)
        add_message(db, conv.id, Role.ASSISTANT, f"s10 a{i} " + "a" * 620, user_id=user_id)
    before = len(conv_service.list_messages(db, conv.id, user_id))

    async def _sneaky(adapter, instruction, transcript):
        add_message(db, conv.id, Role.USER, "mid-compact arrival", user_id=user_id)
        return "stale summary that must never attach"

    compaction.set_summarizer(_sneaky)
    r = client.post(f"/api/v1/conversations/{conv.id}/compact")
    assert r.status_code == 409, r.text
    db.expire_all()
    rows = conv_service.list_messages(db, conv.id, user_id)
    assert len(rows) == before + 1 and not [m for m in rows if m.role == Role.SUMMARY]
    assert rows[-1].content == "mid-compact arrival"
    assert db.get(conv_service.Conversation, conv.id).active_leaf_message_id == rows[-1].id


def test_s10_branch_switch_during_summarize_aborts_no_contamination(
    db, client, user_factory, provider_factory, model_factory
):
    """S10: a branch switch mid-summarize 409s the stale persist; the summary
    never attaches to the wrong branch; the switched-to branch stays clean."""
    user_id, provider, model = _owned(
        db, client, user_factory, provider_factory, model_factory,
        context_window=WINDOW, email="s10branch@tollma.ai")
    conv = _conv(db, user_id, provider, model)
    for i in range(3):
        add_message(db, conv.id, Role.USER, f"s10 q{i} " + "q" * 620, user_id=user_id)
        add_message(db, conv.id, Role.ASSISTANT, f"s10 a{i} " + "a" * 620, user_id=user_id)
    rows = active_path(db, conv.id, user_id)
    divergent = add_message(db, conv.id, Role.USER, "s10 divergent " + "d" * 100,
                            user_id=user_id, parent_message_id=rows[0].id,
                            use_active_leaf=False)
    conv_service.select_message(db, conv.id, rows[-1].id, user_id)

    async def _sneaky(adapter, instruction, transcript):
        conv_service.select_message(db, conv.id, divergent.id, user_id)
        return "stale summary for the wrong branch"

    compaction.set_summarizer(_sneaky)
    r = client.post(f"/api/v1/conversations/{conv.id}/compact")
    assert r.status_code == 409, r.text
    db.expire_all()
    assert not [m for m in conv_service.list_messages(db, conv.id, user_id) if m.role == Role.SUMMARY]
    # Leaf stays where the switch put it; its path has no summary.
    assert db.get(conv_service.Conversation, conv.id).active_leaf_message_id == divergent.id
    assert "summary" not in [m["role"] for m in client.get(
        f"/api/v1/conversations/{conv.id}/path").json()["path"]]


def test_s10_regen_spawn_during_summarize_aborts(
    db, client, user_factory, provider_factory, model_factory
):
    """S10: a regeneration starting mid-summarize inserts its RUNNING row the
    same way any spawn does — phase 2 sees the active generation and 409s, so
    the stale summary never becomes context under a live regen."""
    user_id, provider, model = _owned(
        db, client, user_factory, provider_factory, model_factory,
        context_window=WINDOW, email="s10regen@tollma.ai")
    conv = _conv(db, user_id, provider, model)
    for i in range(3):
        add_message(db, conv.id, Role.USER, f"s10 q{i} " + "q" * 620, user_id=user_id)
        add_message(db, conv.id, Role.ASSISTANT, f"s10 a{i} " + "a" * 620, user_id=user_id)

    async def _sneaky(adapter, instruction, transcript):
        add_message(db, conv.id, Role.ASSISTANT, "", user_id=user_id,
                    status=MessageStatus.RUNNING)
        return "stale summary under a live regen"

    compaction.set_summarizer(_sneaky)
    r = client.post(f"/api/v1/conversations/{conv.id}/compact")
    assert r.status_code == 409, r.text
    db.expire_all()
    rows = conv_service.list_messages(db, conv.id, user_id)
    assert not [m for m in rows if m.role == Role.SUMMARY]
    running = [m for m in rows if m.status == MessageStatus.RUNNING]
    assert len(running) == 1  # the regen's row stands alone, unadopted by any summary


def test_s10_stale_snapshot_retry_fenced_no_duplicate(
    db, client, user_factory, provider_factory, model_factory
):
    """S10: retrying with a stale explicit chain after the coverage moved
    409s instead of orphaning a duplicate sibling; a fresh retry then reports
    the already-compacted state without adding rows."""
    user_id, provider, model = _owned(
        db, client, user_factory, provider_factory, model_factory,
        context_window=WINDOW, email="s10stale@tollma.ai")
    conv = _conv(db, user_id, provider, model)
    for i in range(3):
        add_message(db, conv.id, Role.USER, f"s10 q{i} " + "q" * 620, user_id=user_id)
        add_message(db, conv.id, Role.ASSISTANT, f"s10 a{i} " + "a" * 620, user_id=user_id)
    p, m = _provider_model(db, provider, model)
    stale_rows = list(active_path(db, conv.id, user_id))
    compaction.set_summarizer(_fake_summarizer())
    kwargs = dict(conv_id=conv.id, user_id=user_id, trigger="manual",
                  provider=p, model=m, adapter=_adapter_ns(), window=WINDOW, min_ratio=None)

    async def _main():
        first = await compaction.compact_conversation(db, rows=list(stale_rows), **kwargs)
        try:
            await compaction.compact_conversation(db, rows=list(stale_rows), **kwargs)
            return first, "ok"
        except ConflictError:
            db.rollback()
            return first, "conflict"

    first, outcome = asyncio.run(_main())
    assert outcome == "conflict"
    db.expire_all()
    summaries = [r for r in conv_service.list_messages(db, conv.id, user_id) if r.role == Role.SUMMARY]
    assert [s.id for s in summaries] == [first.summary_message_id]
    assert summaries[0].parent_message_id == stale_rows[-1].id
    # Fresh retry sees the already-compacted state (no new coverage), not a persist.
    r = client.post(f"/api/v1/conversations/{conv.id}/compact")
    assert r.status_code == 409, r.text
    assert "already compacted" in r.json()["error"]["message"]
    assert len([m for m in conv_service.list_messages(db, conv.id, user_id)
                if m.role == Role.SUMMARY]) == 1


def test_s10_duplicate_client_key_adopts_then_compacts_cleanly(
    db, client, user_factory, provider_factory, model_factory, monkeypatch
):
    """S10: same client_key retries adopt the single in-flight row (no dup
    user/assistant rows); after completion a compaction covers the adopted
    history exactly once with the leaf on the summary."""
    user_factory(email="s10key@tollma.ai")
    provider = provider_factory()
    model = model_factory(provider["id"])
    monkeypatch.setattr(gateway_service, "build_adapter", lambda *a, **k: _StreamFake("answer"))
    ckey = f"key-{uuid.uuid4().hex}"

    from tollms.api.gateway.schemas import ChatRequest

    def _req(key):
        return ChatRequest(provider_id=uuid.UUID(provider["id"]), model_id=uuid.UUID(model["id"]),
                           message="s10 keyed send " + "k" * 3000, client_key=key)

    async def _main():
        first = await gateway_service.start_generation(db, _req(ckey))
        second = await gateway_service.start_generation(db, _req(ckey))
        assert second.generation_id == first.generation_id
        active = generation_engine.manager.get(first.generation_id)
        await active.task
        return first

    started = asyncio.run(_main())
    db.expire_all()
    assistants = [m for m in conv_service.list_messages(db, started.conversation_id)
                  if m.role == Role.ASSISTANT]
    assert len(assistants) == 1 and assistants[0].status == MessageStatus.COMPLETED
    users = [m for m in conv_service.list_messages(db, started.conversation_id)
             if m.role == Role.USER]
    assert len(users) == 1  # retry adopted: no duplicate user row

    p, m = _provider_model(db, provider, model)
    compaction.set_summarizer(_fake_summarizer())
    result = asyncio.run(compaction.compact_conversation(
        db, conv_id=started.conversation_id, user_id=None, trigger="manual",
        provider=p, model=m, adapter=_adapter_ns(), window=WINDOW, min_ratio=None))
    db.expire_all()
    assert result.status == "completed"
    summaries = [r for r in conv_service.list_messages(db, started.conversation_id)
                 if r.role == Role.SUMMARY]
    assert len(summaries) == 1
    assert db.get(conv_service.Conversation, started.conversation_id).active_leaf_message_id == result.summary_message_id
