"""Generation lifecycle: backend-owned streaming, cancel, recovery.

A slow fake adapter stands in for providers. Every test drives the real
engine (background task + progressive persistence + Valkey active-state).
"""

import asyncio
import uuid

import pytest
from sqlalchemy.orm import Session, sessionmaker

from tollms.api.conversations.service import get_message, list_messages
from tollms.api.gateway import service as gateway_service
from tollms.api.gateway.schemas import ChatRequest
from tollms.core.exceptions import ConflictError, NotFoundError
from tollms.models.message import MessageStatus
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
    active = generation_engine.manager.get(generation_id)
    assert active is not None and active.task is not None
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
        await asyncio.sleep(0.25)
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
