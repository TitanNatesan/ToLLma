"""Email router safety: pytest suppression, local sandbox, production delivery.

All sends are captured via the in-memory outbox (never live email).
"""

import logging
import smtplib

import pytest

from tollms.core.config import get_settings
from tollms.services.email import service as email_service


@pytest.fixture(autouse=True)
def _clean_outbox():
    email_service.outbox.clear()
    yield
    email_service.outbox.clear()


def test_pytest_mode_suppresses_smtp_and_keeps_original_recipient(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """Even with SMTP rigged to explode, pytest mode returns True with zero
    connection: suppression is logged and the outbox keeps the original `to`."""
    calls: list = []

    class _Boom:
        def __init__(self, *args, **kwargs) -> None:
            calls.append((args, kwargs))

        def __enter__(self):
            raise AssertionError("SMTP must not be touched under pytest")

        def __exit__(self, *args) -> bool:
            return False

    monkeypatch.setattr(smtplib, "SMTP", _Boom)
    monkeypatch.setattr(get_settings(), "smtp_host", "smtp.example.com")

    with caplog.at_level(logging.INFO, logger=email_service.__name__):
        ok = email_service.route_email(
            "verification", "victim@example.com", "Subject", "<p>hi</p>"
        )

    assert ok is True
    assert calls == []
    assert len(email_service.outbox) == 1
    assert email_service.outbox[0]["to"] == "victim@example.com"
    assert email_service.outbox[0]["kind"] == "verification"
    assert "Email suppressed because pytest is active" in caplog.text
    assert "victim@example.com" not in caplog.text  # masked, never raw
    assert "v***@example.com" in caplog.text


def test_local_mode_sandboxes_recipient(monkeypatch: pytest.MonkeyPatch) -> None:
    """Local env reroutes to the parsed smtp_from address (original replaced)."""
    monkeypatch.delenv("PYTEST_CURRENT_TEST", raising=False)
    settings = get_settings()
    monkeypatch.setattr(settings, "environment", "local")
    monkeypatch.setattr(settings, "smtp_host", "")
    monkeypatch.setattr(settings, "smtp_from", "ToLLma <no-reply@tollma.ai>")

    ok = email_service.route_email(
        "password-reset", "user@example.com", "Subject", "<p>hi</p>"
    )

    assert ok is True
    assert len(email_service.outbox) == 1
    assert email_service.outbox[0]["to"] == "no-reply@tollma.ai"
    assert email_service.outbox[0]["to"] != "user@example.com"


def test_local_mode_falls_back_without_parseable_smtp_from(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Empty smtp_from still sandboxes — to the constant fallback."""
    monkeypatch.delenv("PYTEST_CURRENT_TEST", raising=False)
    settings = get_settings()
    monkeypatch.setattr(settings, "environment", "local")
    monkeypatch.setattr(settings, "smtp_host", "")
    monkeypatch.setattr(settings, "smtp_from", "")

    assert email_service.route_email("generic", "user@example.com", "S", "<p>h</p>") is True
    assert email_service.outbox[0]["to"] == "no-reply@tollma.ai"


def test_nonlocal_mode_preserves_recipient(monkeypatch: pytest.MonkeyPatch) -> None:
    """Production (SMTP unset) keeps the real recipient via outbox capture."""
    monkeypatch.delenv("PYTEST_CURRENT_TEST", raising=False)
    settings = get_settings()
    monkeypatch.setattr(settings, "environment", "production")
    monkeypatch.setattr(settings, "smtp_host", "")

    ok = email_service.route_email(
        "account-purged", "real@example.com", "Subject", "<p>bye</p>"
    )

    assert ok is True
    assert email_service.outbox[0]["to"] == "real@example.com"
    assert email_service.outbox[0]["kind"] == "account-purged"


def test_every_sender_wrapper_routes_centrally() -> None:
    """All wrappers delegate to route_email: subjects + kinds via the outbox."""
    assert email_service.send_verification_email("a@tollma.ai", "http://x/verify?t=1")
    assert email_service.send_password_reset_email("b@tollma.ai", "http://x/reset?t=2")
    assert email_service.send_email_change_notice("c@tollma.ai", "new@tollma.ai", "2026-01-01")
    assert email_service.send_account_deletion_requested("d@tollma.ai", "2026-02-01")
    assert email_service.send_account_deletion_reminder("e@tollma.ai", 7, "2026-02-01")
    assert email_service.send_account_deletion_reminder("f@tollma.ai", 1, "2026-02-01")
    assert email_service.send_account_restored("g@tollma.ai")
    assert email_service.send_account_purged("h@tollma.ai")

    by_kind = {m["kind"]: m for m in email_service.outbox}
    assert by_kind["verification"]["subject"] == "Verify your ToLLma email"
    assert by_kind["verification"]["to"] == "a@tollma.ai"
    assert by_kind["password-reset"]["subject"] == "Reset your ToLLma password"
    assert by_kind["email-change-notice"]["subject"] == "Your ToLLma email change was requested"
    assert by_kind["account-deletion-requested"]["subject"] == (
        "Your ToLLma account deletion was requested"
    )
    assert [m["subject"] for m in email_service.outbox if m["kind"] == "account-deletion-reminder"] == [
        "Your ToLLma account will be deleted in 7 days",
        "Your ToLLma account will be deleted in 1 days",
    ]
    assert by_kind["account-restored"]["subject"] == "Your ToLLma account was restored"
    assert by_kind["account-purged"]["subject"] == "Your ToLLma account has been deleted"
    assert len(email_service.outbox) == 8
