"""Chat + analytics exports: Markdown, JSON, PDF, XLSX."""

import uuid

from sqlalchemy.orm import Session

from tollms.api.conversations.schemas import ConversationCreate
from tollms.api.conversations.service import add_message, create_conversation
from tollms.models.message import Role


def _conversation(db: Session, client, provider, model, title: str = "Export me"):
    user_id = uuid.UUID(client.get("/auth/me").json()["id"])
    conversation = create_conversation(
        db,
        ConversationCreate(title=title, provider_id=uuid.UUID(provider["id"]), model_id=uuid.UUID(model["id"])),
        user_id,
    )
    add_message(db, conversation.id, Role.USER, "What is ToLLma?", user_id=user_id)
    add_message(
        db,
        conversation.id,
        Role.ASSISTANT,
        "ToLLma routes to any provider.",
        usage=(10, 20, 30),
        cost=("0.0001", "0.0002", "0.0003"),
        latency_ms=120.0,
        user_id=user_id,
    )
    return conversation


def test_markdown_export_structure(db: Session, client, user_factory, provider_factory, model_factory):
    user_factory()
    provider = provider_factory()
    model = model_factory(provider["id"])
    conversation = _conversation(db, client, provider, model)

    r = client.get(f"/api/v1/exports/conversations/{conversation.id}?format=md")
    assert r.status_code == 200
    assert "attachment" in r.headers["content-disposition"]
    assert r.headers["content-disposition"].endswith('.md"')
    body = r.text
    assert "# Export me" in body
    assert "## User" in body
    assert "## Assistant" in body
    assert "What is ToLLma?" in body
    assert "30 tokens" in body


def test_json_export_includes_usage_and_model(db: Session, client, user_factory, provider_factory, model_factory):
    user_factory()
    provider = provider_factory()
    model = model_factory(provider["id"])
    conversation = _conversation(db, client, provider, model)

    body = client.get(f"/api/v1/exports/conversations/{conversation.id}?format=json").json()
    assert body["conversations"][0]["title"] == "Export me"
    payload = body["conversations"][0]
    assert payload["model"]["name"] == "Mock"
    assert payload["provider"]["name"] == provider["name"]
    assert len(payload["messages"]) == 2
    assistant = payload["messages"][1]
    assert assistant["usage"]["total_tokens"] == 30
    assert assistant["cost"]["total"] == 0.0003
    assert payload["usage_summary"]["total_tokens"] == 30


def test_pdf_export_is_a_pdf(db: Session, client, user_factory, provider_factory, model_factory):
    user_factory()
    provider = provider_factory()
    model = model_factory(provider["id"])
    conversation = _conversation(db, client, provider, model)

    r = client.get(f"/api/v1/exports/conversations/{conversation.id}?format=pdf")
    assert r.status_code == 200
    assert r.content.startswith(b"%PDF")
    assert len(r.content) > 800


def test_bulk_export_requires_scope(client, user_factory):
    user_factory()
    assert client.post("/api/v1/exports/conversations", json={"format": "md"}).status_code == 422


def test_account_export_all_conversations(db: Session, client, user_factory, provider_factory, model_factory):
    user_factory()
    provider = provider_factory()
    model = model_factory(provider["id"])
    _conversation(db, client, provider, model, "First")
    _conversation(db, client, provider, model, "Second")

    r = client.post("/api/v1/exports/conversations", json={"all": True, "format": "json"})
    assert r.status_code == 200
    payload = r.json()
    titles = {c["title"] for c in payload["conversations"]}
    assert {"First", "Second"} <= titles


def test_analytics_xlsx_export(client, user_factory):
    user_factory()
    r = client.get("/api/v1/exports/analytics", params={"dataset": "summary", "format": "xlsx"})
    assert r.status_code == 200
    assert r.content[:2] == b"PK"  # xlsx is a zip container
    assert "spreadsheetml" in r.headers["content-type"]

    csv = client.get("/api/v1/exports/analytics", params={"dataset": "summary", "format": "csv"})
    assert csv.status_code == 200
    assert "total_requests" in csv.text

    js = client.get("/api/v1/exports/analytics", params={"dataset": "summary", "format": "json"})
    assert js.json()["dataset"] == "summary"


def test_export_is_owner_scoped(db: Session, client, user_factory, provider_factory, model_factory):
    user_factory("owner@tollma.ai")
    provider = provider_factory()
    model = model_factory(provider["id"])
    conversation = _conversation(db, client, provider, model)

    client.post("/auth/logout")
    user_factory("intruder@tollma.ai")
    r = client.get(f"/api/v1/exports/conversations/{conversation.id}?format=md")
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "NOT_FOUND"
