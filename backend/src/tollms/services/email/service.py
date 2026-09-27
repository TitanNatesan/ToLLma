"""Email engine: verification emails today; resets/invites reuse send_email.

Without SMTP configuration the message is logged and appended to `outbox`
(dev visibility + test capture) — never silently dropped.
"""

import logging
import os
import smtplib
from email.message import EmailMessage
from pathlib import Path
from typing import Any

from tollms.core.config import get_settings

logger = logging.getLogger(__name__)

# Captured sends when SMTP is unconfigured (dev + tests).
outbox: list[dict[str, Any]] = []

_TEMPLATES = Path(__file__).parent / "templates"


def _render(template: str, **kwargs: str) -> str:
    return (_TEMPLATES / template).read_text(encoding="utf-8").format(**kwargs)


def send_email(to: str, subject: str, html_body: str, text_body: str = "") -> bool:
    """Send via SMTP when configured, else log + capture. Never raises."""
    settings = get_settings()
    # Tests never send live email: quota burn + SMTP latency make suites slow
    # and flaky (Gmail daily limits). Outbox capture preserves assertions.
    if not settings.smtp_host or os.getenv("PYTEST_CURRENT_TEST"):
        logger.info("email (dev outbox) to=%s subject=%s", to, subject)
        outbox.append({"to": to, "subject": subject, "html": html_body, "text": text_body or html_body})
        return True
    try:
        message = EmailMessage()
        message["From"] = settings.smtp_from
        message["To"] = to
        message["Subject"] = subject
        message.set_content(text_body or "View this email in an HTML-capable client.")
        message.add_alternative(html_body, subtype="html")
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10) as smtp:
            if settings.smtp_use_tls:
                smtp.starttls()
            if settings.smtp_username:
                smtp.login(settings.smtp_username, settings.smtp_password)
            smtp.send_message(message)
    except Exception:
        logger.exception("email send failed to=%s", to)
        return False
    logger.info("email sent to=%s subject=%s", to, subject)
    return True


def send_verification_email(to: str, verification_url: str) -> bool:
    html_body = _render("verify.html", verification_url=verification_url, to=to)
    return send_email(to, "Verify your ToLLma email", html_body)


def send_password_reset_email(to: str, reset_url: str, expires_in: str = "1 hour") -> bool:
    """Reset email. Only ever called for local-auth accounts with a password."""
    html_body = _render("reset.html", reset_url=reset_url, to=to, expires_in=expires_in)
    text_body = (
        "You requested a password reset. Open this link to continue:\n"
        f"{reset_url}\n"
        f"This link expires in {expires_in}. If you did not request this reset, ignore this email."
    )
    return send_email(to, "Reset your ToLLma password", html_body, text_body)


def send_email_change_notice(to: str, new_email: str, requested_at: str) -> bool:
    """Notice to the OLD address that an email change was requested.

    Fact-only: timestamp + the staged address + support pointer. Never
    carries tokens or links — verification goes to the new address only.
    """
    html_body = _render(
        "email-change-notice.html", to=to, new_email=new_email, requested_at=requested_at
    )
    text_body = (
        f"An email change was requested on your ToLLma account at {requested_at} (UTC).\n"
        f"The new address on file for verification is {new_email}. Your current sign-in "
        "address is unchanged until that address is verified.\n"
        "If this was not you, change your password immediately and contact support."
    )
    return send_email(to, "Your ToLLma email change was requested", html_body, text_body)


def send_account_deletion_requested(to: str, scheduled_for: str) -> bool:
    """Account deletion scheduled. Informational only — no links or tokens."""
    html_body = _render(
        "account-deletion-requested.html", to=to, scheduled_for=scheduled_for
    )
    text_body = (
        "You requested deletion of your ToLLma account.\n"
        f"It is scheduled for permanent deletion on {scheduled_for} (UTC) — 15 days from now.\n"
        "Your API keys are already disabled and you have been signed out everywhere else.\n"
        "If this was not you, sign in and cancel the request from settings, or contact support."
    )
    return send_email(to, "Your ToLLma account deletion was requested", html_body, text_body)


def send_account_deletion_reminder(to: str, days_remaining: int, scheduled_for: str) -> bool:
    """Grace-period reminder (7-day / 1-day). Informational — no links or tokens."""
    html_body = _render(
        "account-deletion-reminder.html",
        to=to,
        days_remaining=str(days_remaining),
        scheduled_for=scheduled_for,
    )
    text_body = (
        f"Reminder: your ToLLma account will be permanently deleted in {days_remaining} days "
        f"({scheduled_for} UTC).\n"
        "Sign in and cancel the request from settings if you want to keep your account."
    )
    return send_email(
        to, f"Your ToLLma account will be deleted in {days_remaining} days", html_body, text_body
    )


def send_account_restored(to: str) -> bool:
    """Deletion request cancelled. Informational — no links or tokens."""
    html_body = _render("account-restored.html", to=to)
    text_body = (
        "Your ToLLma account deletion request has been cancelled. Your account "
        "is fully restored.\n"
        "Note: API keys disabled when deletion was requested stay disabled — "
        "create new ones from settings if needed.\n"
        "If this was not you, change your password immediately and contact support."
    )
    return send_email(to, "Your ToLLma account was restored", html_body, text_body)


def send_account_purged(to: str) -> bool:
    """Final receipt after the hard purge. Informational — no links or tokens."""
    html_body = _render("account-purged.html", to=to)
    text_body = (
        "Your ToLLma account and all associated data have been permanently deleted, "
        "as requested.\n"
        "This is the last email you will receive about this account."
    )
    return send_email(to, "Your ToLLma account has been deleted", html_body, text_body)
