"""Deterministic platform-admin aggregations.

Seeds a tiny fact table directly (one provider, two models, one regular user)
so every total is an exact number, then asserts each admin endpoint against
those sums for `preset=last_7d`. Costs follow the production invariant from
`services/gateway/costing.py`:
`total_cost = input + output + cache_read + cache_write + reasoning`.
"""

import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tollms.models.attachment import Attachment
from tollms.models.conversation import Conversation
from tollms.models.message import Message, MessageStatus, Role
from tollms.models.request_log import RequestLog, RequestStatus
from tollms.models.user import PlatformRole, User

WINDOW = {"preset": "last_7d", "timezone": "UTC"}
FAILED_CODE = "provider_error"


def _decimal(value) -> Decimal:
    """JSON may carry floats or decimal strings; compare without float drift."""
    return Decimal(str(value))


def _at() -> datetime:
    return datetime.now(timezone.utc) - timedelta(hours=1)


def _promote(db: Session, user_id: str) -> None:
    user = db.get(User, uuid.UUID(user_id))
    assert user is not None, "signup did not persist the user"
    user.platform_role = PlatformRole.PLATFORM_ADMIN
    db.commit()


def _regular_user(db: Session, email: str) -> User:
    """Direct ORM insert: signing up through the API would rotate the client cookie."""
    user = User(email=email, password_hash="not-used", has_password=True)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _conversation(db: Session, user_id: uuid.UUID, title: str) -> Conversation:
    conversation = Conversation(user_id=user_id, title=title)
    db.add(conversation)
    db.commit()
    db.refresh(conversation)
    return conversation


def _assistant(
    db: Session,
    *,
    user_id: uuid.UUID,
    conversation_id: uuid.UUID,
    provider_id: uuid.UUID | None,
    model_id: uuid.UUID | None,
    created_at: datetime,
    prompt: int = 0,
    completion: int = 0,
    input_cost: str = "0",
    output_cost: str = "0",
    cache_read_tokens: int = 0,
    cache_read_cost: str = "0",
    latency: float | None = 1000.0,
    status: MessageStatus = MessageStatus.COMPLETED,
    error_code: str | None = None,
    metadata: dict | None = None,
) -> Message:
    input_d = Decimal(input_cost)
    output_d = Decimal(output_cost)
    cache_read_d = Decimal(cache_read_cost)
    message = Message(
        user_id=user_id,
        conversation_id=conversation_id,
        role=Role.ASSISTANT,
        content="admin aggregation fixture answer",
        provider_id=provider_id,
        model_id=model_id,
        status=status,
        created_at=created_at,
        completed_at=created_at,
        error_code=error_code,
        metadata_=metadata or {},
        prompt_tokens=prompt,
        completion_tokens=completion,
        total_tokens=prompt + completion,
        cache_read_tokens=cache_read_tokens,
        cache_write_tokens=0,
        reasoning_tokens=0,
        input_cost=input_d,
        output_cost=output_d,
        cache_read_cost=cache_read_d,
        cache_write_cost=Decimal("0"),
        reasoning_cost=Decimal("0"),
        total_cost=input_d + output_d + cache_read_d,
        latency_ms=latency,
    )
    db.add(message)
    db.flush()
    return message


def _seed_usage(client: TestClient, db: Session, user_factory, provider_factory, model_factory):
    """Two models, three completed requests, one regular user. Exact sums:

    totals: requests=3, prompt=3100, completion=1550, tokens=4650, cost=3.75
    model A: requests=2, tokens=4500, cost=3.25 (1_000_000 cached tokens)
    model B: requests=1, tokens=150, cost=0.50
    """
    admin = user_factory("agg-admin@tollma.ai")
    regular = _regular_user(db, "agg-user@tollma.ai")
    provider = provider_factory("Agg Provider")
    model_a = model_factory(
        provider["id"], model_id="agg-a", name="Agg Model A", cache_read_price="0.25"
    )
    model_b = model_factory(provider["id"], model_id="agg-b", name="Agg Model B")
    conversation = _conversation(db, regular.id, "Agg conversation")

    provider_id = uuid.UUID(provider["id"])
    at = _at()
    _assistant(
        db,
        user_id=regular.id,
        conversation_id=conversation.id,
        provider_id=provider_id,
        model_id=uuid.UUID(model_a["id"]),
        created_at=at,
        prompt=1000,
        completion=500,
        input_cost="0.40",
        output_cost="0.60",
    )
    _assistant(
        db,
        user_id=regular.id,
        conversation_id=conversation.id,
        provider_id=provider_id,
        model_id=uuid.UUID(model_a["id"]),
        created_at=at,
        prompt=2000,
        completion=1000,
        input_cost="0.90",
        output_cost="1.10",
        cache_read_tokens=1_000_000,
        cache_read_cost="0.25",
    )
    _assistant(
        db,
        user_id=regular.id,
        conversation_id=conversation.id,
        provider_id=provider_id,
        model_id=uuid.UUID(model_b["id"]),
        created_at=at,
        prompt=100,
        completion=50,
        input_cost="0.20",
        output_cost="0.30",
    )
    db.commit()

    _promote(db, admin["id"])
    return admin, regular, provider, model_a, model_b, conversation


def test_usage_totals_match_seeded_sums(
    client: TestClient, db: Session, user_factory, provider_factory, model_factory
) -> None:
    _seed_usage(client, db, user_factory, provider_factory, model_factory)

    r = client.get("/api/admin/usage", params=WINDOW)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["requests"] == 3
    assert data["failed_requests"] == 0
    assert data["total_tokens"] == 4650
    assert _decimal(data["total_cost"]) == Decimal("3.75")

    by_model = {row["model_name"]: row for row in data["by_model"]}
    assert by_model["Agg Model A"]["requests"] == 2
    assert by_model["Agg Model A"]["total_tokens"] == 4500
    assert _decimal(by_model["Agg Model A"]["total_cost"]) == Decimal("3.25")
    assert by_model["Agg Model B"]["requests"] == 1
    assert _decimal(by_model["Agg Model B"]["total_cost"]) == Decimal("0.50")

    by_provider = {row["provider_name"]: row for row in data["by_provider"]}
    assert by_provider["Agg Provider"]["requests"] == 3
    assert _decimal(by_provider["Agg Provider"]["total_cost"]) == Decimal("3.75")


def test_costs_total_rows_and_cache_savings(
    client: TestClient, db: Session, user_factory, provider_factory, model_factory
) -> None:
    _seed_usage(client, db, user_factory, provider_factory, model_factory)

    r = client.get("/api/admin/costs", params=WINDOW)
    assert r.status_code == 200, r.text
    data = r.json()
    assert _decimal(data["total_cost"]) == Decimal("3.75")
    assert _decimal(data["previous_cost"]) == Decimal("0")
    assert _decimal(data["projected_month_cost"]) > 0

    by_model = {row["model_name"]: row for row in data["by_model"]}
    assert _decimal(by_model["Agg Model A"]["total_cost"]) == Decimal("3.25")
    assert by_model["Agg Model A"]["requests"] == 2
    assert _decimal(by_model["Agg Model B"]["total_cost"]) == Decimal("0.50")

    # 1M cached tokens priced at 0.25 vs 2.50 input price per 1M -> real savings.
    assert _decimal(data["cache_savings"]) > 0


def test_tokens_totals_and_cached_share(
    client: TestClient, db: Session, user_factory, provider_factory, model_factory
) -> None:
    _seed_usage(client, db, user_factory, provider_factory, model_factory)

    r = client.get("/api/admin/tokens", params=WINDOW)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["prompt_tokens"] == 3100
    assert data["completion_tokens"] == 1550
    assert data["total_tokens"] == 4650
    assert data["cache_read_tokens"] == 1_000_000
    assert 0 < data["cached_share"] <= 100


def test_models_and_providers_rows_include_seeded_names(
    client: TestClient, db: Session, user_factory, provider_factory, model_factory
) -> None:
    _seed_usage(client, db, user_factory, provider_factory, model_factory)

    models = client.get("/api/admin/models", params=WINDOW).json()
    names = {row["model_name"] for row in models["rows"]}
    assert {"Agg Model A", "Agg Model B"} <= names
    row_a = next(row for row in models["rows"] if row["model_name"] == "Agg Model A")
    assert row_a["requests"] == 2
    assert row_a["total_tokens"] == 4500

    providers = client.get("/api/admin/providers", params=WINDOW).json()
    provider = next(row for row in providers["rows"] if row["provider_name"] == "Agg Provider")
    assert provider["requests"] == 3
    assert _decimal(provider["total_cost"]) == Decimal("3.75")
    assert provider["provider_type"] == "CUSTOM"


def test_users_rows_include_seeded_email_and_cost(
    client: TestClient, db: Session, user_factory, provider_factory, model_factory
) -> None:
    _seed_usage(client, db, user_factory, provider_factory, model_factory)

    r = client.get(
        "/api/admin/users",
        params={**WINDOW, "search": "agg-user@tollma.ai", "limit": 50},
    )
    assert r.status_code == 200, r.text
    data = r.json()
    row = next(row for row in data["rows"] if row["email"] == "agg-user@tollma.ai")
    assert row["requests"] == 3
    assert row["total_tokens"] == 4650
    assert _decimal(row["total_cost"]) == Decimal("3.75")
    assert row["conversations"] == 1


def test_media_counts_image_message_and_attachment_bytes(
    client: TestClient, db: Session, user_factory, provider_factory, model_factory
) -> None:
    admin = user_factory("agg-admin-media@tollma.ai")
    provider = provider_factory("Media Provider")
    model = model_factory(provider["id"], model_id="img-model", name="Image Model")
    conversation = _conversation(db, uuid.UUID(admin["id"]), "Media conversation")
    at = _at()

    image_message = _assistant(
        db,
        user_id=uuid.UUID(admin["id"]),
        conversation_id=conversation.id,
        provider_id=uuid.UUID(provider["id"]),
        model_id=uuid.UUID(model["id"]),
        created_at=at,
        metadata={"generation_type": "image", "status": "completed"},
    )
    db.add(
        Attachment(
            user_id=uuid.UUID(admin["id"]),
            conversation_id=conversation.id,
            message_id=image_message.id,
            filename="generated.png",
            mime_type="image/png",
            kind="image",
            file_size=123456,
            storage_path="agg/conv/generated.png",
            created_at=at,
        )
    )
    db.commit()
    _promote(db, admin["id"])

    r = client.get("/api/admin/media", params=WINDOW)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["images"] >= 1
    assert data["media_bytes"] == 123456


def test_errors_counts_failures_and_reports_error_rate(
    client: TestClient, db: Session, user_factory, provider_factory, model_factory
) -> None:
    admin = user_factory("agg-admin-errors@tollma.ai")
    provider = provider_factory("Errors Provider")
    model = model_factory(provider["id"], model_id="err-model", name="Error Model")
    conversation = _conversation(db, uuid.UUID(admin["id"]), "Errors conversation")
    user_id = uuid.UUID(admin["id"])
    provider_id = uuid.UUID(provider["id"])
    model_id = uuid.UUID(model["id"])
    at = _at()

    _assistant(
        db,
        user_id=user_id,
        conversation_id=conversation.id,
        provider_id=provider_id,
        model_id=model_id,
        created_at=at,
        prompt=100,
        completion=50,
        input_cost="0.10",
        output_cost="0.10",
    )
    _assistant(
        db,
        user_id=user_id,
        conversation_id=conversation.id,
        provider_id=provider_id,
        model_id=model_id,
        created_at=at,
        status=MessageStatus.FAILED,
        error_code=FAILED_CODE,
    )
    for status, code in ((RequestStatus.SUCCESS, None), (RequestStatus.FAILED, FAILED_CODE)):
        db.add(
            RequestLog(
                user_id=user_id,
                conversation_id=conversation.id,
                provider_id=provider_id,
                model_id=model_id,
                request_started_at=at,
                request_completed_at=at,
                latency_ms=100.0,
                status=status.value,
                error_code=code,
                created_at=at,
            )
        )
    db.commit()
    _promote(db, admin["id"])

    r = client.get("/api/admin/errors", params=WINDOW)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["failed_requests"] >= 1
    assert data["error_rate"] > 0
    codes = {row["error_code"] for row in data["by_code"]}
    assert FAILED_CODE in codes
