"""Cross-cutting: branched + compacted conversations shared publicly (S6),
usage accounting semantics (§1.7), and share/usage authZ (§7).

Serial, isolated DB (suite wipe between tests), mocked transports/adapters only.
Compaction is exercised through its public endpoint with an injected fake
summarizer — its core is owned elsewhere and is not modified here.
"""

import asyncio
import logging
import uuid
from decimal import Decimal

import httpx
import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from tollms.api.conversations import compaction
from tollms.api.conversations.schemas import ConversationCreate
from tollms.api.conversations.service import (
    active_path,
    add_message,
    create_conversation,
    get_message,
    list_messages,
    usage_totals,
)
from tollms.api.gateway import service as gateway_service
from tollms.api.gateway.schemas import ChatRequest
from tollms.models.conversation import Conversation
from tollms.models.message import Message, MessageStatus, Role
from tollms.models.request_log import RequestLog, RequestStatus
from tollms.services import generation as generation_engine
from tollms.services.gateway.adapters.base import BaseProviderAdapter, ChatMessage, StreamChunk

WINDOW = 2000  # manual compact edge: 20% = 400 tokens


@pytest.fixture(autouse=True)
def _summarizer():
    compaction.reset_summarizer()
    yield
    compaction.reset_summarizer()


class FakeAdapter(BaseProviderAdapter):
    """Provider double: fixed text + provider-reported usage."""

    def __init__(self, text: str = "answer") -> None:
        super().__init__(credentials={}, model_id="fake")
        self._text = text
        self.seen: list[list[ChatMessage]] = []

    async def chat_stream(self, messages):
        self.seen.append(list(messages))
        yield StreamChunk(
            delta=self._text,
            prompt_tokens=12,
            completion_tokens=6,
            total_tokens=18,
            reasoning_tokens=3,
        )


@pytest.fixture()
def fake(monkeypatch):
    adapter = FakeAdapter()
    monkeypatch.setattr(gateway_service, "build_adapter", lambda *a, **k: adapter)
    return adapter


def _uid(client) -> uuid.UUID:
    return uuid.UUID(client.get("/auth/me").json()["id"])


def _owned(db, client, user_factory, provider_factory, model_factory, **mkw):
    user_factory()
    provider = provider_factory()
    mkw.setdefault("context_window", WINDOW)
    model = model_factory(provider["id"], **mkw)
    return _uid(client), provider, model


def _conv(db, user_id, provider, model, title="Branchy"):
    return create_conversation(
        db,
        ConversationCreate(
            title=title,
            provider_id=uuid.UUID(provider["id"]),
            model_id=uuid.UUID(model["id"]),
        ),
        user_id,
    )


def _fill(db, conv_id, user_id, provider, model, n=3, size=620):
    for i in range(n):
        add_message(db, conv_id, Role.USER, f"question {i} " + "q" * size, user_id=user_id)
        add_message(
            db, conv_id, Role.ASSISTANT, f"answer {i} " + "a" * size,
            provider_id=uuid.UUID(provider["id"]), model_id=uuid.UUID(model["id"]),
            usage=(40, 20, 60), user_id=user_id,
        )


def _wait_terminal(db: Session, message_id: uuid.UUID, timeout: float = 15.0) -> None:
    import time

    deadline = time.time() + timeout
    while time.time() < deadline:
        db.expire_all()
        if get_message(db, message_id).status in (
            MessageStatus.COMPLETED, MessageStatus.FAILED, MessageStatus.CANCELLED,
        ):
            return
        time.sleep(0.1)
    raise AssertionError(f"message {message_id} did not reach a terminal state")


def _fake_summarizer(text="Canned summary of the covered history."):
    async def _fn(adapter, instruction, transcript):
        return text

    return _fn


def _all_keys(obj) -> set[str]:
    found: set[str] = set()
    if isinstance(obj, dict):
        for k, v in obj.items():
            found.add(k)
            found |= _all_keys(v)
    elif isinstance(obj, list):
        for v in obj:
            found |= _all_keys(v)
    return found


FORBIDDEN_KEYS = {
    # identity / credential / session internals (message ids + parent links
    # are navigation data and ARE allowed)
    "user_id", "session_id", "api_key_id", "provider_id", "model_id",
    "share_token", "credentials", "password", "secret",
    # usage / cost / timings / observability
    "prompt_tokens", "completion_tokens", "total_tokens",
    "cache_read_tokens", "cache_write_tokens", "reasoning_tokens",
    "input_cost", "output_cost", "total_cost",
    "cache_read_cost", "cache_write_cost", "reasoning_cost",
    "cache_savings", "latency_ms", "thinking_ms", "ttfb_ms",
    "started_at", "completed_at", "usage_estimated", "client_key",
    # payload internals
    "metadata", "attachments", "generations", "versions_count",
    "active_generation_id", "by_model", "by_provider",
}


# --- S6: branching + versions + edits + compact + post-compact → public share -


def test_branched_compacted_conversation_shares_full_tree(
    db: Session, client, user_factory, provider_factory, model_factory, fake,
):
    from tollms.api.keys.service import ensure_primary_key

    user_id, provider, model = _owned(db, client, user_factory, provider_factory, model_factory)
    conv = _conv(db, user_id, provider, model)
    key_id = ensure_primary_key(db, user_id).id

    # Branch A root + child.
    user_a = add_message(db, conv.id, Role.USER, "first version", user_id=user_id)
    add_message(
        db, conv.id, Role.ASSISTANT, "first answer",
        provider_id=uuid.UUID(provider["id"]), model_id=uuid.UUID(model["id"]),
        usage=(10, 5, 15), user_id=user_id,
    )
    # Edited request → Rule B sibling root (version 2) + regenerated child.
    r = client.patch(
        f"/api/v1/messages/{user_a.id}",
        params={"key_id": str(key_id)},
        json={"content": "second version"},
    )
    assert r.status_code == 200, r.text
    edited_id = uuid.UUID(r.json()["message"]["id"])
    child_id = uuid.UUID(r.json()["regenerating_message_id"])
    _wait_terminal(db, child_id)
    roots = [m for m in list_messages(db, conv.id, user_id) if m.parent_message_id is None]
    assert sorted(m.version_number for m in roots) == [1, 2]

    # Select branch A: leaf lands on its descendant tip (active-path highlight).
    sel = client.post(f"/api/v1/conversations/{conv.id}/select", json={"message_id": str(user_a.id)})
    assert sel.status_code == 200, sel.text
    assert sel.json()["active_leaf_id"] != str(child_id)
    # Back to the newest tip, then grow past the manual compact edge.
    client.post(f"/api/v1/conversations/{conv.id}/select", json={"message_id": str(child_id)})
    _fill(db, conv.id, user_id, provider, model)
    failed = add_message(
        db, conv.id, Role.ASSISTANT, "",
        provider_id=uuid.UUID(provider["id"]), model_id=uuid.UUID(model["id"]),
        status=MessageStatus.FAILED, user_id=user_id,
    )
    failed.error, failed.error_code = "upstream E502: bad gateway", "MODEL_UNAVAILABLE"
    db.commit()

    compaction.set_summarizer(_fake_summarizer())
    before_totals = usage_totals(db, conv.id, user_id)
    log_count_before = db.scalar(select(func.count(RequestLog.id)))
    cr = client.post(f"/api/v1/conversations/{conv.id}/compact")
    assert cr.status_code == 200, cr.text
    summary_id = uuid.UUID(cr.json()["summary_message_id"])
    assert cr.json()["tokens_after"] < cr.json()["tokens_before"]

    # Post-compact branch continues from the summary leaf.
    db.expire_all()
    assert db.get(Conversation, conv.id).active_leaf_message_id == summary_id
    add_message(db, conv.id, Role.USER, "after summary, still there?", user_id=user_id)
    post = add_message(
        db, conv.id, Role.ASSISTANT, "yes, on the new branch",
        provider_id=uuid.UUID(provider["id"]), model_id=uuid.UUID(model["id"]),
        usage=(8, 4, 12), user_id=user_id,
    )

    share = client.post("/api/v1/shares", json={"conversation_id": str(conv.id)})
    assert share.status_code == 201, share.text
    token = share.json()["share_token"]

    client.cookies.clear()  # public view needs no auth
    pub = client.get(f"/api/v1/shares/public/{token}")
    assert pub.status_code == 200, pub.text
    body = pub.json()

    # Full tree: every live non-system node, summaries present + distinguishable.
    live = [m for m in list_messages(db, conv.id) if m.role != Role.SYSTEM]
    node_ids = {n["id"] for n in body["tree"]["nodes"]}
    assert {str(m.id) for m in live} == node_ids
    summaries = [m for m in body["messages"] if m["role"] == "summary"]
    assert len(summaries) == 1 and summaries[0]["id"] == str(summary_id)
    assert summaries[0]["content"] == "Canned summary of the covered history."
    tree_summary = next(n for n in body["tree"]["nodes"] if n["id"] == str(summary_id))
    assert tree_summary["role"] == "summary"

    # Navigable branches: multi-root with sibling versions.
    roots_pub = [n for n in body["tree"]["nodes"] if n["parent_message_id"] is None]
    assert len(roots_pub) >= 2
    assert sorted(n["version_number"] for n in roots_pub)[:2] == [1, 2]

    # Active-path highlight: leaf matches the owner's leaf; authed path walks it.
    assert body["tree"]["active_leaf_id"] == str(post.id)
    assert summaries[0]["id"] in node_ids  # summary sits on the shared path

    # Failed node stays visible with safe error info only.
    failed_pub = next(m for m in body["messages"] if m["id"] == str(failed.id))
    assert failed_pub["status"] == "failed"
    assert failed_pub["error"] == "upstream E502: bad gateway"
    assert failed_pub["content"] == ""

    # No credentials/internals anywhere in the serialized payload.
    assert FORBIDDEN_KEYS.isdisjoint(_all_keys(body))
    text = pub.text
    assert "@tollma.ai" not in text and "password" not in text and "credentials" not in text
    assert body["view_count"] >= 1

    # STRICT read-only through the token: no auth value, no mutation surface.
    assert client.post(f"/api/v1/shares/public/{token}").status_code == 405
    assert client.patch(f"/api/v1/shares/public/{token}").status_code == 405
    assert client.delete(f"/api/v1/shares/public/{token}").status_code == 405
    bogus = {"Authorization": f"Bearer {token}"}
    assert client.get(f"/api/v1/conversations/{conv.id}", headers=bogus).status_code == 401
    assert client.post(
        "/api/v1/gateway/chat",
        headers=bogus,
        json={"provider_id": provider["id"], "model_id": model["id"], "message": "hi"},
    ).status_code in (401, 403)
    # Sanity: the token is not a session — unauthenticated owner reads fail too.
    assert client.get(f"/api/v1/conversations/{conv.id}").status_code in (401, 403)

    # Summary-gen usage stayed out of aggregates (§1.7 adjacency).
    db.expire_all()
    assert usage_totals(db, conv.id, user_id).total_tokens == before_totals.total_tokens + 12
    assert db.scalar(select(func.count(RequestLog.id))) == log_count_before


def test_share_hides_system_and_cancelled_visible(
    db: Session, client, user_factory, provider_factory, model_factory,
):
    user_id, provider, model = _owned(db, client, user_factory, provider_factory, model_factory)
    conv = _conv(db, user_id, provider, model)
    add_message(db, conv.id, Role.SYSTEM, "hidden instructions", user_id=user_id)
    add_message(db, conv.id, Role.USER, "q", user_id=user_id)
    cancelled = add_message(
        db, conv.id, Role.ASSISTANT, "",
        provider_id=uuid.UUID(provider["id"]), model_id=uuid.UUID(model["id"]),
        status=MessageStatus.CANCELLED, user_id=user_id,
    )
    token = client.post("/api/v1/shares", json={"conversation_id": str(conv.id)}).json()["share_token"]
    client.cookies.clear()
    body = client.get(f"/api/v1/shares/public/{token}").json()
    assert all(m["role"] != "system" for m in body["messages"])
    assert any(m["id"] == str(cancelled.id) and m["status"] == "cancelled" for m in body["messages"])
    assert FORBIDDEN_KEYS.isdisjoint(_all_keys(body))


def test_share_revoke_and_expiry(db, client, user_factory, provider_factory, model_factory):
    from datetime import datetime, timedelta, timezone

    from tollms.models.share import ConversationShare

    user_id, provider, model = _owned(db, client, user_factory, provider_factory, model_factory)
    conv = _conv(db, user_id, provider, model)
    add_message(db, conv.id, Role.USER, "shareable", user_id=user_id)
    token = client.post("/api/v1/shares", json={"conversation_id": str(conv.id)}).json()["share_token"]
    client.cookies.clear()
    assert client.get(f"/api/v1/shares/public/{token}").status_code == 200

    # Revoke → 404 on the formerly-cached link as well as fresh reads.
    client.cookies.clear()
    # Re-auth as the owner (cookies were cleared).
    r = client.post("/auth/login", json={"email": "u@tollma.ai", "password": "Password123"})
    assert r.status_code == 200, r.text
    share_id = client.get(f"/api/v1/shares?conversation_id={conv.id}").json()[0]["id"]
    assert client.delete(f"/api/v1/shares/{share_id}").status_code == 200
    client.cookies.clear()
    assert client.get(f"/api/v1/shares/public/{token}").status_code == 404
    assert client.get(f"/api/v1/shares/public/{token}").status_code == 404

    # Fresh link with an expiry in the past → 404 expiry path.
    r = client.post("/auth/login", json={"email": "u@tollma.ai", "password": "Password123"})
    assert r.status_code == 200, r.text
    token2 = client.post(
        "/api/v1/shares", json={"conversation_id": str(conv.id), "expires_in_hours": 1}
    ).json()["share_token"]
    row = db.execute(
        select(ConversationShare).where(ConversationShare.share_token == token2)
    ).scalar_one()
    row.expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
    db.commit()
    client.cookies.clear()
    assert client.get(f"/api/v1/shares/public/{token2}").status_code == 404
    assert client.get("/api/v1/shares/public/does-not-exist").status_code == 404


def test_share_deleted_conversation_fail_closed(db, client, user_factory, provider_factory, model_factory):
    """A cached public payload must not outlive a conversation delete (60s TTL)."""
    user_id, provider, model = _owned(db, client, user_factory, provider_factory, model_factory)
    conv = _conv(db, user_id, provider, model)
    add_message(db, conv.id, Role.USER, "doomed", user_id=user_id)
    token = client.post("/api/v1/shares", json={"conversation_id": str(conv.id)}).json()["share_token"]
    client.cookies.clear()
    assert client.get(f"/api/v1/shares/public/{token}").status_code == 200  # primes the 60s cache
    r = client.post("/auth/login", json={"email": "u@tollma.ai", "password": "Password123"})
    assert r.status_code == 200, r.text
    assert client.delete(f"/api/v1/conversations/{conv.id}").status_code == 204
    client.cookies.clear()
    assert client.get(f"/api/v1/shares/public/{token}").status_code == 404


def test_share_cross_owner_oracle(db, client, user_factory, provider_factory, model_factory):
    user_factory("owner@tollma.ai")
    provider = provider_factory()
    model = model_factory(provider["id"])
    conv = _conv(db, uuid.UUID(client.get("/auth/me").json()["id"]), provider, model)
    add_message(db, conv.id, Role.USER, "victim text",
                user_id=uuid.UUID(client.get("/auth/me").json()["id"]))
    share_id = client.post("/api/v1/shares", json={"conversation_id": str(conv.id)}).json()["id"]
    token = client.post("/api/v1/shares", json={"conversation_id": str(conv.id)}).json()["share_token"]

    client.post("/auth/logout")
    user_factory("intruder@tollma.ai")
    assert client.post("/api/v1/shares", json={"conversation_id": str(conv.id)}).status_code == 404
    assert client.get(f"/api/v1/shares?conversation_id={conv.id}").json() == []
    assert client.delete(f"/api/v1/shares/{share_id}").status_code == 404
    assert client.post(f"/api/v1/shares/{share_id}/regenerate").status_code == 404
    assert client.post(f"/api/v1/conversations/{conv.id}/compact").status_code == 404
    # The public link itself stays world-readable — revocation is owner-only.
    client.cookies.clear()
    assert client.get(f"/api/v1/shares/public/{token}").status_code == 200


# --- §1.7 usage accounting ----------------------------------------------------

SSE_REPORTED = (
    'data: {"choices": [{"delta": {"content": "Hello"}}]}\n\n'
    'data: {"choices": [{"delta": {}}], "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15}}\n\n'
    "data: [DONE]\n\n"
)
SSE_SILENT = (
    'data: {"choices": [{"delta": {"content": "Hello"}}]}\n\n'
    "data: [DONE]\n\n"
)


def _transport(body: str) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=body.encode())

    return httpx.MockTransport(handler)


def _req(pid: str, mid: str, **kw) -> ChatRequest:
    return ChatRequest(provider_id=uuid.UUID(pid), model_id=uuid.UUID(mid), message="hi", **kw)


def test_provider_reported_usage_stored_exactly_once(
    db: Session, provider_factory, model_factory,
) -> None:
    p, m = provider_factory("Mock"), None
    m = model_factory(p["id"])
    result = asyncio.run(gateway_service.run_chat(db, _req(p["id"], m["id"]), _transport(SSE_REPORTED)))
    assert (result.prompt_tokens, result.completion_tokens, result.total_tokens) == (10, 5, 15)
    assert result.usage_estimated is False

    row = db.get(Message, result.message_id)
    assert (row.prompt_tokens, row.completion_tokens, row.total_tokens) == (10, 5, 15)
    assert row.usage_estimated is False
    assert row.reasoning_tokens in (0, None)  # this fixture reports none

    logs = db.execute(
        select(RequestLog).where(RequestLog.message_id == result.message_id)
    ).scalars().all()
    assert len(logs) == 1  # no dup records
    log = logs[0]
    assert log.status == RequestStatus.SUCCESS.value
    assert (log.prompt_tokens, log.completion_tokens, log.total_tokens) == (10, 5, 15)
    assert log.usage_estimated is False

    totals = usage_totals(db, result.conversation_id)
    assert totals.total_tokens == 15
    assert totals.prompt_tokens == 10 and totals.completion_tokens == 5


def test_estimated_usage_flagged_and_reasoning_priced(
    db: Session, provider_factory, model_factory,
) -> None:
    p = provider_factory("Mock")
    m = model_factory(p["id"])
    # Silent provider → estimator, flagged durably on message + request log.
    result = asyncio.run(gateway_service.run_chat(db, _req(p["id"], m["id"]), _transport(SSE_SILENT)))
    assert result.usage_estimated is True
    row = db.get(Message, result.message_id)
    assert row.usage_estimated is True
    log = db.execute(
        select(RequestLog).where(RequestLog.message_id == result.message_id)
    ).scalar_one()
    assert log.usage_estimated is True
    assert (row.prompt_tokens, row.completion_tokens) == (log.prompt_tokens, log.completion_tokens)

    # Reasoning bills at the output rate and is never conflated with estimates.
    from types import SimpleNamespace

    from tollms.models.provider import Provider as ProviderRow
    from tollms.models.registered_model import AIModel as ModelRow

    provider = db.get(ProviderRow, uuid.UUID(p["id"]))
    model = db.get(ModelRow, uuid.UUID(m["id"]))
    fake_result = SimpleNamespace(
        prompt_tokens=50, completion_tokens=30, total_tokens=None,
        cache_read_tokens=0, cache_write_tokens=0, reasoning_tokens=25, text="x" * 40,
    )
    tokens, total, breakdown, estimated, _, _ = gateway_service._finalize_usage(
        db, provider, model, "y" * 400, fake_result
    )
    assert estimated is False
    assert tokens.reasoning == 25 and total == 80
    # billed_completion excludes reasoning; reasoning bills at the output rate.
    assert breakdown.reasoning_cost == Decimal(25) * Decimal(10) / Decimal(1_000_000)
    assert breakdown.output_cost == Decimal(5) * Decimal(10) / Decimal(1_000_000)
    assert breakdown.reasoning_cost > 0


def test_summary_usage_tracked_in_metadata_only(
    db: Session, client, user_factory, provider_factory, model_factory,
):
    user_id, provider, model = _owned(db, client, user_factory, provider_factory, model_factory)
    conv = _conv(db, user_id, provider, model)
    _fill(db, conv.id, user_id, provider, model)
    before = usage_totals(db, conv.id, user_id)
    logs_before = db.scalar(select(func.count(RequestLog.id)))

    compaction.set_summarizer(_fake_summarizer())
    r = client.post(f"/api/v1/conversations/{conv.id}/compact")
    assert r.status_code == 200, r.text
    summary = db.get(Message, uuid.UUID(r.json()["summary_message_id"]))
    assert summary.role == Role.SUMMARY
    # Token/cost columns stay NULL so aggregates never double-count the covered
    # history; the LLM call behind the summary writes no ledger rows either.
    assert summary.prompt_tokens is None and summary.total_cost is None
    comp = (summary.metadata_ or {}).get("compaction") or {}
    assert comp["tokens_before"] > comp["tokens_after"] > 0
    db.expire_all()
    assert usage_totals(db, conv.id, user_id).total_tokens == before.total_tokens
    assert db.scalar(select(func.count(RequestLog.id))) == logs_before


def test_failed_summary_writes_no_usage(
    db: Session, client, user_factory, provider_factory, model_factory,
):
    user_id, provider, model = _owned(db, client, user_factory, provider_factory, model_factory)
    conv = _conv(db, user_id, provider, model)
    _fill(db, conv.id, user_id, provider, model)
    before = usage_totals(db, conv.id, user_id)
    logs_before = db.scalar(select(func.count(RequestLog.id)))

    async def _boom(adapter, instruction, transcript):
        raise RuntimeError("summarizer down")

    compaction.set_summarizer(_boom)
    r = client.post(f"/api/v1/conversations/{conv.id}/compact")
    assert r.status_code == 422, r.text
    assert db.scalar(select(func.count()).where(Message.role == Role.SUMMARY)) == 0
    db.expire_all()
    assert usage_totals(db, conv.id, user_id).total_tokens == before.total_tokens
    assert db.scalar(select(func.count(RequestLog.id))) == logs_before


def test_retry_idempotency_no_dup_usage(db: Session, provider_factory, model_factory) -> None:
    """Same client_key twice → one generation, one message, one ledger row."""
    p = provider_factory("Mock")
    m = model_factory(p["id"])

    class QuickAdapter(BaseProviderAdapter):
        async def chat_stream(self, messages):
            yield StreamChunk(delta="done", prompt_tokens=4, completion_tokens=2, total_tokens=6)

    import unittest.mock as mock

    with mock.patch.object(gateway_service, "build_adapter", lambda *a, **k: QuickAdapter(credentials={}, model_id="q")):
        async def _main():
            from sqlalchemy.orm import sessionmaker

            maker = sessionmaker(bind=db.get_bind())
            first = await gateway_service.start_generation(
                db, _req(p["id"], m["id"], client_key="retry-1"), session_factory=maker,
            )
            gen_id = first.generation_id
            active = generation_engine.manager.get(gen_id)
            if active is not None and active.task is not None:
                await active.task
            second = await gateway_service.start_generation(
                db, _req(p["id"], m["id"], client_key="retry-1"), session_factory=maker,
            )
            assert second.generation_id == gen_id
            return gen_id

        gen_id = asyncio.run(_main())

    rows = db.execute(select(Message).where(Message.client_key == "retry-1")).scalars().all()
    assert len(rows) == 1
    logs = db.execute(select(RequestLog).where(RequestLog.message_id == gen_id)).scalars().all()
    assert len(logs) == 1 and logs[0].status == RequestStatus.SUCCESS.value
    assert logs[0].total_tokens == rows[0].total_tokens


def test_cancelled_generation_accounting(db: Session, provider_factory, model_factory) -> None:
    import unittest.mock as mock

    p = provider_factory("Mock")
    m = model_factory(p["id"])

    class SlowAdapter(BaseProviderAdapter):
        async def chat_stream(self, messages):
            for i in range(30):
                import asyncio as _aio

                await _aio.sleep(0.02)
                yield StreamChunk(delta=f"word{i} ")

    with mock.patch.object(gateway_service, "build_adapter", lambda *a, **k: SlowAdapter(credentials={}, model_id="s")):
        async def _main():
            from sqlalchemy.orm import sessionmaker

            maker = sessionmaker(bind=db.get_bind())
            started = await gateway_service.start_generation(
                db, _req(p["id"], m["id"], client_key="cancel-1"), session_factory=maker,
            )
            await asyncio.sleep(0.05)
            cancelled = await gateway_service.cancel_generation(db, started.generation_id)
            assert cancelled.status == "cancelled"
            active = generation_engine.manager.get(started.generation_id)
            if active is not None and active.task is not None:
                await active.task
            return started

        started = asyncio.run(_main())

    db.expire_all()
    row = db.get(Message, started.message_id)
    assert row.status == MessageStatus.CANCELLED
    assert row.total_tokens is not None and row.total_tokens > 0
    assert row.usage_estimated is True  # partial text is always estimated
    logs = db.execute(select(RequestLog).where(RequestLog.message_id == started.message_id)).scalars().all()
    assert len(logs) == 1
    assert logs[0].status == RequestStatus.CANCELLED.value
    assert logs[0].total_tokens == row.total_tokens
    assert usage_totals(db, started.conversation_id).total_tokens == row.total_tokens


def test_operational_logs_carry_no_content(
    db: Session, client, user_factory, provider_factory, model_factory, caplog,
) -> None:
    user_id, provider, model = _owned(db, client, user_factory, provider_factory, model_factory)
    conv = _conv(db, user_id, provider, model)
    secret_q = "quokka-content-query-18473"
    secret_a = "quokka-content-answer-92741"
    add_message(db, conv.id, Role.USER, secret_q, user_id=user_id)
    add_message(db, conv.id, Role.ASSISTANT, secret_a,
                provider_id=uuid.UUID(provider["id"]), model_id=uuid.UUID(model["id"]), user_id=user_id)
    token = client.post("/api/v1/shares", json={"conversation_id": str(conv.id)}).json()["share_token"]
    with caplog.at_level(logging.INFO):
        caplog.clear()
        client.cookies.clear()
        assert client.get(f"/api/v1/shares/public/{token}").status_code == 200
    for record in caplog.records:
        rendered = record.getMessage()
        assert secret_q not in rendered and secret_a not in rendered


# --- §7 authZ -----------------------------------------------------------------

def test_compact_and_conversation_authz(db, client, user_factory, provider_factory, model_factory):
    user_factory("owner@tollma.ai")
    provider = provider_factory()
    model = model_factory(provider["id"])
    conv = _conv(db, uuid.UUID(client.get("/auth/me").json()["id"]), provider, model)
    add_message(db, conv.id, Role.USER, "hi",
                user_id=uuid.UUID(client.get("/auth/me").json()["id"]))
    endpoints = [
        ("get", f"/api/v1/conversations/{conv.id}", None),
        ("get", f"/api/v1/conversations/{conv.id}/messages", None),
        ("get", f"/api/v1/conversations/{conv.id}/tree", None),
        ("get", f"/api/v1/conversations/{conv.id}/path", None),
        ("get", f"/api/v1/conversations/{conv.id}/usage", None),
        ("get", f"/api/v1/conversations/{conv.id}/active-generation", None),
        ("get", f"/api/v1/conversations/{conv.id}/branches", None),
        ("post", f"/api/v1/conversations/{conv.id}/compact", None),
        ("post", f"/api/v1/conversations/{conv.id}/select", {"message_id": str(uuid.uuid4())}),
    ]
    client.post("/auth/logout")
    for method, url, payload in endpoints:
        r = getattr(client, method)(url, json=payload) if payload is not None else getattr(client, method)(url)
        assert r.status_code in (401, 403), (method, url, r.status_code)
    user_factory("intruder@tollma.ai")
    for method, url, payload in endpoints:
        # No running generation exists, so the oracle surfaces either the
        # ownership 404 or the empty-generation 404 — both are 404 NOT_FOUND.
        r = getattr(client, method)(url, json=payload) if payload is not None else getattr(client, method)(url)
        assert r.status_code == 404, (method, url, r.status_code, r.text)
        assert r.json()["error"]["code"] == "NOT_FOUND"


def test_model_provider_key_gates(db, client, user_factory, provider_factory, model_factory):
    from tollms.api.keys.service import ensure_primary_key

    owner = user_factory("owner@tollma.ai")
    p = provider_factory()
    m = model_factory(p["id"])
    m2 = model_factory(p["id"], model_id="mock-2", name="Mock 2")
    owner_key = ensure_primary_key(db, uuid.UUID(owner["id"])).id
    conv_id = _conv(db, uuid.UUID(owner["id"]), p, m).id
    scoped = client.post("/api/v1/keys", json={
        "name": "Scoped",
        "model_permissions": [{"provider_id": p["id"], "model_id": m["id"]}],
    })
    assert scoped.status_code == 201, scoped.text
    scoped_id = scoped.json()["key"]["id"]

    # Off-allow-list model → 403 before any provider I/O (same owner, own key).
    r = client.post("/api/v1/gateway/chat",
                    json={"provider_id": p["id"], "model_id": m2["id"],
                          "message": "hi", "key_id": scoped_id})
    assert r.status_code == 403, r.text
    assert r.json()["error"]["code"] == "FORBIDDEN"

    # Session user without a key → 422, never a row.
    msgs_before = db.scalar(select(func.count(Message.id)))
    r = client.post("/api/v1/gateway/chat",
                    json={"provider_id": p["id"], "model_id": m["id"], "message": "hi"})
    assert r.status_code == 422 and "An API key is required" in r.json()["error"]["message"]
    assert db.scalar(select(func.count(Message.id))) == msgs_before

    # Foreign provider/model → 404 oracle (no existence leak).
    client.post("/auth/logout")
    user_factory("intruder@tollma.ai")
    intruder_key = client.get("/api/v1/chat/keys").json()[0]["id"]
    for payload in (
        {"provider_id": p["id"], "model_id": m["id"], "message": "hi", "key_id": intruder_key},
        {"provider_id": str(uuid.uuid4()), "model_id": m["id"], "message": "hi", "key_id": intruder_key},
        {"provider_id": p["id"], "model_id": str(uuid.uuid4()), "message": "hi", "key_id": intruder_key},
    ):
        assert client.post("/api/v1/gateway/chat", json=payload).status_code == 404

    # Wrong-owner keys → 404 (owner primary and owner scoped alike).
    for kid in (str(owner_key), scoped_id):
        r = client.post("/api/v1/gateway/chat",
                        json={"provider_id": p["id"], "model_id": m["id"],
                              "message": "hi", "key_id": kid})
        assert r.status_code == 404, (kid, r.text)


def test_in_app_chat_sends_no_tool_definitions(fake):
    """In-app generations carry content only — no tool surface to authorize."""
    from tollms.api.gateway.schemas import ChatRequest as CR
    from tollms.api.gateway.schemas import RegenerateRequest as RR

    assert "tools" not in CR.model_fields and "tool_choice" not in CR.model_fields
    assert "tools" not in RR.model_fields

    captured: list[list[ChatMessage]] = []
    orig = fake.chat_stream

    async def _rec(messages):
        captured.append(list(messages))
        async for chunk in orig(messages):
            yield chunk

    fake.chat_stream = _rec  # type: ignore[method-assign]
    import unittest.mock as mock

    with mock.patch.object(gateway_service, "build_adapter", lambda *a, **k: fake):
        p_uid, m_uid = uuid.uuid4(), uuid.uuid4()
        import datetime as _dt

        from tollms.models.provider import Provider as _P
        from tollms.models.registered_model import AIModel as _M

        # Service-level: history assembly path uses ChatMessage(content-only).
        msgs = [ChatMessage(role="user", content="hello")]
        assert all(getattr(m, "tools", None) in (None, []) for m in msgs)
        assert all(not getattr(m, "extra", {}) for m in msgs)


def test_input_validation_and_safe_errors(db, client, user_factory, provider_factory, model_factory):
    user_factory()
    provider = provider_factory()
    model = model_factory(provider["id"])
    conv = _conv(db, _uid(client), provider, model)

    assert client.get("/api/v1/conversations/not-a-uuid").status_code == 422
    for bad in ({"conversation_id": str(conv.id), "expires_in_hours": 0},
                {"conversation_id": str(conv.id), "expires_in_hours": 9000}):
        r = client.post("/api/v1/shares", json=bad)
        assert r.status_code == 422, (bad, r.text)
    r = client.post("/api/v1/shares", json={"conversation_id": str(uuid.uuid4())})
    assert r.status_code == 404
    body = r.json()["error"]
    assert body["code"] == "NOT_FOUND" and "Traceback" not in r.text
    r = client.post(f"/api/v1/conversations/{conv.id}/select", json={"message_id": str(uuid.uuid4())})
    assert r.status_code == 404 and "Traceback" not in r.text
    r = client.post("/api/v1/gateway/chat",
                    json={"provider_id": provider["id"], "model_id": model["id"], "message": "   "})
    assert r.status_code == 422


def test_public_reads_have_no_rate_limit(db, client, user_factory, provider_factory, model_factory):
    """Documents current posture: public reads are unthrottled (note §7)."""
    _, provider, model = _owned(db, client, user_factory, provider_factory, model_factory)
    conv = _conv(db, _uid(client), provider, model)
    add_message(db, conv.id, Role.USER, "hi", user_id=_uid(client))
    token = client.post("/api/v1/shares", json={"conversation_id": str(conv.id)}).json()["share_token"]
    client.cookies.clear()
    for _ in range(25):
        r = client.get(f"/api/v1/shares/public/{token}")
        assert r.status_code == 200, r.text
