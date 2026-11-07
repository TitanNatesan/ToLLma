"""Streaming regeneration without egress (§3): siblings stream, fail, retry, cancel, sweep.

Drives start_regeneration with in-process fake adapters only (never real
egress): the new sibling streams multiple chunks into its own row, the
original stays untouched, FAILED rows persist as siblings, a retry adds
another sibling, and a fresh-session re-read shows the persisted tree + leaf.
Cancel preserves CANCELLED without overwriting; the startup sweep marks
stale RUNNING rows FAILED.
"""

import asyncio
import uuid

import pytest
from sqlalchemy.orm import Session, sessionmaker

from tollms.api.conversations import service as conv_service
from tollms.api.conversations.schemas import ConversationCreate
from tollms.api.conversations.service import (
    active_path,
    add_message,
    create_conversation,
)
from tollms.api.gateway import service as gateway_service
from tollms.api.keys.service import ensure_primary_key
from tollms.models.message import MessageStatus, Role
from tollms.services import generation as generation_engine
from tollms.services.gateway.adapters.base import BaseProviderAdapter, StreamChunk


class _ChunkAdapter(BaseProviderAdapter):
    def __init__(self, chunks: list[str], delay: float = 0.0) -> None:
        super().__init__(credentials={}, model_id="chunk-mock")
        self._chunks = chunks
        self._delay = delay

    async def chat_stream(self, messages):
        for text in self._chunks:
            if self._delay:
                await asyncio.sleep(self._delay)
            yield StreamChunk(delta=text)


class _BoomAdapter(BaseProviderAdapter):
    def __init__(self, chunks: list[str], fail_after: int) -> None:
        super().__init__(credentials={}, model_id="boom-mock")
        self._chunks = chunks
        self._fail_after = fail_after

    async def chat_stream(self, messages):
        for i, text in enumerate(self._chunks):
            if i == self._fail_after:
                raise RuntimeError("provider blew up")
            yield StreamChunk(delta=text)


@pytest.fixture()
def maker(db: Session):
    return sessionmaker(bind=db.get_bind())


def _fresh(maker, row_id: uuid.UUID):
    session = maker()
    try:
        return conv_service.get_message(session, row_id)
    finally:
        session.close()


async def _await_task(generation_id: uuid.UUID) -> None:
    active = generation_engine.manager.get(generation_id)
    if active is None or active.task is None:
        return
    await active.task


async def _collect(events):
    import json

    collected = []
    async for raw in events:
        assert raw.startswith("data: ")
        collected.append(json.loads(raw[6:]))
        if collected[-1].get("done"):
            break
    return collected


def _seed_thread(db: Session, user_id: uuid.UUID, provider_id: str, model_id: str):
    conv = create_conversation(
        db,
        ConversationCreate(
            title="StreamRegen", provider_id=uuid.UUID(provider_id),
            model_id=uuid.UUID(model_id),
        ),
        user_id,
    )
    key_id = ensure_primary_key(db, user_id).id
    prompt = add_message(db, conv.id, Role.USER, "original prompt", user_id=user_id)
    first = add_message(
        db, conv.id, Role.ASSISTANT, "first answer",
        provider_id=uuid.UUID(provider_id), model_id=uuid.UUID(model_id),
        user_id=user_id, parent_message_id=prompt.id, use_active_leaf=False,
    )
    return conv, key_id, prompt, first


def test_streaming_regeneration_creates_sibling_and_streams_chunks(
    db: Session, client, user_factory, provider_factory, model_factory, monkeypatch
):
    """Regen streams multiple chunks into a NEW row; the original is untouched."""
    user_factory()
    provider = provider_factory()
    model = model_factory(provider["id"])
    user_id = uuid.UUID(client.get("/auth/me").json()["id"])
    conv, key_id, prompt, first = _seed_thread(db, user_id, provider["id"], model["id"])
    chunks = ["alpha ", "beta ", "gamma ", "delta "]
    monkeypatch.setattr(gateway_service, "build_adapter", lambda *a, **k: _ChunkAdapter(chunks))

    async def _main():
        result = await gateway_service.start_regeneration(
            db, first.id, user_id=user_id, key_id=key_id,
        )
        assert result.message_id != first.id
        events = await _collect(gateway_service.stream_events(db, result.message_id))
        assert events[-1]["status"] == "completed"
        deltas = [e.get("delta", "") for e in events]
        assert sum(1 for d in deltas if d) >= 2, "must stream multiple chunks"
        assert "".join(deltas) == "".join(chunks)
        return result

    result = asyncio.run(_main())

    db.expire_all()
    orig = conv_service.get_message(db, first.id)
    assert (orig.content, orig.status) == ("first answer", MessageStatus.COMPLETED)
    new = conv_service.get_message(db, result.message_id)
    assert new.status == MessageStatus.COMPLETED
    assert new.content == "".join(chunks)
    assert new.parent_message_id == orig.parent_message_id
    assert new.id != orig.id

    sibs = conv_service.message_siblings(db, new.id, user_id)
    assert sorted(m.version_number for m in sibs) == [1, 2]
    tree = conv_service.conversation_tree(db, conv.id, user_id)
    assert tree["active_leaf_id"] == new.id
    assert [m.id for m in active_path(db, conv.id, user_id)][-2:] == [prompt.id, new.id]


def test_streaming_regeneration_failed_sibling_retry_persists_tree(
    db: Session, client, user_factory, provider_factory, model_factory, monkeypatch, maker
):
    """FAILED stream stays a sibling; retry adds another; fresh session re-reads the tree."""
    user_factory()
    provider = provider_factory()
    model = model_factory(provider["id"])
    user_id = uuid.UUID(client.get("/auth/me").json()["id"])
    conv, key_id, prompt, first = _seed_thread(db, user_id, provider["id"], model["id"])
    monkeypatch.setattr(
        gateway_service, "build_adapter",
        lambda *a, **k: _BoomAdapter(["keep ", "this ", "unseen "], fail_after=2),
    )

    async def _fail():
        result = await gateway_service.start_regeneration(
            db, first.id, user_id=user_id, key_id=key_id,
        )
        events = await _collect(gateway_service.stream_events(db, result.message_id))
        assert events[-1]["status"] == "failed"
        await _await_task(result.message_id)
        return result

    failed_res = asyncio.run(_fail())
    db.expire_all()
    failed = conv_service.get_message(db, failed_res.message_id)
    assert failed.status == MessageStatus.FAILED
    assert failed.content == "keep this "
    assert conv_service.get_message(db, first.id).content == "first answer"

    monkeypatch.setattr(
        gateway_service, "build_adapter", lambda *a, **k: _ChunkAdapter(["recovered "])
    )

    async def _retry():
        result = await gateway_service.start_regeneration(
            db, failed.id, user_id=user_id, key_id=key_id,
        )
        assert result.message_id not in (first.id, failed.id)
        await _await_task(result.message_id)
        return result

    retry_res = asyncio.run(_retry())

    # Refresh-equivalent: re-read tree/path from a fresh session (as after reload).
    fresh_maker = sessionmaker(bind=db.get_bind())
    fresh = fresh_maker()
    try:
        tree = conv_service.conversation_tree(fresh, conv.id, user_id)
        path = conv_service.conversation_path(fresh, conv.id, user_id)
        ids = {n["id"] for n in tree["nodes"]}
        assert {first.id, failed.id, retry_res.message_id} <= ids
        assert tree["active_leaf_id"] == retry_res.message_id == path["active_leaf_id"]
        assert path["path"][-1].id == retry_res.message_id
        sibs = conv_service.message_siblings(fresh, retry_res.message_id, user_id)
        assert sorted(m.version_number for m in sibs) == [1, 2, 3]
        statuses = {m.id: m.status for m in sibs}
        assert statuses[first.id] == MessageStatus.COMPLETED
        assert statuses[failed.id] == MessageStatus.FAILED
        assert statuses[retry_res.message_id] == MessageStatus.COMPLETED
    finally:
        fresh.close()


def test_streaming_regeneration_cancel_preserved_and_sweep_marks_stale(
    db: Session, client, user_factory, provider_factory, model_factory, monkeypatch, maker
):
    """Cancel keeps CANCELLED partial text without overwriting; sweep fails stale RUNNING."""
    user_factory()
    provider = provider_factory()
    model = model_factory(provider["id"])
    user_id = uuid.UUID(client.get("/auth/me").json()["id"])
    conv, key_id, prompt, first = _seed_thread(db, user_id, provider["id"], model["id"])
    monkeypatch.setattr(
        gateway_service, "build_adapter",
        lambda *a, **k: _ChunkAdapter([f"word{i} " for i in range(30)], delay=0.02),
    )

    async def _main():
        started = await gateway_service.start_regeneration(
            db, first.id, user_id=user_id, key_id=key_id,
        )
        for _ in range(200):
            if _fresh(maker, started.message_id).content:
                break
            await asyncio.sleep(0.01)
        cancelled = await gateway_service.cancel_generation(db, started.message_id)
        assert cancelled.status == "cancelled"
        await _await_task(started.message_id)
        return started

    started = asyncio.run(_main())

    db.expire_all()
    row = conv_service.get_message(db, started.message_id)
    assert row.status == MessageStatus.CANCELLED
    assert 0 < len(row.content) < len("".join(f"word{i} " for i in range(30)))
    # No overwrite: the original answer is byte-identical and still completed.
    assert conv_service.get_message(db, first.id).content == "first answer"
    assert conv_service.get_message(db, first.id).status == MessageStatus.COMPLETED
    tree = conv_service.conversation_tree(db, conv.id, user_id)
    assert tree["active_leaf_id"] == row.id

    # Startup-sweep semantics: a leftover RUNNING row is marked FAILED, tree stays valid.
    orphan = add_message(
        db, conv.id, Role.ASSISTANT, "stale partial", status=MessageStatus.RUNNING,
        user_id=user_id, parent_message_id=prompt.id, use_active_leaf=False,
    )
    marked = generation_engine.sweep_stale_running(db, reason="backend restarted")
    assert marked >= 1
    assert conv_service.get_message(db, orphan.id).status == MessageStatus.FAILED
    db.expire_all()
    retree = conv_service.conversation_tree(db, conv.id, user_id)
    ids = {n["id"] for n in retree["nodes"]}
    assert retree["active_leaf_id"] in ids
