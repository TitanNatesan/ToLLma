"""Message editing with versions, regeneration history, and conversation branching."""

import asyncio
import uuid

import pytest
from sqlalchemy.orm import Session, sessionmaker

from tollms.api.conversations.schemas import ConversationCreate
from tollms.api.conversations.service import add_message, create_conversation, get_message, list_messages
from tollms.api.gateway import service as gateway_service
from tollms.api.keys.service import ensure_primary_key
from tollms.api.gateway.schemas import ChatRequest
from tollms.models.message import MessageStatus, Role
from tollms.services import generation as generation_engine
from tollms.services.gateway.adapters.base import BaseProviderAdapter, StreamChunk


class FakeAdapter(BaseProviderAdapter):
    def __init__(self, text: str = "answer") -> None:
        super().__init__(credentials={}, model_id="fake")
        self._text = text

    async def chat_stream(self, messages):
        yield StreamChunk(delta=self._text, prompt_tokens=5, completion_tokens=5, total_tokens=10)


@pytest.fixture()
def fake(monkeypatch):
    adapter = FakeAdapter()
    monkeypatch.setattr(gateway_service, "build_adapter", lambda *a, **k: adapter)
    return adapter


@pytest.fixture()
def maker(db: Session):
    return sessionmaker(bind=db.get_bind())


def _wait_terminal(db: Session, message_id: uuid.UUID, timeout: float = 15.0) -> None:
    """Poll for a terminal message status (API-triggered tasks run on the app loop)."""
    import time

    deadline = time.time() + timeout
    while time.time() < deadline:
        db.expire_all()
        status = get_message(db, message_id).status
        if status in (MessageStatus.COMPLETED, MessageStatus.FAILED, MessageStatus.CANCELLED):
            return
        time.sleep(0.1)
    raise AssertionError(f"message {message_id} did not reach a terminal state")


def _seed(db: Session, client, provider, model, *, with_assistant: bool = True):
    user_id = uuid.UUID(client.get("/auth/me").json()["id"])
    conversation = create_conversation(
        db,
        ConversationCreate(title="History", provider_id=uuid.UUID(provider["id"]), model_id=uuid.UUID(model["id"])),
        user_id,
    )
    user_message = add_message(db, conversation.id, Role.USER, "first version", user_id=user_id)
    assistant = None
    if with_assistant:
        assistant = add_message(
            db,
            conversation.id,
            Role.ASSISTANT,
            "first answer",
            provider_id=uuid.UUID(provider["id"]),
            model_id=uuid.UUID(model["id"]),
            user_id=user_id,
            status=MessageStatus.COMPLETED,
        )
    return conversation, user_message, assistant


def test_edit_message_snapshots_versions(db: Session, client, user_factory, provider_factory, model_factory):
    user_factory()
    provider = provider_factory()
    model = model_factory(provider["id"])
    _conversation, user_message, _ = _seed(db, client, provider, model, with_assistant=False)

    def versions_count() -> int:
        conv = client.get(f"/api/v1/conversations/{_conversation.id}").json()
        return next(m["versions_count"] for m in conv["messages"] if m["id"] == str(user_message.id))

    # Never-edited messages report zero versions (the UI hides history).
    assert versions_count() == 0

    r = client.patch(f"/api/v1/messages/{user_message.id}", json={"content": "second version"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["message"]["content"] == "second version"
    assert body["regeneration_started"] is False
    assert [v["version_number"] for v in body["versions"]] == [1, 2]
    assert body["versions"][0]["content"] == "first version"
    assert body["versions"][1]["content"] == "second version"
    assert body["current_version"] == 2
    # After one edit the original + edit are both snapshotted.
    assert versions_count() == 2

    history = client.get(f"/api/v1/messages/{user_message.id}/history").json()
    assert history["current_version"] == 2
    assert len(history["versions"]) == 2
    assert history["generations"] == []

    # The edited content is searchable; the old one is gone.
    assert client.get("/api/v1/search", params={"q": "second version"}).json()["total"] >= 1
    assert client.get("/api/v1/search", params={"q": "first version"}).json()["total"] == 0


def test_edit_message_regenerates_following_response(
    db: Session, client, user_factory, provider_factory, model_factory, fake
):
    user_factory()
    provider = provider_factory()
    model = model_factory(provider["id"])
    _conversation, user_message, assistant = _seed(db, client, provider, model)
    user_id = uuid.UUID(client.get("/auth/me").json()["id"])
    key_id = ensure_primary_key(db, user_id).id

    r = client.patch(
        f"/api/v1/messages/{user_message.id}",
        params={"key_id": str(key_id)},
        json={"content": "edited prompt"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["regeneration_started"] is True
    assert body["regenerating_message_id"] == str(assistant.id)

    _wait_terminal(db, assistant.id)
    refreshed = get_message(db, assistant.id)
    assert refreshed.status == MessageStatus.COMPLETED
    assert refreshed.content == "answer"


def test_regeneration_preserves_every_run(
    db: Session, client, user_factory, provider_factory, model_factory, fake
):
    user_factory()
    provider = provider_factory()
    model = model_factory(provider["id"])
    conversation, user_message, _ = _seed(db, client, provider, model, with_assistant=False)
    user_id = uuid.UUID(client.get("/auth/me").json()["id"])

    async def _start():
        started = await gateway_service.start_generation(
            db,
            ChatRequest(
                provider_id=uuid.UUID(provider["id"]),
                model_id=uuid.UUID(model["id"]),
                key_id=ensure_primary_key(db, user_id).id,
                conversation_id=conversation.id,
                message="go",
            ),
            user_id=user_id,
        )
        active = generation_engine.manager.get(started.message_id)
        if active is not None and active.task is not None:
            await active.task
        return started

    started = asyncio.run(_start())
    db.expire_all()
    first = get_message(db, started.message_id)
    assert first.status == MessageStatus.COMPLETED
    assert first.content == "answer"

    fake._text = "second answer"

    async def _regen():
        result = await gateway_service.start_regeneration(
            db, started.message_id, user_id=user_id,
            key_id=ensure_primary_key(db, user_id).id,
        )
        active = generation_engine.manager.get(result.message_id)
        if active is not None and active.task is not None:
            await active.task
        return result

    asyncio.run(_regen())
    db.expire_all()
    regenerated = get_message(db, started.message_id)
    assert regenerated.content == "second answer"
    assert regenerated.status == MessageStatus.COMPLETED

    runs = client.get(f"/api/v1/messages/{started.message_id}/generations").json()
    assert [run["generation_number"] for run in runs] == [1, 2]
    assert runs[0]["content"] == "answer"
    assert runs[1]["content"] == "second answer"
    assert runs[1]["is_active"] is True
    assert runs[0]["is_active"] is False
    assert runs[1]["total_tokens"] == 10

    # Request logs record the regeneration.
    logs = client.get("/api/v1/request-logs?regenerations_only=true").json()
    assert logs["total"] == 1
    assert logs["items"][0]["is_regeneration"] is True


def test_activate_generation_switches_visible_response(
    db: Session, client, user_factory, provider_factory, model_factory, fake
):
    user_factory()
    provider = provider_factory()
    model = model_factory(provider["id"])
    conversation, user_message, _ = _seed(db, client, provider, model, with_assistant=False)
    user_id = uuid.UUID(client.get("/auth/me").json()["id"])

    async def _run(message: str):
        started = await gateway_service.start_generation(
            db,
            ChatRequest(
                provider_id=uuid.UUID(provider["id"]),
                model_id=uuid.UUID(model["id"]),
                key_id=ensure_primary_key(db, user_id).id,
                conversation_id=conversation.id,
                message=message,
            ),
            user_id=user_id,
        )
        active = generation_engine.manager.get(started.message_id)
        if active is not None and active.task is not None:
            await active.task
        return started

    started = asyncio.run(_run("one"))
    fake._text = "two"

    async def _regen():
        result = await gateway_service.start_regeneration(
            db, started.message_id, user_id=user_id,
            key_id=ensure_primary_key(db, user_id).id,
        )
        active = generation_engine.manager.get(result.message_id)
        if active is not None and active.task is not None:
            await active.task

    asyncio.run(_regen())
    runs = client.get(f"/api/v1/messages/{started.message_id}/generations").json()
    first_run = next(run for run in runs if run["generation_number"] == 1)

    activated = client.post(
        f"/api/v1/messages/{started.message_id}/generations/{first_run['id']}/activate"
    )
    assert activated.status_code == 200, activated.text
    assert activated.json()["message"]["content"] == "answer"
    assert activated.json()["run"]["generation_number"] == 1

    db.expire_all()
    assert get_message(db, started.message_id).content == "answer"


def test_branch_copies_messages_and_records_lineage(
    db: Session, client, user_factory, provider_factory, model_factory
):
    user_factory()
    provider = provider_factory()
    model = model_factory(provider["id"])
    conversation, user_message, assistant = _seed(db, client, provider, model)

    r = client.post(
        f"/api/v1/conversations/{conversation.id}/branches",
        json={"message_id": str(assistant.id), "branch_name": "Try another answer"},
    )
    assert r.status_code == 201, r.text
    branch = r.json()
    assert branch["parent_conversation_id"] == str(conversation.id)
    assert branch["branch_from_message_id"] == str(assistant.id)
    assert branch["branch_name"] == "Try another answer"

    copied = list_messages(db, uuid.UUID(branch["conversation_id"]))
    assert [message.content for message in copied] == ["first version", "first answer"]

    tree = client.get(f"/api/v1/conversations/{branch['conversation_id']}/branches").json()
    assert tree["parent"]["conversation_id"] == str(conversation.id)
    assert tree["current"]["branch_name"] == "Try another answer"

    parent_tree = client.get(f"/api/v1/conversations/{conversation.id}/branches").json()
    assert [child["conversation_id"] for child in parent_tree["children"]] == [branch["conversation_id"]]


def test_delete_message_removes_it_from_search(
    db: Session, client, user_factory, provider_factory, model_factory
):
    user_factory()
    provider = provider_factory()
    model = model_factory(provider["id"])
    _conversation, user_message, _ = _seed(db, client, provider, model, with_assistant=False)

    assert client.get("/api/v1/search", params={"q": "first version"}).json()["total"] >= 1
    assert client.delete(f"/api/v1/messages/{user_message.id}").status_code == 204
    assert client.get("/api/v1/search", params={"q": "first version"}).json()["total"] == 0


def test_history_is_owner_scoped(db: Session, client, user_factory, provider_factory, model_factory):
    user_factory("owner@tollma.ai")
    provider = provider_factory()
    model = model_factory(provider["id"])
    _conversation, user_message, _ = _seed(db, client, provider, model, with_assistant=False)

    client.post("/auth/logout")
    user_factory("intruder@tollma.ai")
    r = client.patch(f"/api/v1/messages/{user_message.id}", json={"content": "hijack"})
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "NOT_FOUND"
