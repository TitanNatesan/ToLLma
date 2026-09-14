"""Email engine: verification emails today; resets/invites reuse send_email.

Without SMTP configuration the message is logged and appended to `outbox`
(dev visibility + test capture) — never silently dropped.
"""

import logging
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
    if not settings.smtp_host:
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
