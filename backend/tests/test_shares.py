"""Conversation sharing: public read-only links with revocation and expiry."""

import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from tollms.api.conversations.schemas import ConversationCreate
from tollms.api.conversations.service import add_message, create_conversation
from tollms.models.message import Role


def _conversation(db: Session, client, provider, model, title: str = "Shareable"):
    user_id = uuid.UUID(client.get("/auth/me").json()["id"])
    conversation = create_conversation(
        db,
        ConversationCreate(title=title, provider_id=uuid.UUID(provider["id"]), model_id=uuid.UUID(model["id"])),
        user_id,
    )
    add_message(db, conversation.id, Role.USER, "public question", user_id=user_id)
    add_message(db, conversation.id, Role.ASSISTANT, "public answer", user_id=user_id)
    return conversation


def test_create_share_and_read_publicly(db: Session, client, user_factory, provider_factory, model_factory):
    user_factory()
    provider = provider_factory()
    model = model_factory(provider["id"])
    conversation = _conversation(db, client, provider, model)

    created = client.post("/api/v1/shares", json={"conversation_id": str(conversation.id)})
    assert created.status_code == 201, created.text
    share = created.json()
    assert share["is_public"] is True
    assert share["share_url"] == f"/share/{share['share_token']}"

    client.cookies.clear()  # public view needs no auth
    public = client.get(f"/api/v1/shares/public/{share['share_token']}")
    assert public.status_code == 200
    body = public.json()
    assert body["title"] == "Shareable"
    assert [m["role"] for m in body["messages"]] == ["user", "assistant"]
    assert body["messages"][0]["content"] == "public question"
    assert body["model_name"] == "Mock"
    assert body["view_count"] == 1

    # No user or credential information leaks.
    serialized = public.text
    assert "@tollma.ai" not in serialized
    assert "password" not in serialized
    assert "credentials" not in serialized


def test_create_share_is_idempotent(db: Session, client, user_factory, provider_factory, model_factory):
    user_factory()
    provider = provider_factory()
    model = model_factory(provider["id"])
    conversation = _conversation(db, client, provider, model)

    first = client.post("/api/v1/shares", json={"conversation_id": str(conversation.id)}).json()
    second = client.post("/api/v1/shares", json={"conversation_id": str(conversation.id)}).json()
    assert first["share_token"] == second["share_token"]
    assert len(client.get(f"/api/v1/shares?conversation_id={conversation.id}").json()) == 1


def test_disable_share_blocks_public_access(db: Session, client, user_factory, provider_factory, model_factory):
    user_factory()
    provider = provider_factory()
    model = model_factory(provider["id"])
    conversation = _conversation(db, client, provider, model)
    share = client.post("/api/v1/shares", json={"conversation_id": str(conversation.id)}).json()

    disabled = client.delete(f"/api/v1/shares/{share['id']}")
    assert disabled.status_code == 200
    assert disabled.json()["is_public"] is False

    assert client.get(f"/api/v1/shares/public/{share['share_token']}").status_code == 404


def test_regenerate_rotates_token(db: Session, client, user_factory, provider_factory, model_factory):
    user_factory()
    provider = provider_factory()
    model = model_factory(provider["id"])
    conversation = _conversation(db, client, provider, model)
    share = client.post("/api/v1/shares", json={"conversation_id": str(conversation.id)}).json()

    rotated = client.post(f"/api/v1/shares/{share['id']}/regenerate").json()
    assert rotated["share_token"] != share["share_token"]
    assert client.get(f"/api/v1/shares/public/{share['share_token']}").status_code == 404
    assert client.get(f"/api/v1/shares/public/{rotated['share_token']}").status_code == 200


def test_expired_share_is_not_public(db: Session, client, user_factory, provider_factory, model_factory):
    user_factory()
    provider = provider_factory()
    model = model_factory(provider["id"])
    conversation = _conversation(db, client, provider, model)
    share = client.post(
        "/api/v1/shares", json={"conversation_id": str(conversation.id), "expires_in_hours": 1}
    ).json()

    from tollms.models.share import ConversationShare

    row = db.get(ConversationShare, uuid.UUID(share["id"]))
    row.expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
    db.commit()

    client.cookies.clear()
    assert client.get(f"/api/v1/shares/public/{share['share_token']}").status_code == 404


def test_share_requires_ownership(db: Session, client, user_factory, provider_factory, model_factory):
    user_factory("owner@tollma.ai")
    provider = provider_factory()
    model = model_factory(provider["id"])
    conversation = _conversation(db, client, provider, model)

    client.post("/auth/logout")
    user_factory("intruder@tollma.ai")
    r = client.post("/api/v1/shares", json={"conversation_id": str(conversation.id)})
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "NOT_FOUND"
