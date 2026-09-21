"""Conversation search: PostgreSQL FTS with ranking, snippets and filters."""

import uuid

from sqlalchemy.orm import Session

from tollms.api.conversations.service import add_message, create_conversation
from tollms.api.conversations.schemas import ConversationCreate
from tollms.models.message import Role


def _seed(db: Session, user_id, provider_id, model_id, title: str, exchanges: list[tuple[str, str]]):
    conversation = create_conversation(
        db, ConversationCreate(title=title, provider_id=provider_id, model_id=model_id), user_id
    )
    for prompt, answer in exchanges:
        add_message(db, conversation.id, Role.USER, prompt, user_id=user_id, provider_id=provider_id, model_id=model_id)
        add_message(
            db, conversation.id, Role.ASSISTANT, answer, user_id=user_id, provider_id=provider_id, model_id=model_id
        )
    return conversation


def _user_id(client) -> uuid.UUID:
    return uuid.UUID(client.get("/auth/me").json()["id"])


def test_search_finds_message_content_with_rank_and_snippet(
    db: Session, client, user_factory, provider_factory, model_factory
):
    user_factory()
    provider = provider_factory()
    model = model_factory(provider["id"])
    user_id = _user_id(client)
    _seed(
        db,
        user_id,
        uuid.UUID(provider["id"]),
        uuid.UUID(model["id"]),
        "Database tuning",
        [("How do I tune postgresql full text search?", "Use a GIN index on the tsvector column.")],
    )

    body = client.get("/api/v1/search", params={"q": "postgresql full text"}).json()
    assert body["total"] >= 1
    top = body["results"][0]
    assert top["conversation_title"] == "Database tuning"
    assert top["kind"] == "message"
    assert top["rank"] > 0
    assert "mark" in top["snippet"] or "postgresql" in top["snippet"].lower()


def test_search_matches_conversation_title(db: Session, client, user_factory, provider_factory, model_factory):
    user_factory()
    provider = provider_factory()
    model = model_factory(provider["id"])
    user_id = _user_id(client)
    _seed(
        db,
        user_id,
        uuid.UUID(provider["id"]),
        uuid.UUID(model["id"]),
        "Kubernetes autoscaling notes",
        [("hello", "world")],
    )

    body = client.get("/api/v1/search", params={"q": "kubernetes autoscaling"}).json()
    assert body["total"] >= 1
    kinds = {row["kind"] for row in body["results"]}
    assert "conversation" in kinds


def test_search_filters_by_provider_and_model(db: Session, client, user_factory, provider_factory, model_factory):
    user_factory()
    provider_a = provider_factory("Alpha")
    provider_b = provider_factory("Beta")
    model_a = model_factory(provider_a["id"], model_id="alpha-model", name="Alpha Model")
    model_b = model_factory(provider_b["id"], model_id="beta-model", name="Beta Model")
    user_id = _user_id(client)
    _seed(db, user_id, uuid.UUID(provider_a["id"]), uuid.UUID(model_a["id"]), "Alpha talk", [("shared keyword", "a")])
    _seed(db, user_id, uuid.UUID(provider_b["id"]), uuid.UUID(model_b["id"]), "Beta talk", [("shared keyword", "b")])

    all_hits = client.get("/api/v1/search", params={"q": "shared keyword"}).json()
    assert all_hits["total"] == 2

    filtered = client.get(
        "/api/v1/search", params={"q": "shared keyword", "provider_id": provider_a["id"]}
    ).json()
    assert filtered["total"] == 1
    assert filtered["results"][0]["provider_name"] == "Alpha"

    by_model = client.get(
        "/api/v1/search", params={"q": "shared keyword", "model_id": model_b["id"]}
    ).json()
    assert by_model["total"] == 1
    assert by_model["results"][0]["model_name"] == "Beta Model"


def test_search_is_owner_scoped(db: Session, client, user_factory, provider_factory, model_factory):
    user_factory("owner@tollma.ai")
    provider = provider_factory()
    model = model_factory(provider["id"])
    user_id = _user_id(client)
    _seed(db, user_id, uuid.UUID(provider["id"]), uuid.UUID(model["id"]), "Private notes", [("secret passphrase", "x")])

    client.post("/auth/logout")
    user_factory("intruder@tollma.ai")
    body = client.get("/api/v1/search", params={"q": "secret passphrase"}).json()
    assert body["total"] == 0


def test_search_index_status(client, user_factory, provider_factory, model_factory, db):
    user_factory()
    provider = provider_factory()
    model = model_factory(provider["id"])
    _seed(
        db,
        _user_id(client),
        uuid.UUID(provider["id"]),
        uuid.UUID(model["id"]),
        "Indexed",
        [("alpha", "beta")],
    )
    status = client.get("/api/v1/search/status").json()
    assert status["indexed_documents"] == 3
    assert status["indexed_conversations"] == 1
    assert status["indexed_messages"] == 2


def test_search_blank_query_rejected(client, user_factory):
    user_factory()
    assert client.get("/api/v1/search", params={"q": ""}).status_code == 422
