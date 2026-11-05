"""Trigger notifications: in-app Notification row + email via route_email.

Dedupe key is per-policy per repeat-interval bucket in Valkey (default one
notification per hour); email is additionally rate-limited to at most 1 per
5 minutes per policy, never exceeding the repeat interval. Bodies carry
policy name, action, category and time only — never raw prompts, secrets,
or full outputs. A notified failure episode sets a 24h failing flag so the
next clean evaluation can send a one-shot recovery notice.
"""

import logging
import time
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

REPEAT_DEFAULT_MINUTES = 60
FAILING_TTL_SECONDS = 24 * 3600
EMAIL_RATE_CAP_SECONDS = 300


def _repeat_minutes(policy) -> int:
    raw = getattr(policy, "notify_repeat_minutes", REPEAT_DEFAULT_MINUTES)
    if isinstance(raw, bool):
        return REPEAT_DEFAULT_MINUTES
    try:
        value = REPEAT_DEFAULT_MINUTES if raw is None else int(raw)
    except (TypeError, ValueError):
        return REPEAT_DEFAULT_MINUTES
    if not 1 <= value <= 1440:
        return REPEAT_DEFAULT_MINUTES
    return value


def _repeat_seconds(policy) -> int:
    return _repeat_minutes(policy) * 60


def _notify_bucket(policy, now: datetime | None = None) -> str:
    minutes = _repeat_minutes(policy)
    if minutes == REPEAT_DEFAULT_MINUTES:
        return (now or datetime.now(timezone.utc)).strftime("%Y%m%d%H")
    ts = time.time() if now is None else now.timestamp()
    return str(int(ts) // (minutes * 60))


def notify_trigger(db: Session, policy, action: str, result: dict[str, Any]) -> bool:
    """Fan out one trigger notification. Never raises (callers guard too)."""
    try:
        dedupe_key = f"guardrail:notify:{policy.id}:{_notify_bucket(policy)}"
        from tollms.services.cache.manager import cache_get_sync, cache_set_sync

        if cache_get_sync(dedupe_key):
            return False
        cache_set_sync(dedupe_key, "1", ttl=_repeat_seconds(policy))
        recipients = _recipients(db, policy)
        if not recipients:
            return False
        emailed = _maybe_email(db, policy, action, result, recipients)
        _write_rows(db, policy, action, result, recipients, emailed)
        if result.get("failure_kind"):
            try:
                cache_set_sync(f"guardrail:failing:{policy.id}", "1",
                               ttl=FAILING_TTL_SECONDS)
            except Exception:
                logger.warning("guardrail failing flag stamp failed", exc_info=True)
        return True
    except Exception:
        logger.warning("guardrail notify failed", exc_info=True)
        return False


def maybe_notify_recovery(db: Session, policy) -> bool:
    """Send a one-shot recovery notice after a failure episode. Never raises."""
    try:
        from tollms.services.cache.manager import cache_delete_sync, cache_get_sync

        failing_key = f"guardrail:failing:{policy.id}"
        try:
            if not cache_get_sync(failing_key):
                return False
        except Exception:
            logger.warning("guardrail failing flag check failed", exc_info=True)
            return False
        recipients = _recipients(db, policy)
        if recipients:
            _send_recovery(db, policy, recipients)
        try:
            cache_delete_sync(failing_key)
        except Exception:
            logger.warning("guardrail failing flag clear failed", exc_info=True)
        return bool(recipients)
    except Exception:
        logger.warning("guardrail recovery notify failed", exc_info=True)
        return False


def _send_recovery(db: Session, policy, recipients: list[Any]) -> None:
    from tollms.services.email.service import route_email
    from tollms.models.organization import Notification

    subject = f"Guardrail recovered: {policy.name}"
    body = (
        f"Policy '{policy.name}' recovered - evaluation succeeded "
        "after a failure episode.\n"
        f"At: {datetime.now(timezone.utc).isoformat()}\n"
        "Details are in Guardrails > Events."
    )
    try:
        for user in recipients:
            email = getattr(user, "email", None)
            if not email:
                continue
            try:
                route_email("guardrail", email, subject, f"<p>{body}</p>", body)
            except Exception:
                logger.warning("guardrail recovery email send failed", exc_info=True)
    except Exception:
        logger.warning("guardrail recovery email failed", exc_info=True)
    try:
        for user in recipients:
            db.add(Notification(
                user_id=user.id,
                org_id=policy.org_id,
                kind="guardrail.recovered",
                title=subject,
                body="Recovered after a failure episode. See Guardrails > Events.",
                ref={"policy_id": str(policy.id)},
            ))
        db.commit()
    except Exception:
        db.rollback()
        logger.warning("guardrail recovery notification rows failed", exc_info=True)


def _recipients(db: Session, policy) -> list[Any]:
    from tollms.models.organization import Membership, MembershipState
    from tollms.models.user import User

    try:
        if policy.user_id is not None:
            user = db.get(User, policy.user_id)
            return [user] if user is not None else []
        if policy.org_id is None:
            return []
        roots = (
            db.query(User)
            .join(Membership, Membership.user_id == User.id)
            .filter(
                Membership.org_id == policy.org_id,
                Membership.is_deleted.is_(False),
                Membership.state == MembershipState.ACTIVE.value,
                Membership.is_root.is_(True),
            )
            .limit(10)
            .all()
        )
        return roots
    except Exception:
        logger.warning("guardrail recipients lookup failed", exc_info=True)
        return []


def _maybe_email(db: Session, policy, action: str, result: dict[str, Any],
                 recipients: list[Any]) -> bool:
    from tollms.services.cache.manager import cache_get_sync, cache_set_sync
    from tollms.services.email.service import route_email

    rate_key = f"guardrail:email:{policy.id}"
    try:
        if cache_get_sync(rate_key):
            return False
    except Exception:
        logger.warning("guardrail email rate check failed", exc_info=True)
    cats = ", ".join((result.get("categories") or [])[:3]) or "-"
    subject = f"[ToLLma] Guardrail {action}: {policy.name}"
    body = (
        f"Policy '{policy.name}' triggered ({action}).\n"
        f"Categories: {cats}\n"
        f"Stage: {result.get('stage') or '-'}\n"
        f"At: {datetime.now(timezone.utc).isoformat()}\n"
        "Details are in Guardrails > Events. Trigger excerpts are redacted."
    )
    sent = False
    for user in recipients:
        email = getattr(user, "email", None)
        if not email:
            continue
        try:
            if route_email("guardrail", email, subject, f"<p>{body}</p>", body):
                sent = True
        except Exception:
            logger.warning("guardrail email send failed", exc_info=True)
    if sent:
        try:
            cache_set_sync(rate_key, "1",
                           ttl=min(EMAIL_RATE_CAP_SECONDS, _repeat_seconds(policy)))
        except Exception:
            logger.warning("guardrail email rate stamp failed", exc_info=True)
    return sent


def _write_rows(db: Session, policy, action: str, result: dict[str, Any],
                recipients: list[Any], emailed: bool) -> None:
    from tollms.models.organization import Notification

    cats = ", ".join((result.get("categories") or [])[:3]) or "-"
    try:
        for user in recipients:
            db.add(Notification(
                user_id=user.id,
                org_id=policy.org_id,
                kind="guardrail.triggered",
                title=f"Guardrail {action}: {policy.name}",
                body=f"Categories: {cats}. See Guardrails > Events.",
                ref={"policy_id": str(policy.id), "action": action},
            ))
        db.commit()
    except Exception:
        db.rollback()
        logger.warning("guardrail notification rows failed", exc_info=True)
