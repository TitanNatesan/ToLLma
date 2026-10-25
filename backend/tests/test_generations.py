"""Generation lifecycle: backend-owned streaming, cancel, recovery.

A slow fake adapter stands in for providers. Every test drives the real
engine (background task + progressive persistence + Valkey active-state).
"""

import asyncio
import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from tollms.api.conversations.service import get_message, list_messages
from tollms.api.gateway import service as gateway_service
from tollms.api.gateway.schemas import ChatRequest
from tollms.core.exceptions import ConflictError, NotFoundError
from tollms.models.message import MessageStatus
from tollms.models.request_log import RequestLog, RequestStatus
from tollms.services import generation as generation_engine
from tollms.services.cache import keys as cache_keys
from tollms.services.cache.manager import cache_get_sync
from tollms.services.gateway.adapters.base import BaseProviderAdapter, StreamChunk


class SlowAdapter(BaseProviderAdapter):
    """Controllable provider stream: N chunks, optional delay/failure."""

    def __init__(self, chunks: list[str], delay: float = 0.0, fail_after: int | None = None) -> None:
        super().__init__(credentials={}, model_id="slow-mock")
        self._chunks = chunks
        self._delay = delay
        self._fail_after = fail_after

    async def chat_stream(self, messages):
        for i, text in enumerate(self._chunks):
            if self._fail_after is not None and i == self._fail_after:
                raise RuntimeError("provider blew up")
            if self._delay:
                await asyncio.sleep(self._delay)
            yield StreamChunk(delta=text)


def _request(provider_id: str, model_id: str, **kw) -> ChatRequest:
    return ChatRequest(
        provider_id=uuid.UUID(provider_id), model_id=uuid.UUID(model_id), message="go", **kw
    )


@pytest.fixture()
def slow(monkeypatch) -> SlowAdapter:
    adapter = SlowAdapter([f"chunk{i} " for i in range(30)], delay=0.02)
    monkeypatch.setattr(gateway_service, "build_adapter", lambda *a, **k: adapter)
    return adapter


@pytest.fixture()
def maker(db: Session):
    return sessionmaker(bind=db.get_bind())


def _fresh(maker, row_id: uuid.UUID):
    session = maker()
    try:
        return get_message(session, row_id)
    finally:
        session.close()




async def _await_task(generation_id: uuid.UUID) -> None:
    """Wait for the driver task. Already finished (fast cancels pop the
    registry entry before this runs) — nothing to wait for; the DB row holds
    the terminal state the caller asserts."""
    active = generation_engine.manager.get(generation_id)
    if active is None or active.task is None:
        return
    await active.task

def _drain(events):
    """Collect an SSE event stream to its terminal event."""
    collected = []

    async def _go():
        async for raw in events:
            assert raw.startswith("data: ")
            import json

            collected.append(json.loads(raw[6:]))
            if collected[-1].get("done"):
                break
        return collected

    return asyncio.run(_go())


def test_start_creates_running_row_upfront(db: Session, provider_factory, model_factory, slow, maker) -> None:
    p = provider_factory("Mock")
    m = model_factory(p["id"])

    async def _main():
        started = await gateway_service.start_generation(db, _request(p["id"], m["id"]))
        assert started.status == "running"
        assistant = _fresh(maker, started.message_id)
        assert assistant.status == MessageStatus.RUNNING
        assert assistant.content == ""
        assert assistant.started_at is not None
        assert assistant.completed_at is None
        roles = [msg.role.value for msg in list_messages(db, started.conversation_id)]
        assert roles == ["user", "assistant"]
        # Valkey active-state pointer written (background task needs a tick).
        # The pointer clears at terminal, so stop polling once it appears
        # or the task finishes — whichever comes first.
        seen_pointer = False
        for _ in range(100):
            if cache_get_sync(cache_keys.generation_by_conversation(started.conversation_id)):
                seen_pointer = True
                break
            active = generation_engine.manager.get(started.generation_id)
            if active is None or (active.task is not None and active.task.done()):
                break
            await asyncio.sleep(0.05)
        await _await_task(started.generation_id)
        assert seen_pointer or _fresh(maker, started.message_id).status == MessageStatus.COMPLETED
        return started

    started = asyncio.run(_main())
    events = _drain(gateway_service.stream_events(db, started.generation_id))
    assert events[-1]["status"] == "completed"
    assistant = _fresh(maker, started.message_id)
    assert assistant.status == MessageStatus.COMPLETED
    assert assistant.content == "".join(f"chunk{i} " for i in range(30))
    assert assistant.completed_at is not None
    assert assistant.total_tokens is not None


def test_progress_persists_while_running(db: Session, provider_factory, model_factory, slow, maker) -> None:
    p = provider_factory("Mock")
    m = model_factory(p["id"])

    async def _main():
        started = await gateway_service.start_generation(db, _request(p["id"], m["id"]))
        await asyncio.sleep(0.25)  # several chunks flushed, stream still going
        mid = _fresh(maker, started.message_id)
        assert mid.status == MessageStatus.RUNNING
        assert 0 < len(mid.content) < len("".join(f"chunk{i} " for i in range(30)))
        await _await_task(started.generation_id)
        return started

    started = asyncio.run(_main())
    final = _fresh(maker, started.message_id)
    assert final.status == MessageStatus.COMPLETED
    assert final.content == "".join(f"chunk{i} " for i in range(30))


def test_cancel_persists_partial_as_cancelled(
    db: Session, provider_factory, model_factory, slow, maker
) -> None:
    p = provider_factory("Mock")
    m = model_factory(p["id"])

    async def _main():
        started = await gateway_service.start_generation(db, _request(p["id"], m["id"]))
        # Wait until at least one progress flush landed (load-independent),
        # then cancel mid-stream: the partial text must survive.
        for _ in range(200):
            if _fresh(maker, started.message_id).content:
                break
            await asyncio.sleep(0.01)
        cancelled = await gateway_service.cancel_generation(db, started.generation_id)
        assert cancelled.status == "cancelled"
        await _await_task(started.generation_id)
        return started

    started = asyncio.run(_main())
    row = _fresh(maker, started.message_id)
    assert row.status == MessageStatus.CANCELLED
    assert 0 < len(row.content) < len("".join(f"chunk{i} " for i in range(30)))
    assert row.completed_at is not None
    assert row.total_tokens is not None  # estimated usage kept for cost history
    # Idempotent: cancelling again reports the terminal state.
    again = asyncio.run(gateway_service.cancel_generation(db, started.message_id))
    assert again.status == "cancelled"


def test_disconnect_keeps_generation_running(db: Session, provider_factory, model_factory, slow, maker) -> None:
    p = provider_factory("Mock")
    m = model_factory(p["id"])

    async def _main():
        started = await gateway_service.start_generation(db, _request(p["id"], m["id"]))
        agen = gateway_service.stream_events(db, started.generation_id)
        first = await agen.__anext__()  # meta
        assert "conversation_id" in first
        await getattr(agen, "aclose")()  # client went away (refresh/tab close)
        assert generation_engine.manager.get(started.generation_id) is not None
        await _await_task(started.generation_id)
        return started

    started = asyncio.run(_main())
    row = _fresh(maker, started.message_id)
    assert row.status == MessageStatus.COMPLETED
    assert row.content == "".join(f"chunk{i} " for i in range(30))


def test_reattach_receives_snapshot_then_live(
    db: Session, provider_factory, model_factory, slow, maker
) -> None:
    p = provider_factory("Mock")
    m = model_factory(p["id"])
    full = "".join(f"chunk{i} " for i in range(30))

    async def _main():
        import json

        started = await gateway_service.start_generation(db, _request(p["id"], m["id"]))
        live = gateway_service.stream_events(db, started.generation_id)
        await live.__anext__()  # meta
        second = await live.__anext__()  # first delta
        assert json.loads(second[6:])["delta"].startswith("chunk")
        await asyncio.sleep(0.4)  # let a progress flush land before reattaching
        # A second viewer reattaches mid-stream: snapshot + rest.
        reattached = []
        async for raw in gateway_service.reattach_events(db, started.generation_id):
            reattached.append(json.loads(raw[6:]))
            if reattached[-1].get("done"):
                break
        await getattr(live, "aclose")()
        await _await_task(started.generation_id)
        snapshot = reattached[1]
        assert snapshot["content"].startswith("chunk")
        rest = "".join(e.get("delta", "") for e in reattached[2:])
        assert snapshot["content"] + rest == full
        assert reattached[-1]["status"] == "completed"
        return started

    asyncio.run(_main())


def test_second_start_conflicts_while_running(
    db: Session, provider_factory, model_factory, slow, maker
) -> None:
    p = provider_factory("Mock")
    m = model_factory(p["id"])
    req = _request(p["id"], m["id"])

    async def _main():
        started = await gateway_service.start_generation(db, req)
        with pytest.raises(ConflictError):
            await gateway_service.start_generation(
                db,
                ChatRequest(
                    provider_id=uuid.UUID(p["id"]),
                    model_id=uuid.UUID(m["id"]),
                    message="again",
                    conversation_id=started.conversation_id,
                ),
            )
        await _await_task(started.generation_id)
        return started

    asyncio.run(_main())


def test_provider_failure_marks_failed_with_partial(
    db: Session, provider_factory, model_factory, monkeypatch, maker
) -> None:
    p = provider_factory("Mock")
    m = model_factory(p["id"])
    adapter = SlowAdapter(["keep ", "this ", "boom"], fail_after=2)
    monkeypatch.setattr(gateway_service, "build_adapter", lambda *a, **k: adapter)

    async def _main():
        started = await gateway_service.start_generation(db, _request(p["id"], m["id"]))
        events = []
        import json

        async for raw in gateway_service.stream_events(db, started.generation_id):
            events.append(json.loads(raw[6:]))
            if events[-1].get("done"):
                break
        return started, events

    started, events = asyncio.run(_main())
    assert events[-1]["status"] == "failed"
    assert "blew up" in events[-1]["error"]
    row = _fresh(maker, started.message_id)
    assert row.status == MessageStatus.FAILED
    assert row.content == "keep this "
    assert row.error is not None


def test_active_generation_lookup_and_404(db: Session, provider_factory, model_factory, slow) -> None:
    p = provider_factory("Mock")
    m = model_factory(p["id"])

    async def _main():
        started = await gateway_service.start_generation(db, _request(p["id"], m["id"]))
        live = gateway_service.active_generation(db, started.conversation_id)
        assert live.generation_id == started.generation_id
        assert live.status == "running"
        assert live.current_content == ""
        await _await_task(started.generation_id)
        return started

    started = asyncio.run(_main())
    with pytest.raises(NotFoundError):
        gateway_service.active_generation(db, started.conversation_id)


def test_sweep_marks_stale_running_failed(db: Session, provider_factory, model_factory) -> None:
    from tollms.api.conversations.service import add_message, create_conversation
    from tollms.api.conversations.schemas import ConversationCreate
    from tollms.models.message import Role

    conv = create_conversation(db, ConversationCreate(title="stale"))
    row = add_message(db, conv.id, Role.ASSISTANT, "partial", status=MessageStatus.RUNNING)
    marked = generation_engine.sweep_stale_running(db, reason="backend restarted")
    assert marked == 1
    assert get_message(db, row.id).status == MessageStatus.FAILED


def test_cancel_unknown_generation_404s(db: Session) -> None:
    with pytest.raises(NotFoundError):
        asyncio.run(gateway_service.cancel_generation(db, uuid.uuid4()))


def _keyed_request(provider_id: str, model_id: str, client_key: str) -> ChatRequest:
    return ChatRequest(
        provider_id=uuid.UUID(provider_id), model_id=uuid.UUID(model_id),
        message="go", client_key=client_key,
    )


def test_same_client_key_adopts_single_row(db: Session, provider_factory, model_factory, slow, maker) -> None:
    """Lost-response retry with the same key: no duplicate rows or tasks."""
    p = provider_factory("Mock")
    m = model_factory(p["id"])
    key = f"key-{uuid.uuid4().hex}"

    async def _main():
        first = await gateway_service.start_generation(db, _keyed_request(p["id"], m["id"], key))
        second = await gateway_service.start_generation(db, _keyed_request(p["id"], m["id"], key))
        assert second.generation_id == first.generation_id
        assert second.conversation_id == first.conversation_id
        await _await_task(first.generation_id)
        return first

    started = asyncio.run(_main())
    rows = [msg for msg in list_messages(db, started.conversation_id) if msg.role.value == "assistant"]
    assert len(rows) == 1
    assert rows[0].status == MessageStatus.COMPLETED
    # Terminal adoption: same key after completion returns the finished row.
    adopted = asyncio.run(
        gateway_service.start_generation(db, _keyed_request(p["id"], m["id"], key))
    )
    assert adopted.generation_id == started.generation_id
    assert adopted.status == "completed"


def test_generation_by_client_key_lookup(db: Session, provider_factory, model_factory, slow) -> None:
    p = provider_factory("Mock")
    m = model_factory(p["id"])
    key = f"key-{uuid.uuid4().hex}"

    async def _main():
        started = await gateway_service.start_generation(db, _keyed_request(p["id"], m["id"], key))
        found = gateway_service.generation_by_client_key(db, key)
        assert found.generation_id == started.generation_id
        assert found.status == "running"
        await _await_task(started.generation_id)
        return started

    asyncio.run(_main())
    with pytest.raises(NotFoundError):
        gateway_service.generation_by_client_key(db, "no-such-key")


class HungAdapter(BaseProviderAdapter):
    """Provider stuck mid-stream: cancel must still land promptly."""

    def __init__(self) -> None:
        super().__init__(credentials={}, model_id="hung-mock")
        self.closed = False

    async def chat_stream(self, messages):
        yield StreamChunk(delta="first ")
        try:
            await asyncio.sleep(3600)
            yield StreamChunk(delta="never arrives")
        finally:
            self.closed = True


def test_cancel_aborts_hung_provider_promptly(
    db: Session, provider_factory, model_factory, monkeypatch, maker
) -> None:
    """Stop must reach the provider: a hung fetch ends fast and closes."""
    import time

    p = provider_factory("Mock")
    m = model_factory(p["id"])
    hung = HungAdapter()
    monkeypatch.setattr(gateway_service, "build_adapter", lambda *a, **k: hung)

    async def _main():
        started = await gateway_service.start_generation(db, _request(p["id"], m["id"]))
        await asyncio.sleep(0.3)  # first chunk emitted, fetch now hung
        begin = time.monotonic()
        await gateway_service.cancel_generation(db, started.generation_id)
        await asyncio.wait_for(_await_task(started.generation_id), timeout=10.0)
        return started, time.monotonic() - begin

    started, cancel_s = asyncio.run(_main())
    assert cancel_s < 5.0, f"cancel took {cancel_s:.1f}s against a hung provider"
    assert hung.closed, "provider iterator was not closed on cancel"
    row = _fresh(maker, started.message_id)
    assert row.status == MessageStatus.CANCELLED
    assert row.content == "first "
    assert "never arrives" not in row.content


def test_active_unique_index_rejects_second_live_row(
    db: Session, provider_factory, model_factory
) -> None:
    """DB backstop: two RUNNING assistants in one conversation is impossible."""
    from sqlalchemy.exc import IntegrityError

    from tollms.api.conversations.schemas import ConversationCreate
    from tollms.api.conversations.service import add_message, create_conversation
    from tollms.models.message import Role

    conv = create_conversation(db, ConversationCreate(title="guarded"))
    add_message(db, conv.id, Role.ASSISTANT, "", status=MessageStatus.RUNNING)
    with pytest.raises(IntegrityError):
        add_message(db, conv.id, Role.ASSISTANT, "", status=MessageStatus.RUNNING)
    db.rollback()


def test_stream_timing_instant_provider(db: Session, provider_factory, model_factory, monkeypatch) -> None:
    """Latency instrumentation baseline: setup, first-delta, and total times."""
    import json
    import time

    p = provider_factory("Mock")
    m = model_factory(p["id"])
    adapter = SlowAdapter(["tok "] * 5)
    monkeypatch.setattr(gateway_service, "build_adapter", lambda *a, **k: adapter)

    async def _main():
        t0 = time.monotonic()
        started = await gateway_service.start_generation(db, _request(p["id"], m["id"]))
        setup_ms = (time.monotonic() - t0) * 1000
        first_delta_ms: float | None = None
        async for raw in gateway_service.stream_events(db, started.generation_id):
            event = json.loads(raw[6:])
            if first_delta_ms is None and "delta" in event:
                first_delta_ms = (time.monotonic() - t0) * 1000
            if event.get("done"):
                break
        total_ms = (time.monotonic() - t0) * 1000
        return setup_ms, first_delta_ms, total_ms

    setup_ms, first_delta_ms, total_ms = asyncio.run(_main())
    print(f"\n[TIMING] setup={setup_ms:.0f}ms first-delta={first_delta_ms:.0f}ms total={total_ms:.0f}ms")
    assert first_delta_ms is not None and first_delta_ms < 5000
    assert total_ms < 10000


# --- failed/partial usage accounting ------------------------------------------------
# A provider failure after partial output must persist estimated usage + cost
# (flagged estimated), keep exactly one request log row, and reconcile the
# key budget with the estimate. Failures with no output bill nothing.


def _failed_run(db, maker, provider_factory, model_factory, monkeypatch, chunks, fail_after):
    """Drive one streaming generation until the provider raises mid-stream."""
    p = provider_factory("FailP")
    m = model_factory(p["id"])
    adapter = SlowAdapter(chunks, fail_after=fail_after)
    monkeypatch.setattr(gateway_service, "build_adapter", lambda *a, **k: adapter)

    async def _main():
        started = await gateway_service.start_generation(db, _request(p["id"], m["id"]))
        events = []
        async for raw in gateway_service.stream_events(db, started.generation_id):
            import json

            events.append(json.loads(raw[6:]))
            if events[-1].get("done"):
                break
        await _await_task(started.generation_id)
        return started, events

    return asyncio.run(_main())


def test_failed_streaming_records_estimated_usage_and_cost(
    db: Session, provider_factory, model_factory, monkeypatch, maker
) -> None:
    from tollms.models.request_log import RequestLog, RequestStatus

    started, events = _failed_run(
        db, maker, provider_factory, model_factory, monkeypatch,
        ["Hello ", "partial ", "world "], fail_after=2,
    )
    assert events[-1]["status"] == "failed"
    assert events[-1].get("error")

    row = _fresh(maker, started.message_id)
    assert row.status == MessageStatus.FAILED
    # Partial text preserved.
    assert row.content == "Hello partial "
    # Estimated usage recorded (never zeroed): prompt from request history,
    # completion from the generated prefix; flagged as estimated.
    assert row.total_tokens is not None and row.total_tokens > 0
    assert row.completion_tokens is not None and row.completion_tokens > 0
    assert row.total_cost is not None and row.total_cost > 0
    assert row.usage_estimated is True
    assert row.error_code is not None
    assert row.latency_ms is not None and row.latency_ms >= 0

    logs = db.scalars(
        select(RequestLog).where(RequestLog.message_id == started.message_id)
    ).all()
    assert len(logs) == 1  # exactly one usage record, no duplicates
    log = logs[0]
    assert log.status == RequestStatus.FAILED.value
    assert log.is_streaming is True
    assert log.total_tokens == row.total_tokens
    assert log.total_cost == row.total_cost
    assert log.error_code == row.error_code


def test_failed_streaming_prefers_provider_reported_usage(
    db: Session, provider_factory, model_factory, monkeypatch, maker
) -> None:
    """Usage events received before the failure win over text estimates."""
    from tollms.services.gateway.adapters.base import StreamChunk

    p = provider_factory("RepP")
    m = model_factory(p["id"])

    class _UsageThenBoom(BaseProviderAdapter):
        def __init__(self) -> None:
            super().__init__(credentials={}, model_id="usage-mock")

        async def chat_stream(self, messages):
            yield StreamChunk(delta="partial ")
            yield StreamChunk(
                delta="",
                prompt_tokens=11,
                completion_tokens=7,
                total_tokens=18,
            )
            raise RuntimeError("provider blew up after usage")

    monkeypatch.setattr(gateway_service, "build_adapter", lambda *a, **k: _UsageThenBoom())

    async def _main():
        started = await gateway_service.start_generation(db, _request(p["id"], m["id"]))
        async for raw in gateway_service.stream_events(db, started.generation_id):
            import json

            if json.loads(raw[6:]).get("done"):
                break
        await _await_task(started.generation_id)
        return started

    started = asyncio.run(_main())
    row = _fresh(maker, started.message_id)
    assert row.status == MessageStatus.FAILED
    assert row.prompt_tokens == 11
    assert row.completion_tokens == 7
    assert row.total_tokens == 18


def test_cancelled_streaming_records_estimated_usage(
    db: Session, provider_factory, model_factory, slow, maker, monkeypatch
) -> None:
    """Client cancel after partial output keeps estimated usage, billed once."""
    from tollms.models.request_log import RequestLog, RequestStatus

    p = provider_factory("CancelP")
    m = model_factory(p["id"])
    adapter = SlowAdapter([f"word{i} " for i in range(30)], delay=0.02)
    monkeypatch.setattr(gateway_service, "build_adapter", lambda *a, **k: adapter)

    async def _main():
        started = await gateway_service.start_generation(db, _request(p["id"], m["id"]))
        for _ in range(200):
            if _fresh(maker, started.message_id).content:
                break
            await asyncio.sleep(0.01)
        cancelled = await gateway_service.cancel_generation(db, started.generation_id)
        assert cancelled.status == "cancelled"
        await _await_task(started.generation_id)
        return started

    started = asyncio.run(_main())
    row = _fresh(maker, started.message_id)
    assert row.status == MessageStatus.CANCELLED
    assert 0 < len(row.content) < len("".join(f"word{i} " for i in range(30)))
    assert row.total_tokens is not None and row.total_tokens > 0
    assert row.total_cost is not None and row.total_cost > 0
    assert row.usage_estimated is True

    logs = db.scalars(
        select(RequestLog).where(RequestLog.message_id == started.message_id)
    ).all()
    assert len(logs) == 1
    assert logs[0].status == RequestStatus.CANCELLED.value
    assert logs[0].total_tokens == row.total_tokens


def test_failed_partial_output_bills_estimated_budget() -> None:
    """Valkey reconciliation bills estimated actuals when partial text exists;
    zero-output failures release the reservation (bill nothing)."""
    import uuid as _uuid
    from decimal import Decimal

    from tollms.services import generation as gen_engine
    from tollms.services.api_keys.keys import KeyContext, KeyPolicy
    from tollms.services.gateway import limits
    from tollms.services.gateway.adapters.base import ChatResult
    from tollms.services.gateway.costing import CostBreakdown, UsageTokens

    ctx = KeyContext(
        key_id=_uuid.uuid4(),
        user_id=_uuid.uuid4(),
        name="reconcile-test",
        key_prefix="tma_sk_live_test",
        enabled=True,
        expires_at=None,
        policy=KeyPolicy(max_budget_usd=Decimal("100")),
    )
    provider_id, model_id = _uuid.uuid4(), _uuid.uuid4()

    def _spec():
        import types

        return types.SimpleNamespace(
            key_ctx=ctx,
            key_request_id=f"req-{_uuid.uuid4().hex[:8]}",
            provider_id=provider_id,
            model_id=model_id,
            key_org_cap=None,
            generation_id=_uuid.uuid4(),
            media_cost=None,
            adapter=None,
        )

    # Partial output failure: estimate is booked against the budget.
    before = limits.current_spend(ctx)
    gen_engine._reconcile_key_policy(
        _spec(),
        completed=False,
        result=ChatResult(text="Hello partial output " * 200),
        tokens=UsageTokens(prompt=10, completion=500),
        breakdown=CostBreakdown(
            input_cost=Decimal("0.00001"),
            output_cost=Decimal("0.0001"),
            total_cost=Decimal("0.00011"),
        ),
    )
    assert limits.current_spend(ctx) > before

    # Zero-output failure: reservation released, budget untouched.
    before2 = limits.current_spend(ctx)
    gen_engine._reconcile_key_policy(
        _spec(),
        completed=False,
        result=ChatResult(text=""),
        tokens=UsageTokens(prompt=0, completion=0),
        breakdown=CostBreakdown(),
    )
    assert limits.current_spend(ctx) == before2
