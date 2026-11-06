"""Governance feature service: provider-policy registry + abuse reports.

Reads reuse the guardrails deterministic engine (pure functions only) and the
orgs membership pattern (read-only). Advisory in Wave 2: nothing here blocks
gateway traffic (see docs/compliance/ai/ENFORCEMENT.md).
"""

import logging
import uuid
from datetime import date
from typing import Any

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from tollms.api.governance.schemas import (
    REASON_VALUES,
    STATUS_VALUES,
    SUBJECT_VALUES,
    TRAINING_VALUES,
)
from tollms.core.exceptions import ConflictError, NotFoundError, ValidationError
from tollms.models.governance import AbuseReport, AbuseReportStatus, ProviderPolicy

logger = logging.getLogger(__name__)

_NOT_FOUND = "governance record not found"

# F7 transition map. Terminal: dismissed, action_upheld, action_reversed.
# action_taken -> appeal_filed lives in file_appeal only (one appeal per report).
_TRANSITIONS: dict[str, set[str]] = {
    "submitted": {"under_review", "dismissed"},
    "under_review": {"action_taken", "dismissed"},
    "appeal_filed": {"action_upheld", "action_reversed"},
}

SEED_POLICIES: list[dict[str, Any]] = [
    {"provider_key": "OPENAI", "display_name": "OpenAI"},
    {"provider_key": "ANTHROPIC_MESSAGES", "display_name": "Anthropic"},
    {"provider_key": "GEMINI", "display_name": "Google Gemini"},
    {"provider_key": "VERTEX_AI", "display_name": "Google Vertex AI"},
    {"provider_key": "BEDROCK_CONVERSE", "display_name": "AWS Bedrock"},
    {"provider_key": "CUSTOM", "display_name": "Custom / OpenAI-compatible"},
]

_SEED_NOTE = "unverified - hand seed, curator review required"


def _is_admin(db: Session, user_id: uuid.UUID) -> bool:
    """Platform-admin check for review/curation gates. Fail-closed False."""
    try:
        from tollms.models.user import PlatformRole, User

        user = db.get(User, user_id)
        return user is not None and user.platform_role == PlatformRole.PLATFORM_ADMIN
    except Exception:
        logger.warning("governance admin check failed", exc_info=True)
        return False


def _caller_org_ids(db: Session, user_id: uuid.UUID) -> set[uuid.UUID]:
    """Live ACTIVE orgs for one user. Read-only; DB errors yield empty."""
    from tollms.models.organization import Membership, MembershipState

    try:
        return set(
            db.scalars(
                select(Membership.org_id).where(
                    Membership.user_id == user_id,
                    Membership.is_deleted.is_(False),
                    Membership.state == MembershipState.ACTIVE.value,
                )
            )
        )
    except Exception:
        logger.warning("governance org lookup failed", exc_info=True)
        return set()


def _is_stale(row: ProviderPolicy, today: date | None = None) -> bool:
    """Overdue review: never reviewed, or past review_cadence_days."""
    ref = today or date.today()
    if row.last_reviewed_at is None:
        return True
    return (ref - row.last_reviewed_at).days >= (row.review_cadence_days or 180)


def _read_policy(row: ProviderPolicy) -> dict[str, Any]:
    from tollms.api.governance.schemas import ProviderPolicyRead

    data = {c.name: getattr(row, c.name) for c in row.__table__.columns}
    data["stale"] = _is_stale(row)
    return ProviderPolicyRead(**data)


def _read_report(row: AbuseReport) -> dict[str, Any]:
    from tollms.api.governance.schemas import AbuseReportRead

    return AbuseReportRead(
        id=row.id, reporter_user_id=row.reporter_user_id, org_id=row.org_id,
        subject_type=row.subject_type, subject_id=row.subject_id,
        reason_code=row.reason_code, details=row.details,
        scan_flags=list(row.scan_flags or []), status=row.status,
        assignee=row.assignee, resolution_note=row.resolution_note,
        appeal_note=row.appeal_note, created_at=row.created_at,
        updated_at=row.updated_at,
    )


def ensure_seed_policies(db: Session) -> list[ProviderPolicy]:
    """Idempotent global seed: one row per ProviderType family. Never rewrites."""
    rows: list[ProviderPolicy] = []
    for seed in SEED_POLICIES:
        row = db.scalars(
            select(ProviderPolicy).where(
                ProviderPolicy.provider_key == seed["provider_key"],
                ProviderPolicy.scope == "global",
                ProviderPolicy.is_deleted.is_(False),
            )
        ).first()
        if row is None:
            row = ProviderPolicy(
                provider_key=seed["provider_key"], scope="global", org_id=None,
                display_name=seed["display_name"], training_on_inputs="unknown",
                source_notes=_SEED_NOTE,
            )
            db.add(row)
            db.flush()
        rows.append(row)
    if db.new or db.dirty:
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            logger.warning("governance seed race lost, rereading", exc_info=True)
            return ensure_seed_policies(db)
    return rows


def _validate_policy_fields(data: Any, *, is_create: bool = False) -> None:
    get = (lambda k, d=None: getattr(data, k, d)) if not isinstance(data, dict) else data.get
    scope = get("scope", "global" if is_create else None)
    if scope is not None and scope not in ("global", "organization"):
        raise ValidationError(f"invalid scope: {scope!r}")
    training = get("training_on_inputs", None)
    if training is not None and training not in TRAINING_VALUES:
        raise ValidationError(f"invalid training_on_inputs: {training!r}")
    if is_create:
        org_id = get("org_id", None)
        if scope == "organization" and org_id is None:
            raise ValidationError("organization scope requires org_id")
        if scope == "global" and org_id is not None:
            raise ValidationError("global scope must not carry org_id")


def list_policies(
    db: Session,
    caller_id: uuid.UUID,
    *,
    provider_key: str | None = None,
    scope: str | None = None,
    stale_only: bool = False,
) -> list[Any]:
    ensure_seed_policies(db)
    if scope is not None and scope not in ("global", "organization"):
        raise ValidationError(f"invalid scope: {scope!r}")
    orgs = _caller_org_ids(db, caller_id)
    stmt = select(ProviderPolicy).where(ProviderPolicy.is_deleted.is_(False))
    if provider_key is not None:
        stmt = stmt.where(ProviderPolicy.provider_key == provider_key.strip())
    if scope is not None:
        stmt = stmt.where(ProviderPolicy.scope == scope)
    admin = _is_admin(db, caller_id)
    out: list[Any] = []
    for row in db.scalars(stmt.order_by(ProviderPolicy.provider_key)):
        if not admin and row.scope == "organization" and row.org_id not in orgs:
            continue  # 404-oracle: strangers never see foreign org rows
        if stale_only and not _is_stale(row):
            continue
        out.append(_read_policy(row))
    return out


def get_policy(db: Session, caller_id: uuid.UUID, policy_id: uuid.UUID) -> Any:
    ensure_seed_policies(db)
    row = db.get(ProviderPolicy, policy_id)
    if row is None or row.is_deleted:
        raise NotFoundError(_NOT_FOUND)
    if (row.scope == "organization" and not _is_admin(db, caller_id)
            and row.org_id not in _caller_org_ids(db, caller_id)):
        raise NotFoundError(_NOT_FOUND)
    return _read_policy(row)


def create_policy(db: Session, caller_id: uuid.UUID, data: Any) -> Any:
    from tollms.models.organization import Organization

    _validate_policy_fields(data, is_create=True)
    if data.scope == "organization":
        org = db.get(Organization, data.org_id)
        if org is None or org.is_deleted:
            raise NotFoundError("organization not found")
    row = ProviderPolicy(
        provider_key=data.provider_key.strip(), scope=data.scope, org_id=data.org_id,
        display_name=data.display_name, terms_url=data.terms_url, aup_url=data.aup_url,
        privacy_url=data.privacy_url, dpa_url=data.dpa_url,
        status_page_url=data.status_page_url,
        commercial_use_allowed=data.commercial_use_allowed,
        training_on_inputs=data.training_on_inputs or "unknown",
        retention_summary=data.retention_summary, retention_days=data.retention_days,
        dpa_available=bool(data.dpa_available),
        region_pinning_available=bool(data.region_pinning_available),
        last_reviewed_at=data.last_reviewed_at,
        review_cadence_days=data.review_cadence_days or 180,
        source_notes=data.source_notes, is_active=bool(data.is_active),
    )
    db.add(row)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise ConflictError(f"provider policy {row.provider_key!r} already exists") from None
    db.refresh(row)
    logger.info("governance policy created: %s scope=%s", row.provider_key, row.scope)
    return _read_policy(row)


def update_policy(db: Session, caller_id: uuid.UUID, policy_id: uuid.UUID, data: Any) -> Any:
    row = db.get(ProviderPolicy, policy_id)
    if row is None or row.is_deleted:
        raise NotFoundError(_NOT_FOUND)
    _validate_policy_fields(data)
    for field in ("display_name", "terms_url", "aup_url", "privacy_url", "dpa_url",
                  "status_page_url", "commercial_use_allowed", "training_on_inputs",
                  "retention_summary", "retention_days", "dpa_available",
                  "region_pinning_available", "last_reviewed_at",
                  "review_cadence_days", "source_notes", "is_active"):
        value = getattr(data, field, None)
        if value is not None:
            setattr(row, field, value)
    db.commit()
    db.refresh(row)
    return _read_policy(row)


def delete_policy(db: Session, caller_id: uuid.UUID, policy_id: uuid.UUID) -> None:
    from datetime import datetime, timezone

    row = db.get(ProviderPolicy, policy_id)
    if row is None or row.is_deleted:
        raise NotFoundError(_NOT_FOUND)
    row.is_deleted, row.deleted_at, row.deleted_by = True, datetime.now(timezone.utc), caller_id
    db.commit()


def _scan_details(details: str) -> list[str]:
    """Kind-only deterministic scan of report text. Never raises, never blocks."""
    try:
        from tollms.services.guardrails import deterministic as det_engine

        return sorted({
            str(f.get("category", "unknown"))
            for f in det_engine.scan_text(details or "")
            if f.get("category")
        })
    except Exception:
        logger.warning("governance abuse scan failed (fail-open)", exc_info=True)
        return ["scan_unavailable"]


def submit_report(db: Session, caller_id: uuid.UUID, data: Any) -> Any:
    if data.reason_code not in REASON_VALUES:
        raise ValidationError(f"invalid reason_code: {data.reason_code!r}")
    if data.subject_type not in SUBJECT_VALUES:
        raise ValidationError(f"invalid subject_type: {data.subject_type!r}")
    org_id = data.org_id
    if org_id is not None and org_id not in _caller_org_ids(db, caller_id):
        raise NotFoundError(_NOT_FOUND)
    row = AbuseReport(
        reporter_user_id=caller_id, org_id=org_id, subject_type=data.subject_type,
        subject_id=data.subject_id, reason_code=data.reason_code,
        details=data.details, scan_flags=_scan_details(data.details),
        status=AbuseReportStatus.SUBMITTED.value,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    logger.info("governance abuse report submitted: %s reason=%s", row.id, row.reason_code)
    return _read_report(row)


def _report_scope(db: Session, caller_id: uuid.UUID) -> Any:
    if _is_admin(db, caller_id):
        return select(AbuseReport).where(AbuseReport.is_deleted.is_(False))
    orgs = _caller_org_ids(db, caller_id)
    stmt = select(AbuseReport).where(AbuseReport.is_deleted.is_(False))
    if orgs:
        from sqlalchemy import or_

        return stmt.where(or_(
            AbuseReport.reporter_user_id == caller_id,
            AbuseReport.org_id.in_(list(orgs)),
        ))
    return stmt.where(AbuseReport.reporter_user_id == caller_id)


def list_reports(
    db: Session, caller_id: uuid.UUID, *, status: str | None = None, limit: int = 50
) -> list[Any]:
    if status is not None and status not in STATUS_VALUES:
        raise ValidationError(f"invalid status: {status!r}")
    stmt = _report_scope(db, caller_id)
    if status is not None:
        stmt = stmt.where(AbuseReport.status == status)
    rows = list(db.scalars(
        stmt.order_by(AbuseReport.created_at.desc()).limit(min(max(limit, 1), 200))))
    return [_read_report(r) for r in rows]


def get_report(db: Session, caller_id: uuid.UUID, report_id: uuid.UUID) -> Any:
    row = db.get(AbuseReport, report_id)
    if row is None or row.is_deleted:
        raise NotFoundError(_NOT_FOUND)
    if (row.reporter_user_id != caller_id and not _is_admin(db, caller_id)
            and row.org_id not in _caller_org_ids(db, caller_id)):
        raise NotFoundError(_NOT_FOUND)
    return _read_report(row)


def set_report_status(
    db: Session, caller_id: uuid.UUID, report_id: uuid.UUID,
    status: str, resolution_note: str | None = None,
    assignee: uuid.UUID | None = None,
) -> Any:
    if status not in STATUS_VALUES:
        raise ValidationError(f"invalid status: {status!r}")
    row = db.get(AbuseReport, report_id)
    if row is None or row.is_deleted:
        raise NotFoundError(_NOT_FOUND)
    allowed = _TRANSITIONS.get(row.status, set())
    if status not in allowed:
        raise ValidationError(f"illegal transition: {row.status} -> {status}")
    row.status = status
    if resolution_note is not None:
        row.resolution_note = resolution_note
    if assignee is not None:
        row.assignee = assignee
    db.commit()
    db.refresh(row)
    logger.info("governance report %s: %s (actor %s)", row.id, status, caller_id)
    return _read_report(row)


def file_appeal(db: Session, caller_id: uuid.UUID, report_id: uuid.UUID, appeal_note: str) -> Any:
    row = db.get(AbuseReport, report_id)
    if row is None or row.is_deleted:
        raise NotFoundError(_NOT_FOUND)
    if row.reporter_user_id != caller_id:
        raise NotFoundError(_NOT_FOUND)
    if row.status != AbuseReportStatus.ACTION_TAKEN.value:
        raise ValidationError("appeals are only available from action_taken")
    if row.appeal_note:
        raise ValidationError("only one appeal per report")
    row.appeal_note = appeal_note
    row.status = AbuseReportStatus.APPEAL_FILED.value
    db.commit()
    db.refresh(row)
    logger.info("governance report %s appealed", row.id)
    return _read_report(row)
