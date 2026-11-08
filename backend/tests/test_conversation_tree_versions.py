"""Versioned tree edge cases: select restores path, leaf parenting, 404s, failed retry, idempotent concurrent sends.

Covers spec section 12 items not already pinned by test_conversation_tree.py:
- select request/response version restores the correct descendant path
- new sends attach to the active leaf, never an inactive branch
- cross-conversation parent rejected 404
- unauthorized (other user) branch access 404 (tree/path/select/siblings/children)
- failed generation sibling persists + retry creates another sibling
- concurrent duplicate submissions don't corrupt the tree (client_key adopt or version+1, no 500)
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
from tollms.api.gateway.schemas import ChatRequest
from tollms.api.keys.service import ensure_primary_key
from tollms.core.exceptions import ConflictError, NotFoundError
from tollms.models.message import MessageStatus, Role
from tollms.services import generation as generation_engine
from tollms.services.gateway.adapters.base import BaseProviderAdapter, StreamChunk


class _FakeAdapter(BaseProviderAdapter):
    def __init__(self, text: str = "answer") -> None:
        super().__init__(credentials={}, model_id="fake")
        self._text = text

    async def chat_stream(self, messages):
        yield StreamChunk(delta=self._text, prompt_tokens=5, completion_tokens=5, total_tokens=10)


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


def _seed_conv(db: Session, user_id: uuid.UUID, title: str = "T"):
    return create_conversation(db, ConversationCreate(title=title), user_id)


def _wait_terminal(db: Session, message_id: uuid.UUID, timeout: float = 15.0):
    import time

    deadline = time.time() + timeout
    while time.time() < deadline:
        db.expire_all()
        status = conv_service.get_message(db, message_id).status
        if status in (MessageStatus.COMPLETED, MessageStatus.FAILED, MessageStatus.CANCELLED):
            return
        time.sleep(0.1)
    raise AssertionError(f"message {message_id} did not reach a terminal state")


def test_select_request_and_response_versions_restore_correct_path(db: Session, client, user_factory):
    """Selecting a request root vs a response sibling returns its own root-to-leaf chain."""
    user_factory()
    user_id = uuid.UUID(client.get("/auth/me").json()["id"])
    conv = _seed_conv(db, user_id)

    r1 = add_message(db, conv.id, Role.USER, "root one", user_id=user_id, use_active_leaf=False)
    r2 = add_message(db, conv.id, Role.USER, "root two", user_id=user_id, use_active_leaf=False)
    assert (r1.version_number, r2.version_number) == (1, 2)

    a1 = add_message(db, conv.id, Role.ASSISTANT, "a1", user_id=user_id,
                     parent_message_id=r1.id, use_active_leaf=False)
    a2 = add_message(db, conv.id, Role.ASSISTANT, "a2", user_id=user_id,
                     parent_message_id=r1.id, use_active_leaf=False)
    assert (a1.version_number, a2.version_number) == (1, 2)
    u2 = add_message(db, conv.id, Role.USER, "follow-up", user_id=user_id,
                     parent_message_id=a1.id, use_active_leaf=False)

    # Request version selects restore just their own root.
    res = conv_service.select_message(db, conv.id, r2.id, user_id)
    assert res["active_leaf_id"] == r2.id
    assert [m.id for m in res["path"]] == [r2.id]

    # Response sibling selects restore the full descendant chain through the parent.
    res = conv_service.select_message(db, conv.id, a2.id, user_id)
    assert res["active_leaf_id"] == a2.id
    assert [m.id for m in res["path"]] == [r1.id, a2.id]

    res = conv_service.select_message(db, conv.id, u2.id, user_id)
    assert [m.id for m in res["path"]] == [r1.id, a1.id, u2.id]

    # Same via HTTP: selecting an ancestor of the current leaf keeps the
    # tip — siblings stay out, descendants below the selection stay shown.
    sel = client.post(f"/api/v1/conversations/{conv.id}/select", json={"message_id": str(a1.id)}).json()
    assert sel["active_leaf_id"] == str(u2.id)
    assert [m["id"] for m in sel["path"]] == [str(r1.id), str(a1.id), str(u2.id)]


def test_new_message_attaches_to_active_leaf_not_inactive_branch(db: Session, client, user_factory):
    """After selecting an older branch, default sends continue there (inactive leaf ignored)."""
    user_factory()
    user_id = uuid.UUID(client.get("/auth/me").json()["id"])
    conv = _seed_conv(db, user_id)

    u = add_message(db, conv.id, Role.USER, "q", user_id=user_id)
    a1 = add_message(db, conv.id, Role.ASSISTANT, "a1", user_id=user_id,
                     parent_message_id=u.id, use_active_leaf=False)
    a2 = add_message(db, conv.id, Role.ASSISTANT, "a2", user_id=user_id,
                     parent_message_id=u.id, use_active_leaf=False)
    assert conv_service.conversation_path(db, conv.id, user_id)["active_leaf_id"] == a2.id

    conv_service.select_message(db, conv.id, a1.id, user_id)
    nxt = add_message(db, conv.id, Role.USER, "follow-up", user_id=user_id)
    assert nxt.parent_message_id == a1.id
    assert nxt.parent_message_id != a2.id

    db.expire_all()
    assert [m.id for m in active_path(db, conv.id, user_id)] == [u.id, a1.id, nxt.id]
    tree = conv_service.conversation_tree(db, conv.id, user_id)
    assert tree["active_leaf_id"] == nxt.id
    # Inactive branch still stored but not on the path.
    assert a2.id in {n["id"] for n in tree["nodes"]}
    assert a2.id not in {m.id for m in active_path(db, conv.id, user_id)}


def test_cross_conversation_parent_rejected_404(db: Session, client, user_factory):
    """A parent from another conversation is a 404 oracle, never grafted."""
    user_factory()
    user_id = uuid.UUID(client.get("/auth/me").json()["id"])
    conv_a = _seed_conv(db, user_id, title="A")
    conv_b = _seed_conv(db, user_id, title="B")
    foreign = add_message(db, conv_b.id, Role.USER, "elsewhere", user_id=user_id)

    with pytest.raises(NotFoundError):
        add_message(db, conv_a.id, Role.USER, "graft", user_id=user_id,
                    parent_message_id=foreign.id, use_active_leaf=False)

    with pytest.raises(NotFoundError):
        conv_service.select_message(db, conv_a.id, foreign.id, user_id)

    # HTTP mirrors the oracle (no cross-conversation leak via select).
    r = client.post(f"/api/v1/conversations/{conv_a.id}/select", json={"message_id": str(foreign.id)})
    assert r.status_code == 404


def test_unauthorized_branch_access_404(db: Session, client, user_factory):
    """Another user's tree/path/select/siblings/children all 404 (no oracle)."""
    user_factory("owner@tollma.ai")
    owner_conv = _seed_conv(db, uuid.UUID(client.get("/auth/me").json()["id"]), title="Owned")
    owner_id = uuid.UUID(client.get("/auth/me").json()["id"])
    u = add_message(db, owner_conv.id, Role.USER, "secret", user_id=owner_id)
    a = add_message(db, owner_conv.id, Role.ASSISTANT, "secret answer", user_id=owner_id)

    client.post("/auth/logout")
    user_factory("intruder@tollma.ai")

    assert client.get(f"/api/v1/conversations/{owner_conv.id}/tree").status_code == 404
    assert client.get(f"/api/v1/conversations/{owner_conv.id}/path").status_code == 404
    assert client.post(f"/api/v1/conversations/{owner_conv.id}/select", json={"message_id": str(a.id)}).status_code == 404
    assert client.get(f"/api/v1/messages/{a.id}/siblings").status_code == 404
    assert client.get(f"/api/v1/messages/{u.id}/children").status_code == 404


def test_failed_sibling_persists_and_retry_creates_another(db: Session, client, user_factory, provider_factory, model_factory, monkeypatch):
    """A FAILED assistant stays visible; retry/regenerate adds version+1 and moves the leaf."""
    user_factory()
    provider = provider_factory()
    model = model_factory(provider["id"])
    user_id = uuid.UUID(client.get("/auth/me").json()["id"])
    conv = create_conversation(
        db,
        ConversationCreate(title="FailRetry", provider_id=uuid.UUID(provider["id"]), model_id=uuid.UUID(model["id"])),
        user_id,
    )
    key_id = ensure_primary_key(db, user_id).id
    u = add_message(db, conv.id, Role.USER, "prompt", user_id=user_id)
    failed = add_message(
        db, conv.id, Role.ASSISTANT, "first try failed",
        provider_id=uuid.UUID(provider["id"]), model_id=uuid.UUID(model["id"]),
        user_id=user_id, status=MessageStatus.FAILED,
        parent_message_id=u.id, use_active_leaf=False,
    )
    failed.error = "provider blew up"
    db.commit()

    monkeypatch.setattr(gateway_service, "build_adapter", lambda *a, **k: _FakeAdapter("second answer"))

    async def _retry():
        result = await gateway_service.start_regeneration(
            db, failed.id, user_id=user_id, key_id=key_id,
        )
        active = generation_engine.manager.get(result.message_id)
        if active is not None and active.task is not None:
            await active.task
        return result

    result = asyncio.run(_retry())
    assert result.message_id != failed.id

    db.expire_all()
    orig = conv_service.get_message(db, failed.id)
    assert orig.status == MessageStatus.FAILED
    assert orig.content == "first try failed"
    retry = conv_service.get_message(db, result.message_id)
    assert retry.status == MessageStatus.COMPLETED
    assert retry.content == "second answer"
    assert retry.parent_message_id == orig.parent_message_id

    sibs = conv_service.message_siblings(db, retry.id, user_id)
    assert sorted(m.version_number for m in sibs) == [1, 2]
    assert conv_service.conversation_tree(db, conv.id, user_id)["active_leaf_id"] == retry.id
    assert [m.id for m in active_path(db, conv.id, user_id)][-2:] == [u.id, retry.id]


def test_concurrent_duplicate_submissions_do_not_corrupt_tree(db: Session, client, user_factory, provider_factory, model_factory, monkeypatch):
    """Same client_key adopts (no 500/duplicate); different key while running 409s; tree stays gapless.

    Unscoped (no user_id) like test_generations.test_same_client_key_adopts_single_row:
    setup still uses an authed user for provider/model factories, but the
    generations run unscoped so the proven SlowAdapter path is exercised.
    """
    user_factory()
    provider = provider_factory()
    model = model_factory(provider["id"])
    monkeypatch.setattr(gateway_service, "build_adapter", lambda *a, **k: _SlowAdapter(delay=0.02))

    ckey = f"key-{uuid.uuid4().hex}"

    def _req(key: str | None, **kw):
        payload = dict(provider_id=provider["id"], model_id=model["id"], message="go", **kw)
        if key is not None:
            payload["client_key"] = key
        return ChatRequest(
            provider_id=uuid.UUID(payload["provider_id"]),
            model_id=uuid.UUID(payload["model_id"]),
            message=payload["message"],
            client_key=payload.get("client_key"),
            conversation_id=payload.get("conversation_id"),
        )

    async def _main():
        first = await gateway_service.start_generation(db, _req(ckey))
        # Lost-response retry with the same key adopts the in-flight row: no 500, no duplicate.
        second = await gateway_service.start_generation(db, _req(ckey))
        assert second.generation_id == first.generation_id
        # A different send on the SAME conversation while the first is RUNNING
        # conflicts (409), never 500/duplicates.
        with pytest.raises(ConflictError):
            await gateway_service.start_generation(
                db, _req(f"other-{uuid.uuid4().hex}", conversation_id=first.conversation_id)
            )
        await generation_engine.manager.get(first.generation_id).task
        return first

    started = asyncio.run(_main())

    db.expire_all()
    assistants = [m for m in conv_service.list_messages(db, started.conversation_id) if m.role == Role.ASSISTANT]
    assert len(assistants) == 1
    assert assistants[0].status == MessageStatus.COMPLETED
    tree = conv_service.conversation_tree(db, started.conversation_id)
    assert tree["active_leaf_id"] == started.message_id
    # Sibling versions under each parent stay gapless starting at 1.
    from collections import defaultdict
    by_parent: dict = defaultdict(list)
    for n in tree["nodes"]:
        by_parent[n["parent_message_id"]] += [n["version_number"]]
    for versions in by_parent.values():
        assert sorted(versions) == list(range(1, len(versions) + 1))

    # Terminal adoption: same key after completion returns the finished row (no new row, no 500).
    adopted = asyncio.run(gateway_service.start_generation(db, _req(ckey)))
    assert adopted.generation_id == started.generation_id
    assert adopted.status == "completed"


def test_delete_leaf_retargets_to_parent(db: Session, client, user_factory):
    """Deleting the active leaf moves it to the nearest live ancestor."""
    from tollms.api.messages import service as msg_service

    user_factory()
    user_id = uuid.UUID(client.get("/auth/me").json()["id"])
    conv = _seed_conv(db, user_id)

    r1 = add_message(db, conv.id, Role.USER, "root", user_id=user_id, use_active_leaf=False)
    a1 = add_message(db, conv.id, Role.ASSISTANT, "answer", user_id=user_id,
                     parent_message_id=r1.id, use_active_leaf=False)
    u2 = add_message(db, conv.id, Role.USER, "follow-up", user_id=user_id,
                     parent_message_id=a1.id, use_active_leaf=False)
    conv_service.select_message(db, conv.id, u2.id, user_id)
    assert conv_service.conversation_tree(db, conv.id, user_id)["active_leaf_id"] == u2.id

    msg_service.delete_message(db, u2.id, user_id)
    db.expire_all()

    assert conv_service.conversation_tree(db, conv.id, user_id)["active_leaf_id"] == a1.id
    assert [m.id for m in active_path(db, conv.id, user_id)] == [r1.id, a1.id]


def test_delete_branch_tip_falls_back_to_newest(db: Session, client, user_factory):
    """With no live ancestor left, deleting the leaf tip falls back to newest live (never dangles)."""
    from tollms.api.messages import service as msg_service

    user_factory()
    user_id = uuid.UUID(client.get("/auth/me").json()["id"])
    conv = _seed_conv(db, user_id)

    u = add_message(db, conv.id, Role.USER, "request", user_id=user_id, use_active_leaf=False)
    a1 = add_message(db, conv.id, Role.ASSISTANT, "branch one", user_id=user_id,
                     parent_message_id=u.id, use_active_leaf=False)
    a2 = add_message(db, conv.id, Role.ASSISTANT, "branch two", user_id=user_id,
                     parent_message_id=u.id, use_active_leaf=False)
    conv_service.select_message(db, conv.id, a2.id, user_id)

    # Remove the shared request first so the tip has no live ancestor left:
    # this exercises the newest-live fallback instead of the ancestor path.
    msg_service.delete_message(db, u.id, user_id)
    assert conv_service.conversation_tree(db, conv.id, user_id)["active_leaf_id"] == a2.id

    msg_service.delete_message(db, a2.id, user_id)
    db.expire_all()

    live = conv_service.list_messages(db, conv.id, user_id)
    newest = max(live, key=lambda m: (m.created_at, m.id))
    assert newest.id == a1.id
    tree = conv_service.conversation_tree(db, conv.id, user_id)
    assert tree["active_leaf_id"] == newest.id
    assert tree["active_leaf_id"] != a2.id


def test_select_deleted_message_404_leaf_unchanged(db: Session, client, user_factory):
    """Selecting a soft-deleted node 404s and never moves the leaf."""
    from tollms.api.messages import service as msg_service

    user_factory()
    user_id = uuid.UUID(client.get("/auth/me").json()["id"])
    conv = _seed_conv(db, user_id)

    r1 = add_message(db, conv.id, Role.USER, "root", user_id=user_id, use_active_leaf=False)
    a1 = add_message(db, conv.id, Role.ASSISTANT, "answer", user_id=user_id,
                     parent_message_id=r1.id, use_active_leaf=False)
    conv_service.select_message(db, conv.id, a1.id, user_id)

    msg_service.delete_message(db, a1.id, user_id)
    db.expire_all()
    leaf_before = conv_service.conversation_tree(db, conv.id, user_id)["active_leaf_id"]
    assert leaf_before == r1.id

    with pytest.raises(NotFoundError):
        conv_service.select_message(db, conv.id, a1.id, user_id)
    db.expire_all()
    assert conv_service.conversation_tree(db, conv.id, user_id)["active_leaf_id"] == leaf_before


def test_select_request_descends_to_response_tip(db: Session, client, user_factory):
    """Selecting a request lands the leaf on its response child — the view never ends at the request."""
    user_factory()
    user_id = uuid.UUID(client.get("/auth/me").json()["id"])
    conv = _seed_conv(db, user_id)

    u = add_message(db, conv.id, Role.USER, "q", user_id=user_id, use_active_leaf=False)
    a = add_message(db, conv.id, Role.ASSISTANT, "a", user_id=user_id,
                    parent_message_id=u.id, use_active_leaf=False)
    # Park the leaf off-branch so the select must descend instead of keep.
    r2 = add_message(db, conv.id, Role.USER, "other root", user_id=user_id, use_active_leaf=False)
    assert conv_service.conversation_tree(db, conv.id, user_id)["active_leaf_id"] == r2.id

    res = conv_service.select_message(db, conv.id, u.id, user_id)
    assert res["active_leaf_id"] == a.id
    assert [m.id for m in res["path"]] == [u.id, a.id]


def test_select_ancestor_of_current_leaf_keeps_tip(db: Session, client, user_factory):
    """Selecting an ancestor of what is viewed keeps the leaf — the full path below stays shown."""
    user_factory()
    user_id = uuid.UUID(client.get("/auth/me").json()["id"])
    conv = _seed_conv(db, user_id)

    u = add_message(db, conv.id, Role.USER, "q", user_id=user_id, use_active_leaf=False)
    a = add_message(db, conv.id, Role.ASSISTANT, "a", user_id=user_id,
                    parent_message_id=u.id, use_active_leaf=False)
    before = conv_service.conversation_tree(db, conv.id, user_id)["active_leaf_id"]
    assert before == a.id

    res = conv_service.select_message(db, conv.id, u.id, user_id)
    assert res["active_leaf_id"] == before
    assert [m.id for m in res["path"]] == [u.id, a.id]


def test_select_inactive_branch_descends_to_deepest_tip(db: Session, client, user_factory):
    """Selecting a node whose inactive branch runs several levels deep lands on the deepest tip."""
    user_factory()
    user_id = uuid.UUID(client.get("/auth/me").json()["id"])
    conv = _seed_conv(db, user_id)

    u = add_message(db, conv.id, Role.USER, "q", user_id=user_id, use_active_leaf=False)
    a1 = add_message(db, conv.id, Role.ASSISTANT, "a1", user_id=user_id,
                     parent_message_id=u.id, use_active_leaf=False)
    a2 = add_message(db, conv.id, Role.ASSISTANT, "a2", user_id=user_id,
                     parent_message_id=u.id, use_active_leaf=False)
    u2 = add_message(db, conv.id, Role.USER, "follow-up", user_id=user_id,
                     parent_message_id=a1.id, use_active_leaf=False)
    a3 = add_message(db, conv.id, Role.ASSISTANT, "deep tip", user_id=user_id,
                     parent_message_id=u2.id, use_active_leaf=False)
    conv_service.select_message(db, conv.id, a2.id, user_id)

    res = conv_service.select_message(db, conv.id, a1.id, user_id)
    assert res["active_leaf_id"] == a3.id
    assert [m.id for m in res["path"]] == [u.id, a1.id, u2.id, a3.id]


def test_select_descend_newest_version_child_wins(db: Session, client, user_factory):
    """Greedy per-level descent: the newest-version child wins even when an older sibling has a deeper subtree."""
    user_factory()
    user_id = uuid.UUID(client.get("/auth/me").json()["id"])
    conv = _seed_conv(db, user_id)

    u = add_message(db, conv.id, Role.USER, "q", user_id=user_id, use_active_leaf=False)
    c1 = add_message(db, conv.id, Role.ASSISTANT, "older", user_id=user_id,
                     parent_message_id=u.id, use_active_leaf=False)
    add_message(db, conv.id, Role.USER, "deep below older", user_id=user_id,
                parent_message_id=c1.id, use_active_leaf=False)
    c2 = add_message(db, conv.id, Role.ASSISTANT, "newer childless", user_id=user_id,
                     parent_message_id=u.id, use_active_leaf=False)
    assert (c1.version_number, c2.version_number) == (1, 2)
    # Park the leaf off-branch so the select must descend instead of keep.
    r2 = add_message(db, conv.id, Role.USER, "other root", user_id=user_id, use_active_leaf=False)
    assert conv_service.conversation_tree(db, conv.id, user_id)["active_leaf_id"] == r2.id

    res = conv_service.select_message(db, conv.id, u.id, user_id)
    assert res["active_leaf_id"] == c2.id
    assert [m.id for m in res["path"]] == [u.id, c2.id]


def test_select_failed_childless_node_is_tip(db: Session, client, user_factory):
    """A FAILED response with no children is a valid tip — selecting it lands there."""
    user_factory()
    user_id = uuid.UUID(client.get("/auth/me").json()["id"])
    conv = _seed_conv(db, user_id)

    u = add_message(db, conv.id, Role.USER, "q", user_id=user_id, use_active_leaf=False)
    failed = add_message(db, conv.id, Role.ASSISTANT, "boom", user_id=user_id,
                         status=MessageStatus.FAILED,
                         parent_message_id=u.id, use_active_leaf=False)
    r2 = add_message(db, conv.id, Role.USER, "other root", user_id=user_id, use_active_leaf=False)
    assert conv_service.conversation_tree(db, conv.id, user_id)["active_leaf_id"] == r2.id

    res = conv_service.select_message(db, conv.id, failed.id, user_id)
    assert res["active_leaf_id"] == failed.id
    assert [m.id for m in res["path"]] == [u.id, failed.id]


def test_select_deleted_request_404_leaf_unchanged(db: Session, client, user_factory):
    """Selecting a soft-deleted request 404s and never moves the leaf."""
    from tollms.api.messages import service as msg_service

    user_factory()
    user_id = uuid.UUID(client.get("/auth/me").json()["id"])
    conv = _seed_conv(db, user_id)

    u = add_message(db, conv.id, Role.USER, "q", user_id=user_id, use_active_leaf=False)
    add_message(db, conv.id, Role.ASSISTANT, "a", user_id=user_id,
                parent_message_id=u.id, use_active_leaf=False)
    r2 = add_message(db, conv.id, Role.USER, "other root", user_id=user_id, use_active_leaf=False)
    msg_service.delete_message(db, u.id, user_id)
    db.expire_all()
    leaf_before = conv_service.conversation_tree(db, conv.id, user_id)["active_leaf_id"]
    assert leaf_before == r2.id

    with pytest.raises(NotFoundError):
        conv_service.select_message(db, conv.id, u.id, user_id)
    db.expire_all()
    assert conv_service.conversation_tree(db, conv.id, user_id)["active_leaf_id"] == leaf_before
