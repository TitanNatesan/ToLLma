"""Transactional email engine (verification + password reset)."""

from tollms.services.email.service import (
    outbox,
    send_account_deletion_reminder,
    send_account_deletion_requested,
    send_account_purged,
    send_account_restored,
    send_email,
    send_email_change_notice,
    send_password_reset_email,
    send_verification_email,
)

__all__ = [
    "outbox",
    "send_account_deletion_reminder",
    "send_account_deletion_requested",
    "send_account_purged",
    "send_account_restored",
    "send_email",
    "send_email_change_notice",
    "send_password_reset_email",
    "send_verification_email",
]
