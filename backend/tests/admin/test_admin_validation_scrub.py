"""Provider validation-message scrubbing (admin hardening).

`validate_provider` persists adapter messages onto
`Provider.validation_message`, which the admin providers endpoint surfaces.
Probe errors can echo secrets (rejected keys, bearer tokens, URLs carrying
userinfo), so messages are scrubbed at write time. Status semantics are
untouched — only the message text is rewritten, and the admin row inherits
the already-safe stored value.
"""

import asyncio
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tollms.api.providers import service as provider_service
from tollms.models.conversation import Conversation
from tollms.models.message import Message, MessageStatus, Role
from tollms.models.provider import Provider
from tollms.models.user import PlatformRole, User
from tollms.services.admin import providers as admin_providers

SECRET_SAMPLES = (
    "401 invalid api key sk-abcDEF1234567890 provided",
    "auth failed: Bearer abcDEF123.xyz_456-789",
    "request rejected (api_key=supersecret123) retry later",
    "missing api-key=hunter2-secret-value in headers",
    "could not connect to https://deploy:s3cret-value@proxy.internal:8080/v1",
)


def _window():
    from tollms.api.analytics.service import RangeQuery, resolve_range
    from tollms.services.admin import AdminWindow

    resolved = resolve_range(RangeQuery(preset="last_7d", timezone="UTC"))
    return AdminWindow(
        start=resolved.start,
        end=resolved.end,
        prev_start=resolved.prev_start,
        prev_end=resolved.prev_end,
        preset=resolved.preset,
        timezone=resolved.timezone,
        granularity="day",
    )


def _assert_scrubbed(original: str, scrubbed: str | None) -> None:
    assert isinstance(scrubbed, str), f"expected a string, got {type(scrubbed).__name__}"
    assert "[redacted]" in scrubbed, f"nothing redacted: {scrubbed!r}"
    for token in ("sk-abcDEF1234567890", "abcDEF123.xyz_456-789", "supersecret123",
                  "hunter2-secret-value", "s3cret-value"):
        if token in original:
            assert token not in scrubbed, f"secret leaked: {token!r} in {scrubbed!r}"
    assert len(scrubbed) <= provider_service.VALIDATION_MESSAGE_MAX_LENGTH


def test_sanitize_validation_message_redacts_secrets() -> None:
    for sample in SECRET_SAMPLES:
        _assert_scrubbed(sample, provider_service.sanitize_validation_message(sample))


def test_sanitize_validation_message_truncates_and_passes_through() -> None:
    long_message = "x" * (provider_service.VALIDATION_MESSAGE_MAX_LENGTH + 100)
    scrubbed = provider_service.sanitize_validation_message(long_message)
    assert scrubbed is not None and len(scrubbed) <= provider_service.VALIDATION_MESSAGE_MAX_LENGTH

    assert provider_service.sanitize_validation_message(None) is None
    assert provider_service.sanitize_validation_message("") == ""
    # Benign messages are byte-identical: no over-scrubbing.
    benign = "credentials valid, 3 models discovered in 120ms"
    assert provider_service.sanitize_validation_message(benign) == benign


class _LeakingAdapter:
    """Stub adapter whose probe error echoes secret material."""

    def __init__(self, message: str) -> None:
        self._message = message

    async def validate_credentials(self) -> tuple[bool, str, float]:
        return False, self._message, 12.5


def _promote(db: Session, user_id: str) -> None:
    user = db.get(User, uuid.UUID(user_id))
    assert user is not None
    user.platform_role = PlatformRole.PLATFORM_ADMIN
    db.commit()


def test_validate_provider_persists_scrubbed_message(
    db: Session, provider_factory, monkeypatch: pytest.MonkeyPatch
) -> None:
    provider = provider_factory("Scrub Provider", creds={"base_url": "http://mock"})
    leaked = (
        "401 invalid api key sk-leakedSECRET1234567890 "
        "(api_key=sk-leakedSECRET1234567890) Bearer leakedbearerTOKEN.123 "
        "via https://bot:leaked-pw-123@proxy.internal/v1"
    )
    monkeypatch.setattr(
        provider_service, "build_adapter", lambda *args, **kwargs: _LeakingAdapter(leaked)
    )

    valid, message, _ = asyncio.run(
        provider_service.validate_provider(db, uuid.UUID(provider["id"]), object())
    )

    # Status semantics preserved; every surface carries the scrubbed text.
    assert valid is False
    assert "[redacted]" in message
    for token in ("sk-leakedSECRET1234567890", "leakedbearerTOKEN.123", "leaked-pw-123"):
        assert token not in message, f"secret leaked in return: {token!r}"
    assert len(message) <= provider_service.VALIDATION_MESSAGE_MAX_LENGTH

    stored = db.get(Provider, uuid.UUID(provider["id"]))
    assert stored is not None
    assert stored.validation_status == "invalid"
    assert stored.validation_message == message
    for token in ("sk-leakedSECRET1234567890", "leakedbearerTOKEN.123", "leaked-pw-123"):
        assert token not in (stored.validation_message or "")


def test_admin_row_inherits_scrubbed_message(
    client: TestClient, db: Session, user_factory, provider_factory, model_factory
) -> None:
    user = user_factory("scrub-admin@tollma.ai")
    provider = provider_factory("Scrub Row Provider", creds={"base_url": "http://mock"})
    model = model_factory(provider["id"], model_id="scrub-model", name="Scrub Model")

    stored_leak = (
        "provider reports invalid api_key=sk-rowSECRET1234567890 "
        "for https://bot:row-pw-123@proxy.internal/v1"
    )
    row_provider = db.get(Provider, uuid.UUID(provider["id"]))
    assert row_provider is not None
    row_provider.validation_status = "invalid"
    row_provider.validation_message = provider_service.sanitize_validation_message(stored_leak)
    row_provider.last_validated_at = datetime.now(timezone.utc)

    conversation = Conversation(user_id=uuid.UUID(user["id"]), title="scrub row convo")
    db.add(conversation)
    db.commit()
    db.refresh(conversation)
    now = datetime.now(timezone.utc) - timedelta(hours=1)
    db.add(
        Message(
            user_id=uuid.UUID(user["id"]),
            conversation_id=conversation.id,
            role=Role.ASSISTANT,
            content="row seed",
            provider_id=uuid.UUID(provider["id"]),
            model_id=uuid.UUID(model["id"]),
            status=MessageStatus.COMPLETED,
            created_at=now,
            completed_at=now,
            prompt_tokens=5,
            completion_tokens=5,
            total_tokens=10,
            input_cost=Decimal("0.01"),
            output_cost=Decimal("0.01"),
            total_cost=Decimal("0.02"),
        )
    )
    db.commit()
    _promote(db, user["id"])

    # Service level: the row carries the scrubbed stored value verbatim.
    window_rows = [
        r for r in admin_providers.providers(db, _window(), limit=10)["rows"]
        if str(r["provider_id"]) == provider["id"]
    ]
    assert len(window_rows) == 1
    assert window_rows[0]["validation_message"] == row_provider.validation_message

    # HTTP level: the same safe text crosses the admin boundary.
    r = client.get("/api/admin/providers", params={"preset": "last_7d", "timezone": "UTC"})
    assert r.status_code == 200, r.text
    http_rows = [row for row in r.json()["rows"] if row["provider_id"] == provider["id"]]
    assert len(http_rows) == 1
    assert http_rows[0]["validation_status"] == "invalid"
    assert http_rows[0]["validation_message"] == row_provider.validation_message
    for token in ("sk-rowSECRET1234567890", "row-pw-123"):
        assert token not in (http_rows[0]["validation_message"] or "")
