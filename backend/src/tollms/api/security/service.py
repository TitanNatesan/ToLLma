"""Security feature service: audit-log writes/reads, session revoke-all, KEK status.

`record_event` is the append-only writer other packages call later; it scrubs
secret-marked metadata keys (same marker list as the `emit()` backstop) and
never raises. Reads are platform-admin only (enforced at the router).
"""

import hashlib
import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from tollms.core.config import get_settings
from tollms.models.security_audit import (
    SecurityActorType,
    SecurityAuditEvent,
    SecurityEventType,
    SecurityOutcome,
    SecuritySeverity,
)
from tollms.services.observability.events import emit

logger = logging.getLogger(__name__)

# Mirror of the emit() secret backstop: metadata carries ids/codes/counters
# only — any key containing one of these markers is redacted before persist.
_SECRET_MARKERS = (
    "password", "passwd", "token", "secret", "credential", "api_key",
    "apikey", "key_hash", "private_key", "access_key", "refresh", "auth",
    "cookie", "session_id", "prompt", "content", "payload", "message",
    "text", "body", "email", "ip", "user_agent", "avatar", "name",
)

_MAX_META_LEN = 256


def scrub_metadata(metadata: dict | None) -> dict:
    """Redact secret-marked keys; coerce the rest to short scalars."""
    if not metadata:
        return {}
    clean: dict = {}
    for key, value in metadata.items():
        if not isinstance(key, str):
            continue
        if any(marker in key.lower() for marker in _SECRET_MARKERS):
            clean[key] = "[redacted]"
            continue
        if value is None or isinstance(value, (bool, int, float)):
            clean[key] = value
        else:
            clean[key] = str(value)[:_MAX_META_LEN]
    return clean


def hash_field(value: str | None) -> str | None:
    """One-way hash for ip/user-agent (sha256 + SECRET_KEY salt, never raw)."""
    if not value:
        return None
    try:
        salt = get_settings().secret_key
    except Exception:
        logger.warning("security audit: settings unavailable, hashing unsalted")
        salt = ""
    return hashlib.sha256(f"{salt}|{value}".encode()).hexdigest()


def record_event(
    db: Session,
    *,
    event_type: str | SecurityEventType,
    actor_type: str | SecurityActorType = SecurityActorType.SYSTEM,
    severity: str | SecuritySeverity = SecuritySeverity.INFO,
    outcome: str | SecurityOutcome = SecurityOutcome.ALLOWED,
    actor_user_id: uuid.UUID | None = None,
    actor_key_id: uuid.UUID | None = None,
    actor_org_id: uuid.UUID | None = None,
    session_id: str | None = None,
    ip_hash: str | None = None,
    user_agent_hash: str | None = None,
    target_type: str | None = None,
    target_id: uuid.UUID | None = None,
    reason: str | None = None,
    request_id: str | None = None,
    metadata: dict | None = None,
    occurred_at: datetime | None = None,
) -> SecurityAuditEvent | None:
    """Append one audit row. Fail-open (log + rollback, never raise)."""
    try:
        row = SecurityAuditEvent(
            event_type=event_type.value if isinstance(event_type, SecurityEventType) else str(event_type),
            actor_type=actor_type.value if isinstance(actor_type, SecurityActorType) else str(actor_type),
            severity=severity.value if isinstance(severity, SecuritySeverity) else str(severity),
            outcome=outcome.value if isinstance(outcome, SecurityOutcome) else str(outcome),
            actor_user_id=actor_user_id,
            actor_key_id=actor_key_id,
            actor_org_id=actor_org_id,
            session_id=(session_id[:8] if session_id else None),
            ip_hash=ip_hash,
            user_agent_hash=user_agent_hash,
            target_type=target_type,
            target_id=target_id,
            reason=reason,
            request_id=request_id,
            metadata_=scrub_metadata(metadata),
            occurred_at=occurred_at or datetime.now(timezone.utc),
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        emit(
            str(row.event_type),
            outcome=str(row.outcome),
            reason=str(reason or ""),
            request_id=str(request_id or ""),
        )
        return row
    except Exception:
        logger.exception("security audit: record_event failed")
        try:
            db.rollback()
        except Exception:
            logger.warning("security audit: rollback failed", exc_info=True)
        return None


def _read(row: SecurityAuditEvent) -> dict:
    return {
        "event_id": row.event_id,
        "occurred_at": row.occurred_at,
        "actor_type": row.actor_type,
        "actor_user_id": row.actor_user_id,
        "actor_key_id": row.actor_key_id,
        "actor_org_id": row.actor_org_id,
        "session_id": row.session_id,
        "event_type": row.event_type,
        "severity": row.severity,
        "outcome": row.outcome,
        "ip_hash": row.ip_hash,
        "user_agent_hash": row.user_agent_hash,
        "target_type": row.target_type,
        "target_id": row.target_id,
        "reason": row.reason,
        "request_id": row.request_id,
        "metadata": dict(row.metadata_ or {}),
        "created_at": row.created_at,
    }


def list_events(
    db: Session,
    *,
    event_type: str | None = None,
    severity: str | None = None,
    actor_user_id: uuid.UUID | None = None,
    outcome: str | None = None,
    limit: int = 100,
    cursor: str | None = None,
) -> list[dict]:
    """Newest-first reads, (occurred_at desc, event_id desc) paging.

    `cursor` is an offset int or an anchor event UUID (rows strictly older
    than the anchor; unknown/foreign ids are 422). Mirrors orgs/audit style.
    """
    from tollms.core.exceptions import ValidationError

    lim = max(1, min(int(limit or 100), 500))
    stmt = (
        select(SecurityAuditEvent)
        .where(SecurityAuditEvent.is_deleted.is_(False))
        .order_by(SecurityAuditEvent.occurred_at.desc(), SecurityAuditEvent.event_id.desc())
        .limit(lim)
    )
    if event_type:
        stmt = stmt.where(SecurityAuditEvent.event_type == event_type)
    if severity:
        stmt = stmt.where(SecurityAuditEvent.severity == severity)
    if actor_user_id is not None:
        stmt = stmt.where(SecurityAuditEvent.actor_user_id == actor_user_id)
    if outcome:
        stmt = stmt.where(SecurityAuditEvent.outcome == outcome)
    off = 0
    if cursor:
        text = cursor.strip()
        try:
            off = max(0, min(int(text), 5000))
        except (TypeError, ValueError):
            try:
                anchor_id = uuid.UUID(text)
            except (ValueError, TypeError, AttributeError):
                raise ValidationError(f"unknown cursor: {cursor!r}") from None
            anchor = db.get(SecurityAuditEvent, anchor_id)
            if anchor is None:
                raise ValidationError(f"unknown cursor: {cursor!r}") from None
            stmt = stmt.where(
                or_(
                    SecurityAuditEvent.occurred_at < anchor.occurred_at,
                    and_(
                        SecurityAuditEvent.occurred_at == anchor.occurred_at,
                        SecurityAuditEvent.event_id < anchor.event_id,
                    ),
                )
            )
    if off:
        stmt = stmt.offset(off)
    try:
        rows = list(db.execute(stmt).scalars().all())
    except Exception:
        logger.exception("security audit: list_events failed")
        return []
    return [_read(row) for row in rows]


async def revoke_all_sessions(user_id: uuid.UUID) -> int:
    """Destroy every live session for one user. Thin reuse, no new logic."""
    from tollms.core.sessions import revoke_all_user_sessions

    try:
        return int(await revoke_all_user_sessions(user_id))
    except Exception:
        logger.exception("security audit: revoke_all_sessions failed")
        return 0


def kek_status() -> dict:
    """Current KEK version info. Algorithm + versions only — never secrets."""
    from tollms.core.crypto import ALGORITHM

    return {
        "algorithm": ALGORITHM,
        "kek_version": 1,
        "rotation_supported": False,
        "previous_version_expires_at": None,
    }
