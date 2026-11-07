"""Privacy feature service: consents, retention, DSR, export, erasure.

CRUD + orchestration only. Reuses the exports engine and the settings
deletion service — never duplicates purge logic. External calls are
wrapped try/except + log per coding-standards.
"""

import logging
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from tollms.api.privacy import schemas
from tollms.core.exceptions import NotFoundError, ValidationError
from tollms.models.privacy import (
    DSR_SLA_DAYS,
    DSR_TERMINAL,
    DSR_TRANSITIONS,
    RETENTION_CATEGORIES,
    ConsentCategory,
    ConsentRecord,
    ConsentStatus,
    DSREvent,
    DSRRequest,
    DSRStatus,
    DSRType,
    RetentionPolicy,
)
from tollms.models.user import User

logger = logging.getLogger(__name__)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _emit(event: str, **fields: object) -> None:
    try:
        from tollms.services.observability.events import emit

        emit(event, **fields)
    except Exception:
        logger.warning("privacy emit failed: %s", event, exc_info=True)


# --- consents ---------------------------------------------------------------

_CONSENT_NOT_FOUND = "consent not found"


def list_consents(db: Session, user_id: uuid.UUID) -> list[ConsentRecord]:
    """Live consent rows for one user (404-oracle: scoped by user_id)."""
    try:
        return list(
            db.execute(
                select(ConsentRecord)
                .where(ConsentRecord.user_id == user_id, ConsentRecord.is_deleted.is_(False))
                .order_by(ConsentRecord.category.asc())
            ).scalars()
        )
    except Exception:
        logger.warning("privacy list_consents failed", exc_info=True)
        raise


def consent_withdrawn(db: Session, user_id: uuid.UUID, category: str) -> bool:
    """True when the user has an explicit withdrawn row for category.
    Enforcement-point helper (see RETENTION.md). Never raises."""
    try:
        row = db.execute(
            select(ConsentRecord).where(
                ConsentRecord.user_id == user_id,
                ConsentRecord.category == category,
                ConsentRecord.is_deleted.is_(False),
            )
        ).scalars().first()
        return row is not None and row.status == ConsentStatus.WITHDRAWN.value
    except Exception:
        logger.warning("privacy consent_withdrawn lookup failed", exc_info=True)
        return False


def set_consent(db: Session, user_id: uuid.UUID, data: schemas.ConsentSetRequest) -> ConsentRecord:
    """Upsert one (user, category) row. Idempotent: re-granting returns the
    live row untouched. Withdrawing `functional` is a 422 (F4)."""
    if data.category == ConsentCategory.FUNCTIONAL.value and not data.granted:
        raise ValidationError("functional consent is required and cannot be withdrawn")
    try:
        row = db.execute(
            select(ConsentRecord).where(
                ConsentRecord.user_id == user_id,
                ConsentRecord.category == data.category,
                ConsentRecord.is_deleted.is_(False),
            )
        ).scalars().first()
        now = _utcnow()
        if row is None:
            row = ConsentRecord(
                user_id=user_id,
                category=data.category,
                status=(
                    ConsentStatus.GRANTED.value if data.granted else ConsentStatus.WITHDRAWN.value
                ),
                granted_at=now if data.granted else None,
                withdrawn_at=None if data.granted else now,
                source=data.source,
            )
            db.add(row)
        elif data.granted and row.status == ConsentStatus.GRANTED.value:
            return row  # idempotent re-grant: no write, no version bump
        else:
            row.status = (
                ConsentStatus.GRANTED.value if data.granted else ConsentStatus.WITHDRAWN.value
            )
            row.granted_at = now if data.granted else row.granted_at
            row.withdrawn_at = None if data.granted else now
            row.source = data.source
            row.version += 1
        db.commit()
        db.refresh(row)
    except (ValidationError, NotFoundError):
        raise
    except Exception:
        db.rollback()
        logger.warning("privacy set_consent failed", exc_info=True)
        raise
    _emit("privacy.consent_set", user_id=str(user_id), category=data.category)
    return row


# --- retention ---------------------------------------------------------------

_RETENTION_NOT_FOUND = "retention policy not found"


def _require_org_member(db: Session, org_id: uuid.UUID, user_id: uuid.UUID) -> None:
    """Org-scope writes read like other org domains: strangers get 404
    (no existence oracle). Wave 3 tightens this to a manage-permission code."""
    from tollms.api.orgs.common.guards import effective_permissions

    try:
        perms = effective_permissions(db, org_id, user_id)
    except Exception:
        logger.warning("privacy org membership check failed", exc_info=True)
        raise NotFoundError(_RETENTION_NOT_FOUND)
    if not perms:
        raise NotFoundError(_RETENTION_NOT_FOUND)


# Observability ledger categories: capture policy lives under PromptLogs.*,
# so a weaker retention gate would let any member veto workspace capture
# (F-R1). Org writes here require PromptLogs.Manage, reads PromptLogs.Read.
_OBS_RETENTION_CATEGORIES = frozenset({"prompt_logs", "request_logs", "api_request_logs"})


def _require_obs_perm(db: Session, org_id: uuid.UUID, user_id: uuid.UUID, code: str) -> None:
    """404-oracle perm gate for observability retention. Never 403."""
    from tollms.api.orgs.common.guards import effective_permissions

    try:
        perms = effective_permissions(db, org_id, user_id)
    except Exception:
        logger.warning("privacy obs perm check failed", exc_info=True)
        raise NotFoundError(_RETENTION_NOT_FOUND)
    if code not in perms:
        raise NotFoundError(_RETENTION_NOT_FOUND)


def list_retention(
    db: Session, user_id: uuid.UUID, org_id: uuid.UUID | None = None
) -> list[RetentionPolicy]:
    """Personal policies, or org-scope policies (member-gated 404).

    Observability categories additionally require PromptLogs.Read (F-R1)."""
    obs_reader = True
    if org_id is not None:
        _require_org_member(db, org_id, user_id)
        try:
            from tollms.api.orgs.common.guards import effective_permissions

            perms = effective_permissions(db, org_id, user_id)
        except Exception:
            logger.warning("privacy list_retention perm check failed", exc_info=True)
            raise NotFoundError(_RETENTION_NOT_FOUND)
        obs_reader = "PromptLogs.Read" in perms or "PromptLogs.Manage" in perms
    try:
        stmt = select(RetentionPolicy).where(RetentionPolicy.is_deleted.is_(False))
        if org_id is not None:
            stmt = stmt.where(RetentionPolicy.org_id == org_id)
        else:
            stmt = stmt.where(
                RetentionPolicy.user_id == user_id, RetentionPolicy.org_id.is_(None)
            )
        rows = list(db.execute(stmt.order_by(RetentionPolicy.data_category.asc())).scalars())
        if org_id is not None and not obs_reader:
            # Member-readable for other categories; obs rows hidden (F-R1).
            rows = [r for r in rows if r.data_category not in _OBS_RETENTION_CATEGORIES]
        return rows
    except (NotFoundError, ValidationError):
        raise
    except Exception:
        logger.warning("privacy list_retention failed", exc_info=True)
        raise


def set_retention(db: Session, user_id: uuid.UUID, data: schemas.RetentionSetRequest) -> RetentionPolicy:
    """Upsert one (scope, category) policy. Org scope requires membership;
    observability categories additionally require PromptLogs.Manage (F-R1 —
    otherwise any member could veto workspace capture via zero_retention)."""
    if data.data_category not in RETENTION_CATEGORIES:
        raise ValidationError(f"unknown data category: {data.data_category}")
    if data.org_id is not None:
        _require_org_member(db, data.org_id, user_id)
        if data.data_category in _OBS_RETENTION_CATEGORIES:
            _require_obs_perm(db, data.org_id, user_id, "PromptLogs.Manage")
    try:
        stmt = select(RetentionPolicy).where(
            RetentionPolicy.data_category == data.data_category,
            RetentionPolicy.is_deleted.is_(False),
        )
        if data.org_id is not None:
            stmt = stmt.where(RetentionPolicy.org_id == data.org_id)
        else:
            stmt = stmt.where(
                RetentionPolicy.user_id == user_id, RetentionPolicy.org_id.is_(None)
            )
        row = db.execute(stmt).scalars().first()
        if row is None:
            row = RetentionPolicy(
                user_id=None if data.org_id is not None else user_id,
                org_id=data.org_id,
                data_category=data.data_category,
                retention_days=data.retention_days,
                zero_retention=data.zero_retention,
                updated_by=user_id,
            )
            db.add(row)
        else:
            row.retention_days = data.retention_days
            row.zero_retention = data.zero_retention
            row.updated_by = user_id
            row.version += 1
        db.commit()
        db.refresh(row)
    except (NotFoundError, ValidationError):
        raise
    except Exception:
        db.rollback()
        logger.warning("privacy set_retention failed", exc_info=True)
        raise
    _emit("privacy.retention_set", user_id=str(user_id), category=data.data_category)
    return row


def resolve_retention(
    db: Session,
    user_id: uuid.UUID,
    data_category: str,
    org_id: uuid.UUID | None = None,
) -> tuple[int | None, bool]:
    """F9 precedence: org policy wins for org-scoped traffic, most-restrictive
    TTL wins on conflict, zero_retention short-circuits. Returns
    (retention_days, zero_retention). Never raises (fail-open: no policy)."""
    try:
        policies = list_retention(db, user_id)
        if org_id is not None:
            try:
                policies += list_retention(db, user_id, org_id=org_id)
            except NotFoundError:
                pass  # stranger to the org: personal scope only
        applicable = [p for p in policies if p.data_category == data_category]
        if any(p.zero_retention for p in applicable):
            return None, True
        days = [p.retention_days for p in applicable if p.retention_days is not None]
        return (min(days) if days else None), False
    except Exception:
        logger.warning("privacy resolve_retention failed", exc_info=True)
        return None, False


def is_zero_retention(
    db: Session,
    user_id: uuid.UUID,
    org_id: uuid.UUID | None = None,
    data_category: str = "prompt_logs",
) -> bool:
    """Choke-point helper for the orchestrator (Wave 3 wires it into
    services/prompt_logging/resolution.py — F9 forbids a parallel resolver).
    Fail-open False on error: preserves today's capture behavior; logs loudly.
    See docs/compliance/privacy/RETENTION.md for all 6 enforcement points."""
    try:
        _, zero = resolve_retention(db, user_id, data_category, org_id)
        return zero
    except Exception:
        logger.warning("privacy is_zero_retention failed", exc_info=True)
        return False


# --- DSR ---------------------------------------------------------------------

_DSR_NOT_FOUND = "request not found"


def _dsr_events(row: DSRRequest) -> list[schemas.DSREventRead]:
    return [
        schemas.DSREventRead(
            id=e.id,
            from_status=e.from_status,
            to_status=e.to_status,
            note=e.note,
            created_at=e.created_at,
        )
        for e in row.events
    ]


def submit_dsr(db: Session, user_id: uuid.UUID, data: schemas.DSRSubmitRequest) -> DSRRequest:
    """Open a request (status submitted, SLA clock starts) + audit event."""
    try:
        row = DSRRequest(
            user_id=user_id,
            type=data.type,
            status=DSRStatus.SUBMITTED.value,
            detail=data.detail,
            due_at=_utcnow() + timedelta(days=DSR_SLA_DAYS),
        )
        db.add(row)
        db.flush()
        db.add(
            DSREvent(dsr_id=row.id, from_status=None, to_status=row.status, actor=user_id)
        )
        db.commit()
        db.refresh(row)
    except Exception:
        db.rollback()
        logger.warning("privacy submit_dsr failed", exc_info=True)
        raise
    _emit("privacy.dsr_submitted", user_id=str(user_id), type=data.type)
    return row


def list_dsrs(db: Session, user_id: uuid.UUID) -> list[DSRRequest]:
    try:
        return list(
            db.execute(
                select(DSRRequest)
                .where(DSRRequest.user_id == user_id, DSRRequest.is_deleted.is_(False))
                .order_by(DSRRequest.created_at.desc())
            ).scalars()
        )
    except Exception:
        logger.warning("privacy list_dsrs failed", exc_info=True)
        raise


def get_dsr(db: Session, user_id: uuid.UUID, dsr_id: uuid.UUID) -> DSRRequest:
    """Owner-scoped read: strangers get 404 (no oracle)."""
    try:
        row = db.execute(
            select(DSRRequest).where(
                DSRRequest.id == dsr_id,
                DSRRequest.user_id == user_id,
                DSRRequest.is_deleted.is_(False),
            )
        ).scalars().first()
    except Exception:
        logger.warning("privacy get_dsr failed", exc_info=True)
        raise
    if row is None:
        raise NotFoundError(_DSR_NOT_FOUND)
    return row


def transition_dsr(
    db: Session, user_id: uuid.UUID, dsr_id: uuid.UUID, data: schemas.DSRTransitionRequest
) -> DSRRequest:
    """Validate the F5 edge, apply it, append the audit event. Terminal
    states are immutable; rejection requires a reason_code."""
    row = get_dsr(db, user_id, dsr_id)
    if row.status in DSR_TERMINAL:
        raise ValidationError(f"request is closed ({row.status})")
    allowed = DSR_TRANSITIONS.get(row.status, frozenset())
    if data.to_status not in allowed:
        raise ValidationError(f"illegal transition: {row.status} -> {data.to_status}")
    if data.to_status == DSRStatus.REJECTED.value and not data.reason_code:
        raise ValidationError("rejection requires a reason_code")
    try:
        previous = row.status
        row.status = data.to_status
        row.reason_code = data.reason_code or row.reason_code
        if data.to_status in DSR_TERMINAL:
            row.fulfilled_at = _utcnow()
            row.decided_by = user_id
        db.add(
            DSREvent(
                dsr_id=row.id,
                from_status=previous,
                to_status=data.to_status,
                actor=user_id,
                note=data.note,
            )
        )
        db.commit()
        db.refresh(row)
    except (NotFoundError, ValidationError):
        raise
    except Exception:
        db.rollback()
        logger.warning("privacy transition_dsr failed", exc_info=True)
        raise
    _emit("privacy.dsr_transition", user_id=str(user_id), to_status=data.to_status)
    return row


# --- export -------------------------------------------------------------------


def _sanitize(value: object) -> object:
    if isinstance(value, dict):
        return {str(k): _sanitize(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_sanitize(v) for v in value]
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, datetime):
        return value.isoformat()
    return value


def full_account_export(db: Session, user_id: uuid.UUID) -> dict:
    """Full-account JSON bundle for access/portability. Reuses the exports
    engine for conversations; metadata only for logs (ciphers never leave)."""
    user = db.get(User, user_id)
    if user is None or user.is_deleted:
        raise NotFoundError("account not found")
    bundle: dict = {
        "exported_at": _utcnow().isoformat(),
        "profile": {
            "id": str(user.id),
            "email": user.email,
            "full_name": user.full_name,
            "username": user.username,
            "email_verified": user.email_verified,
            "created_at": user.created_at.isoformat() if user.created_at else None,
        },
        "consents": [],
        "retention_policies": [],
        "dsr_requests": [],
        "conversations": [],
        "attachments": [],
        "prompt_logs": [],
        "request_logs": [],
        "guardrail_triggers": [],
        "shares": [],
    }
    try:
        for row in list_consents(db, user_id):
            bundle["consents"].append(
                {
                    "category": row.category,
                    "status": row.status,
                    "granted_at": row.granted_at,
                    "withdrawn_at": row.withdrawn_at,
                    "version": row.version,
                }
            )
        for row in list_retention(db, user_id):
            bundle["retention_policies"].append(
                {
                    "data_category": row.data_category,
                    "retention_days": row.retention_days,
                    "zero_retention": row.zero_retention,
                    "version": row.version,
                }
            )
        for row in list_dsrs(db, user_id):
            bundle["dsr_requests"].append(
                {
                    "id": row.id,
                    "type": row.type,
                    "status": row.status,
                    "due_at": row.due_at,
                    "fulfilled_at": row.fulfilled_at,
                    "created_at": row.created_at,
                }
            )
    except (NotFoundError, ValidationError):
        raise
    except Exception:
        logger.warning("privacy export identity section failed", exc_info=True)
        raise
    _export_conversations(db, user_id, bundle)
    _export_tables(db, user_id, bundle)
    return _sanitize(bundle)  # type: ignore[return-value]


def _export_conversations(db: Session, user_id: uuid.UUID, bundle: dict) -> None:
    from tollms.api.conversations.service import list_messages
    from tollms.api.exports import service as exports_service
    from tollms.core.exceptions import NotFoundError as _NotFound

    try:
        conversations, _, _ = exports_service.load_conversations(db, user_id, [], True)
    except _NotFound:
        return  # empty account: section stays []
    except Exception:
        logger.warning("privacy export conversations failed", exc_info=True)
        return
    for conv in conversations:
        try:
            messages = list_messages(db, conv.id, user_id)
        except Exception:
            logger.warning("privacy export messages failed: conv=%s", conv.id, exc_info=True)
            messages = []
        bundle["conversations"].append(
            {
                "id": conv.id,
                "title": conv.title,
                "is_pinned": conv.is_pinned,
                "created_at": conv.created_at,
                "messages": [
                    {
                        "role": m.role.value if hasattr(m.role, "value") else m.role,
                        "content": m.content,
                        "status": m.status.value if hasattr(m.status, "value") else m.status,
                        "created_at": m.created_at,
                    }
                    for m in messages
                ],
            }
        )


def _export_tables(db: Session, user_id: uuid.UUID, bundle: dict) -> None:
    """Metadata-only rows for logs/triggers/shares (ciphers stay server-side)."""
    from tollms.models.api_key import ApiRequestLog
    from tollms.models.attachment import Attachment
    from tollms.models.guardrail import GuardrailTrigger
    from tollms.models.prompt_logging import PromptLog
    from tollms.models.request_log import RequestLog
    from tollms.models.share import ConversationShare

    try:
        for att in db.execute(
            select(Attachment).where(
                Attachment.user_id == user_id, Attachment.is_deleted.is_(False)
            )
        ).scalars():
            bundle["attachments"].append(
                {
                    "filename": att.filename,
                    "mime_type": att.mime_type,
                    "kind": att.kind,
                    "file_size": att.file_size,
                    "created_at": att.created_at,
                }
            )
        for log in db.execute(
            select(PromptLog).where(PromptLog.user_id == user_id)
        ).scalars():
            bundle["prompt_logs"].append(
                {
                    "id": log.id,
                    "endpoint": log.endpoint,
                    "status": log.status,
                    "input_chars": log.input_chars,
                    "output_chars": log.output_chars,
                    "content_expired": log.content_expired,
                    "created_at": log.created_at,
                }
            )
        for log in db.execute(
            select(RequestLog).where(RequestLog.user_id == user_id)
        ).scalars():
            bundle["request_logs"].append(
                {
                    "status": log.status,
                    "total_tokens": log.total_tokens,
                    "total_cost": str(log.total_cost) if log.total_cost is not None else None,
                    "created_at": log.created_at,
                }
            )
        for log in db.execute(
            select(ApiRequestLog).where(ApiRequestLog.user_id == user_id)
        ).scalars():
            bundle["request_logs"].append(
                {
                    "endpoint": log.endpoint,
                    "status": log.status,
                    "total_tokens": log.total_tokens,
                    "created_at": log.created_at,
                }
            )
        for trig in db.execute(
            select(GuardrailTrigger).where(GuardrailTrigger.user_id == user_id)
        ).scalars():
            bundle["guardrail_triggers"].append(
                {
                    "category": trig.category,
                    "action": trig.action,
                    "severity": trig.severity,
                    "created_at": trig.created_at,
                }
            )
        for share in db.execute(
            select(ConversationShare).where(ConversationShare.user_id == user_id)
        ).scalars():
            bundle["shares"].append(
                {
                    "conversation_id": share.conversation_id,
                    "is_public": share.is_public,
                    "view_count": share.view_count,
                    "created_at": share.created_at,
                }
            )
    except Exception:
        logger.warning("privacy export tables failed", exc_info=True)
        raise


# --- erasure -------------------------------------------------------------------


async def request_erasure(
    db: Session,
    user: User,
    data: schemas.ErasureRequest,
    current_session_id: str | None = None,
) -> schemas.ErasureRead:
    """Erasure entry point: schedules the existing 15-day deletion grace via
    the settings deletion service. No purge logic duplicated here."""
    from tollms.api.settings import service as settings_service
    from tollms.api.settings.schemas import AccountDeleteRequest

    try:
        status = await settings_service.request_account_deletion(
            db,
            user,
            AccountDeleteRequest(current_password=data.current_password),
            current_session_id=current_session_id,
        )
    except (NotFoundError, ValidationError):
        raise
    except Exception:
        logger.warning("privacy request_erasure failed", exc_info=True)
        raise
    _emit("privacy.erasure_requested", user_id=str(user.id))
    return schemas.ErasureRead(
        scheduled_for=status.scheduled_for, days_remaining=status.days_remaining
    )
