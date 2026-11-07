"""Same-parent concurrent regenerations (§4): sibling races stay gapless, no orphans.

Two regenerations targeting the same user request run simultaneously (threads +
barrier) through the sibling path. Exactly one of these holds per race:
- both rows commit with versions 1,2 (clean interleave), or
- one commits and the loser surfaces the documented ConflictError (409),
  never a 500, duplicate id, or gap in versions.

Tree invariants pinned after every race: distinct node identity, parent links
valid, the active leaf points at exactly one live tip, versions gapless per
family, and the same client_key adopts instead of duplicating.
"""

import asyncio
import threading
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
from tollms.api.gateway.schemas import ChatRequest
from tollms.core.exceptions import ConflictError
from tollms.models.message import MessageStatus, Role
from tollms.services import generation as generation_engine
from tollms.services.gateway.adapters.base import BaseProviderAdapter, StreamChunk


class _SlowAdapter(BaseProviderAdapter):
    def __init__(self, chunks: list[str] | None = None, delay: float = 0.02) -> None:
        super().__init__(credentials={}, model_id="slow-mock")
        self._chunks = chunks or [f"chunk{i} " for i in range(30)]
        self._delay = delay

    async def chat_stream(self, messages):
        for text in self._chunks:
            if self._delay:
                await asyncio.sleep(self._delay)
            yield StreamChunk(delta=text)


def _tree_invariants(db: Session, conv_id: uuid.UUID, user_id: uuid.UUID | None) -> dict:
    """Shared post-race check: identity, parenting, leaf, gapless versions."""
    db.expire_all()
    tree = conv_service.conversation_tree(db, conv_id, user_id)
    nodes = tree["nodes"]
    ids = [n["id"] for n in nodes]
    assert len(ids) == len(set(ids)), "node identity must be distinct (no shared id)"
    by_id = {n["id"]: n for n in nodes}
    # Zero orphans: every parent link resolves to a live node (or NULL root).
    for n in nodes:
        parent = n["parent_message_id"]
        assert parent is None or parent in by_id, f"orphan row {n['id']} -> {parent}"
    # Leaf consistent: exactly one live tip, reachable from its own parent chain.
    leaf = tree["active_leaf_id"]
    assert leaf in by_id, "active leaf must point at a live node"
    path = active_path(db, conv_id, user_id)
    assert path and path[-1].id == leaf, "leaf must equal the active-path tip"
    # Versions gapless per sibling family, starting at 1.
    from collections import defaultdict

    by_parent: dict = defaultdict(list)
    for n in nodes:
        by_parent[n["parent_message_id"]] += [n["version_number"]]
    for versions in by_parent.values():
        assert sorted(versions) == list(range(1, len(versions) + 1))
    return tree


def test_same_parent_concurrent_regenerations_sibling_versions_gapless(
    db: Session, client, user_factory
):
    """Two threads race add_message siblings under one request: 1,2 or 1+409, never corrupt."""
    user_factory()
    user_id = uuid.UUID(client.get("/auth/me").json()["id"])
    conv = create_conversation(db, ConversationCreate(title="conc"), user_id)
    prompt = add_message(db, conv.id, Role.USER, "prompt", user_id=user_id)

    barrier = threading.Barrier(2)
    outcomes: dict = {}

    def _worker(idx: int) -> None:
        maker = sessionmaker(bind=db.get_bind())
        session = maker()
        try:
            barrier.wait(timeout=15)
            msg = add_message(
                session, conv.id, Role.ASSISTANT, f"answer {idx}",
                user_id=user_id, parent_message_id=prompt.id, use_active_leaf=False,
            )
            outcomes[idx] = ("ok", msg.id, msg.version_number)
        except ConflictError:
            session.rollback()
            outcomes[idx] = ("conflict", None, None)
        except Exception as exc:  # noqa: BLE001 — surfaced below, never swallowed
            outcomes[idx] = ("error", repr(exc), None)
        finally:
            session.close()

    threads = [threading.Thread(target=_worker, args=(i,)) for i in (0, 1)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=30)
    assert all(not t.is_alive() for t in threads), "sibling race threads hung"
    assert sorted(outcomes) == [0, 1]
    assert not [v for v in outcomes.values() if v[0] == "error"], f"race raised: {outcomes}"

    oks = [v for v in outcomes.values() if v[0] == "ok"]
    conflicts = [v for v in outcomes.values() if v[0] == "conflict"]
    assert len(oks) >= 1, "at least one sibling must commit"
    assert len(oks) + len(conflicts) == 2
    if len(oks) == 2:
        assert oks[0][1] != oks[1][1], "no shared node identity across the race"
        assert sorted(v[2] for v in oks) == [1, 2]

    tree = _tree_invariants(db, conv.id, user_id)
    sibs = conv_service.message_siblings(db, tree["nodes"][-1]["id"], user_id)
    assert [m.version_number for m in sibs] == list(range(1, len(sibs) + 1))


def test_same_parent_concurrent_regenerations_client_key_adopts_no_duplicate(
    db: Session, client, user_factory, provider_factory, model_factory, monkeypatch
):
    """Duplicate client_key adopts the in-flight row: no duplicate generation."""
    user_factory()
    provider = provider_factory()
    model = model_factory(provider["id"])
    monkeypatch.setattr(gateway_service, "build_adapter", lambda *a, **k: _SlowAdapter(delay=0.02))
    key = f"key-{uuid.uuid4().hex}"

    def _req(client_key: str) -> ChatRequest:
        return ChatRequest(
            provider_id=uuid.UUID(provider["id"]), model_id=uuid.UUID(model["id"]),
            message="go", client_key=client_key,
        )

    async def _main():
        first = await gateway_service.start_generation(db, _req(key))
        second = await gateway_service.start_generation(db, _req(key))
        assert second.generation_id == first.generation_id
        active = generation_engine.manager.get(first.generation_id)
        if active is not None and active.task is not None:
            await active.task
        return first

    started = asyncio.run(_main())

    db.expire_all()
    assistants = [
        m for m in conv_service.list_messages(db, started.conversation_id)
        if m.role == Role.ASSISTANT
    ]
    assert len(assistants) == 1, "client_key retry must not duplicate the row"
    assert assistants[0].status == MessageStatus.COMPLETED
    _tree_invariants(db, started.conversation_id, None)


def test_same_parent_concurrent_regenerations_running_start_conflicts(
    db: Session, client, user_factory, provider_factory, model_factory, monkeypatch
):
    """A second start on the same conversation while one runs 409s (ConflictError)."""
    user_factory()
    provider = provider_factory()
    model = model_factory(provider["id"])
    monkeypatch.setattr(gateway_service, "build_adapter", lambda *a, **k: _SlowAdapter(delay=0.02))

    def _req(**kw) -> ChatRequest:
        return ChatRequest(
            provider_id=uuid.UUID(provider["id"]), model_id=uuid.UUID(model["id"]),
            message="go", **kw,
        )

    async def _main():
        started = await gateway_service.start_generation(db, _req())
        with pytest.raises(ConflictError):
            await gateway_service.start_generation(
                db, _req(conversation_id=started.conversation_id)
            )
        active = generation_engine.manager.get(started.generation_id)
        if active is not None and active.task is not None:
            await active.task
        return started

    started = asyncio.run(_main())

    db.expire_all()
    assistants = [
        m for m in conv_service.list_messages(db, started.conversation_id)
        if m.role == Role.ASSISTANT
    ]
    assert len(assistants) == 1
    assert assistants[0].status == MessageStatus.COMPLETED
    tree = _tree_invariants(db, started.conversation_id, None)
    assert tree["active_leaf_id"] == started.message_id
