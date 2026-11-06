"""Compliance operations business logic (Agent F).

All review functions take `admin_id` and enforce the platform-admin gate
app-side (defense in depth behind `platform_admin_required` on the router):
org RBAC roles must NOT widen this gate. Cross-id reads return 404, never
403 (no existence oracle). Every state transition appends a timeline entry
and best-effort writes Agent C's security-audit event (F6); audit failure
never fails the request — the timeline row is the durable record.
"""

import logging
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from tollms.core.exceptions import (
    ConflictError,
    NotFoundError,
    ServiceUnavailableError,
    ValidationError,
)
from tollms.models.incidents import (
    Complaint,
    ComplaintStatus,
    Incident,
    IncidentKind,
    IncidentSeverity,
    IncidentStatus,
    LegalRequest,
    LegalRequestStatus,
    LegalRequestType,
    Subprocessor,
    SubprocessorStatus,
    VulnerabilityReport,
    VulnReportStatus,
    VulnSeverity,
)
from tollms.models.user import PlatformRole, User

logger = logging.getLogger(__name__)

COMPLAINT_SLA_DAYS = 30

# --- transition machines (terminal states have no outgoing edges) -------------

INCIDENT_EDGES: dict[str, set[str]] = {
    IncidentStatus.OPEN.value: {"triaged", "duplicate", "closed"},
    IncidentStatus.TRIAGED.value: {"mitigating", "duplicate", "closed"},
    IncidentStatus.MITIGATING.value: {"resolved", "closed"},
    IncidentStatus.RESOLVED.value: {"closed"},
    IncidentStatus.CLOSED.value: set(),
    IncidentStatus.DUPLICATE.value: set(),
}

LEGAL_EDGES: dict[str, set[str]] = {
    LegalRequestStatus.RECEIVED.value: {"verifying", "rejected"},
    LegalRequestStatus.VERIFYING.value: {"validated", "rejected"},
    LegalRequestStatus.VALIDATED.value: {"in_review", "rejected"},
    LegalRequestStatus.IN_REVIEW.value: {"fulfilled", "rejected"},
    LegalRequestStatus.FULFILLED.value: {"closed"},
    LegalRequestStatus.REJECTED.value: {"closed"},
    LegalRequestStatus.CLOSED.value: set(),
}

VULN_EDGES: dict[str, set[str]] = {
    VulnReportStatus.RECEIVED.value: {"triaged", "dismissed"},
    VulnReportStatus.TRIAGED.value: {"confirmed", "dismissed"},
    VulnReportStatus.CONFIRMED.value: {"fixed", "dismissed"},
    VulnReportStatus.FIXED.value: {"disclosed", "closed"},
    VulnReportStatus.DISCLOSED.value: {"closed"},
    VulnReportStatus.DISMISSED.value: {"closed"},
    VulnReportStatus.CLOSED.value: set(),
}

COMPLAINT_EDGES: dict[str, set[str]] = {
    ComplaintStatus.RECEIVED.value: {"under_review", "dismissed"},
    ComplaintStatus.UNDER_REVIEW.value: {"resolved", "dismissed", "escalated"},
    ComplaintStatus.ESCALATED.value: {"resolved", "dismissed"},
    ComplaintStatus.RESOLVED.value: {"closed"},
    ComplaintStatus.DISMISSED.value: {"closed"},
    ComplaintStatus.CLOSED.value: set(),
}


# --- guards --------------------------------------------------------------------


def _require_platform_admin(db: Session, admin_id: uuid.UUID) -> User:
    """App-side platform-role gate. Raises 404 for unknown users (no oracle),
    403 for non-admins. Org membership/RBAC is never consulted here."""
    from tollms.core.exceptions import ForbiddenError

    try:
        user = db.get(User, admin_id)
    except Exception:
        logger.warning("incidents gate: user lookup failed", exc_info=True)
        raise NotFoundError("not found") from None
    if user is None or user.is_deleted:
        raise NotFoundError("not found")
    if user.platform_role != PlatformRole.PLATFORM_ADMIN:
        raise ForbiddenError("platform administrator access required")
    return user


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _timeline_entry(actor: str, from_status: str, to_status: str, note: str | None) -> dict:
    return {
        "at": _now().isoformat(),
        "actor": actor,
        "from": from_status,
        "to": to_status,
        "note": note or "",
    }


def _check_edge(edges: dict[str, set[str]], current: str, target: str, label: str) -> None:
    allowed = edges.get(current, set())
    if target not in allowed:
        raise ValidationError(
            f"illegal {label} transition: {current!r} -> {target!r}")


def _audit_event(db: Session, *, actor_admin_id: uuid.UUID, action: str,
                 target_type: str, target_id: uuid.UUID, outcome: str,
                 reason: str, metadata: dict | None = None,
                 severity: str = "warn") -> None:
    """Best-effort F6 security-audit write via Agent C's `record_event`
    (fail-open, never raises — the timeline entry committed with the row is
    the durable record).

    F6 pins `event_type` to C's CHECKed enum, which has no `incident.*`
    values, so F emits `config.security_changed` with the compliance action
    in `reason` + structured `metadata` ({domain: "incidents", action,
    table, from, to}). RECONCILE (Wave 3, orchestrator): mint dedicated
    `incident.*` / `legal_request.*` event types.
    """
    try:
        from tollms.api.security import service as security_service
    except ImportError:
        logger.warning("incidents audit fallback (security module absent): %s %s",
                       action, target_id, exc_info=True)
        return
    try:
        wrote = security_service.record_event(
            db, event_type="config.security_changed", actor_type="user",
            severity=severity, outcome=outcome, actor_user_id=actor_admin_id,
            target_type=target_type, target_id=target_id, reason=reason,
            metadata={"domain": "incidents", "action": action,
                      **(metadata or {})})
        if wrote is None:
            logger.warning("incidents audit not persisted (fail-open): %s %s",
                           action, target_id)
    except Exception:
        logger.warning("incidents audit fallback: %s %s", action, target_id,
                       exc_info=True)


def _parse_cursor(cursor: str | None, name: str = "cursor") -> tuple[int, uuid.UUID | None]:
    """Org-audit style cursor: non-negative int offset or anchor row UUID."""
    if not cursor:
        return 0, None
    text = cursor.strip()
    try:
        return min(max(int(text), 0), 5000), None
    except (TypeError, ValueError):
        pass
    try:
        anchor = uuid.UUID(text)
    except (TypeError, ValueError):
        raise ValidationError(f"unknown {name}: {cursor!r}") from None
    return 0, anchor


def _keyset_older_than(db: Session, model, anchor_id: uuid.UUID):
    """Anchor-row keyset predicate ((created_at, id) strictly older). 404
    when the anchor is unknown — same oracle posture as orgs/audit."""
    anchor = db.get(model, anchor_id)
    if anchor is None:
        raise ValidationError(f"unknown cursor: {anchor_id}")
    return or_(
        model.created_at < anchor.created_at,
        (model.created_at == anchor.created_at) & (model.id < anchor.id),
    )


# --- intake (public) -------------------------------------------------------------


def submit_vulnerability_report(db: Session, *, title: str, details: str,
                                affected: str | None = None,
                                reporter_contact: str | None = None,
                                reporter_user_id: uuid.UUID | None = None,
                                ) -> VulnerabilityReport:
    """Public vuln intake. Contact stored admin-only; response echoes id only."""
    if not title or len(title.strip()) < 4:
        raise ValidationError("title must be at least 4 characters")
    if not details or len(details.strip()) < 10:
        raise ValidationError("details must be at least 10 characters")
    try:
        row = VulnerabilityReport(
            title=title.strip(), details=details.strip(),
            affected=(affected or "").strip() or None,
            reporter_contact=(reporter_contact or "").strip() or None,
            reporter_user_id=reporter_user_id,
            status=VulnReportStatus.RECEIVED.value,
            severity=VulnSeverity.MEDIUM.value,
            timeline=[_timeline_entry("system", "", VulnReportStatus.RECEIVED.value,
                                      "intake received")],
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        return row
    except ValidationError:
        raise
    except Exception:
        db.rollback()
        logger.warning("vuln intake failed", exc_info=True)
        raise ValidationError("could not accept vulnerability report") from None


def submit_complaint(db: Session, *, subject: str, details: str,
                     category: str = "general",
                     reporter_contact: str | None = None,
                     reporter_user_id: uuid.UUID | None = None,
                     ) -> Complaint:
    """Public complaint/grievance intake (F5 grievance-handoff target lives
    here until Agent B's DSR wiring references it)."""
    if not subject or len(subject.strip()) < 4:
        raise ValidationError("subject must be at least 4 characters")
    if not details or len(details.strip()) < 10:
        raise ValidationError("details must be at least 10 characters")
    try:
        row = Complaint(
            subject=subject.strip(), details=details.strip(),
            category=(category or "general").strip()[:64] or "general",
            reporter_contact=(reporter_contact or "").strip() or None,
            reporter_user_id=reporter_user_id,
            status=ComplaintStatus.RECEIVED.value,
            sla_due_at=_now() + timedelta(days=COMPLAINT_SLA_DAYS),
            timeline=[_timeline_entry("system", "", ComplaintStatus.RECEIVED.value,
                                      "intake received")],
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        return row
    except ValidationError:
        raise
    except Exception:
        db.rollback()
        logger.warning("complaint intake failed", exc_info=True)
        raise ValidationError("could not accept complaint") from None


def submit_legal_contact(db: Session, *, claimant: str,
                         authority_ref: str | None = None,
                         details: str = "",
                         reporter_contact: str | None = None,
                         ) -> LegalRequest:
    """Public legal-contact intake. Creates a RECEIVED hold-active row; nothing
    is disclosed — verification happens in review (never auto-disclose)."""
    if not claimant or len(claimant.strip()) < 2:
        raise ValidationError("claimant must be named")
    try:
        row = LegalRequest(
            claimant=claimant.strip(),
            authority_ref=(authority_ref or "").strip() or None,
            reporter_contact=(reporter_contact or "").strip() or None,
            request_type=LegalRequestType.OTHER.value,
            status=LegalRequestStatus.RECEIVED.value,
            hold_active=True,
            verify_notes=(details or "").strip()[:5000] or None,
            timeline=[_timeline_entry("system", "", LegalRequestStatus.RECEIVED.value,
                                      "legal contact received; hold active")],
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        return row
    except ValidationError:
        raise
    except Exception:
        db.rollback()
        logger.warning("legal contact intake failed", exc_info=True)
        raise ValidationError("could not accept legal contact") from None


# --- legal-hold guard (deletion-engine hook) --------------------------------------


def has_active_hold(db: Session) -> bool:
    """True when any live legal request still holds. The DSR/account-purge
    engine must call `assert_no_active_hold` before any hard delete."""
    try:
        row = db.execute(
            select(LegalRequest.id).where(
                LegalRequest.is_deleted.is_(False),
                LegalRequest.hold_active.is_(True),
            ).limit(1)
        ).first()
        return row is not None
    except Exception:
        logger.warning("legal-hold check failed", exc_info=True)
        # Fail closed: an unreadable hold table blocks purging.
        return True


def assert_no_active_hold(db: Session) -> None:
    if has_active_hold(db):
        raise ConflictError("purge blocked: active legal hold — resolve holds first")


# --- admin review: incidents -------------------------------------------------------


def _case_page(rows, next_cursor: str | None) -> tuple[list, str | None]:
    return rows, next_cursor


def list_incidents(db: Session, admin_id: uuid.UUID, *, status: str | None = None,
                   severity: str | None = None, limit: int = 50,
                   cursor: str | None = None) -> tuple[list[Incident], str | None]:
    _require_platform_admin(db, admin_id)
    lim = min(max(limit, 1), 200)
    stmt = select(Incident).where(Incident.is_deleted.is_(False))
    if status:
        stmt = stmt.where(Incident.status == status)
    if severity:
        stmt = stmt.where(Incident.severity == severity)
    off, anchor = _parse_cursor(cursor)
    if anchor is not None:
        stmt = stmt.where(_keyset_older_than(db, Incident, anchor))
    rows = list(db.execute(
        stmt.order_by(Incident.created_at.desc(), Incident.id.desc())
        .limit(lim + 1).offset(off)).scalars().all())
    next_cursor = str(rows[lim - 1].id) if len(rows) > lim else None
    return _case_page(rows[:lim], next_cursor)


def get_incident(db: Session, admin_id: uuid.UUID, incident_id: uuid.UUID) -> Incident:
    _require_platform_admin(db, admin_id)
    row = db.get(Incident, incident_id)
    if row is None or row.is_deleted:
        raise NotFoundError("not found")
    return row


def create_incident(db: Session, admin_id: uuid.UUID, *, title: str, kind: str,
                    severity: str, summary: str | None = None) -> Incident:
    admin = _require_platform_admin(db, admin_id)
    if kind not in {k.value for k in IncidentKind}:
        raise ValidationError(f"unknown incident kind: {kind!r}")
    if severity not in {s.value for s in IncidentSeverity}:
        raise ValidationError(f"unknown incident severity: {severity!r}")
    if not title or len(title.strip()) < 4:
        raise ValidationError("title must be at least 4 characters")
    try:
        row = Incident(title=title.strip(), kind=kind, severity=severity,
                       summary=(summary or "").strip() or None,
                       status=IncidentStatus.OPEN.value,
                       owner_admin_id=admin.id,
                       timeline=[_timeline_entry(str(admin.id), "",
                                                 IncidentStatus.OPEN.value, "incident opened")])
        db.add(row)
        db.commit()
        db.refresh(row)
        _audit_event(db, actor_admin_id=admin.id, action="incident.opened",
                     target_type="incident", target_id=row.id, outcome="allowed",
                     reason="incident.opened", metadata={"severity": severity, "kind": kind},
                     severity="info")
        return row
    except ValidationError:
        raise
    except Exception:
        db.rollback()
        logger.warning("incident create failed", exc_info=True)
        raise ValidationError("could not create incident") from None


def transition_incident(db: Session, admin_id: uuid.UUID, incident_id: uuid.UUID, *,
                        to_status: str, note: str | None = None,
                        owner_admin_id: uuid.UUID | None = None) -> Incident:
    admin = _require_platform_admin(db, admin_id)
    row = db.get(Incident, incident_id)
    if row is None or row.is_deleted:
        raise NotFoundError("not found")
    _check_edge(INCIDENT_EDGES, row.status, to_status, "incident")
    old = row.status
    try:
        row.status = to_status
        if owner_admin_id is not None:
            row.owner_admin_id = owner_admin_id
        if to_status == IncidentStatus.RESOLVED.value:
            row.resolved_at = _now()
        if to_status in (IncidentStatus.CLOSED.value, IncidentStatus.DUPLICATE.value):
            row.closed_at = _now()
        row.timeline = [*row.timeline,
                        _timeline_entry(str(admin.id), old, to_status, note)]
        db.commit()
        db.refresh(row)
        _audit_event(db, actor_admin_id=admin.id, action="incident.status_changed",
                     target_type="incident", target_id=row.id, outcome="allowed",
                     reason=f"incident.status_changed:{old}->{to_status}",
                     metadata={"from": old, "to": to_status})
        return row
    except ValidationError:
        raise
    except Exception:
        db.rollback()
        logger.warning("incident transition failed", exc_info=True)
        raise ValidationError("could not transition incident") from None


# --- admin review: legal requests ----------------------------------------------------


def list_legal_requests(db: Session, admin_id: uuid.UUID, *, status: str | None = None,
                        limit: int = 50, cursor: str | None = None,
                        ) -> tuple[list[LegalRequest], str | None]:
    _require_platform_admin(db, admin_id)
    lim = min(max(limit, 1), 200)
    stmt = select(LegalRequest).where(LegalRequest.is_deleted.is_(False))
    if status:
        stmt = stmt.where(LegalRequest.status == status)
    off, anchor = _parse_cursor(cursor)
    if anchor is not None:
        stmt = stmt.where(_keyset_older_than(db, LegalRequest, anchor))
    rows = list(db.execute(
        stmt.order_by(LegalRequest.created_at.desc(), LegalRequest.id.desc())
        .limit(lim + 1).offset(off)).scalars().all())
    next_cursor = str(rows[lim - 1].id) if len(rows) > lim else None
    return rows[:lim], next_cursor


def get_legal_request(db: Session, admin_id: uuid.UUID, request_id: uuid.UUID) -> LegalRequest:
    _require_platform_admin(db, admin_id)
    row = db.get(LegalRequest, request_id)
    if row is None or row.is_deleted:
        raise NotFoundError("not found")
    return row


def transition_legal_request(db: Session, admin_id: uuid.UUID, request_id: uuid.UUID, *,
                             to_status: str, note: str | None = None,
                             link_incident_id: uuid.UUID | None = None) -> LegalRequest:
    """Dual-approval: `fulfilled` requires a prior `validated` by a DIFFERENT
    admin. Never auto-disclose: fulfillment records the act, never payload."""
    admin = _require_platform_admin(db, admin_id)
    row = db.get(LegalRequest, request_id)
    if row is None or row.is_deleted:
        raise NotFoundError("not found")
    _check_edge(LEGAL_EDGES, row.status, to_status, "legal-request")
    if to_status == LegalRequestStatus.VALIDATED.value:
        row.verified_by = admin.id
    if to_status == LegalRequestStatus.FULFILLED.value:
        if row.verified_by is None:
            raise ValidationError("must be validated before fulfillment")
        if row.verified_by == admin.id:
            raise ValidationError("fulfillment requires a different admin than validation")
        row.fulfilled_by = admin.id
    old = row.status
    try:
        row.status = to_status
        if link_incident_id is not None:
            link = db.get(Incident, link_incident_id)
            if link is None or link.is_deleted:
                raise NotFoundError("not found")
            row.related_incident_id = link_incident_id
        if to_status == LegalRequestStatus.CLOSED.value:
            row.hold_active = False
        row.timeline = [*row.timeline,
                        _timeline_entry(str(admin.id), old, to_status, note)]
        db.commit()
        db.refresh(row)
        _audit_event(db, actor_admin_id=admin.id, action="legal_request.status_changed",
                     target_type="legal_request", target_id=row.id, outcome="allowed",
                     reason=f"legal_request.status_changed:{old}->{to_status}",
                     metadata={"from": old, "to": to_status})
        return row
    except (ValidationError, NotFoundError):
        raise
    except Exception:
        db.rollback()
        logger.warning("legal-request transition failed", exc_info=True)
        raise ValidationError("could not transition legal request") from None


# --- admin review: vulnerability reports -----------------------------------------------


def list_vuln_reports(db: Session, admin_id: uuid.UUID, *, status: str | None = None,
                      severity: str | None = None, limit: int = 50,
                      cursor: str | None = None) -> tuple[list[VulnerabilityReport], str | None]:
    _require_platform_admin(db, admin_id)
    lim = min(max(limit, 1), 200)
    stmt = select(VulnerabilityReport).where(VulnerabilityReport.is_deleted.is_(False))
    if status:
        stmt = stmt.where(VulnerabilityReport.status == status)
    if severity:
        stmt = stmt.where(VulnerabilityReport.severity == severity)
    off, anchor = _parse_cursor(cursor)
    if anchor is not None:
        stmt = stmt.where(_keyset_older_than(db, VulnerabilityReport, anchor))
    rows = list(db.execute(
        stmt.order_by(VulnerabilityReport.created_at.desc(), VulnerabilityReport.id.desc())
        .limit(lim + 1).offset(off)).scalars().all())
    next_cursor = str(rows[lim - 1].id) if len(rows) > lim else None
    return rows[:lim], next_cursor


def get_vuln_report(db: Session, admin_id: uuid.UUID, report_id: uuid.UUID) -> VulnerabilityReport:
    _require_platform_admin(db, admin_id)
    row = db.get(VulnerabilityReport, report_id)
    if row is None or row.is_deleted:
        raise NotFoundError("not found")
    return row


def transition_vuln_report(db: Session, admin_id: uuid.UUID, report_id: uuid.UUID, *,
                           to_status: str, note: str | None = None,
                           link_incident_id: uuid.UUID | None = None) -> VulnerabilityReport:
    admin = _require_platform_admin(db, admin_id)
    row = db.get(VulnerabilityReport, report_id)
    if row is None or row.is_deleted:
        raise NotFoundError("not found")
    _check_edge(VULN_EDGES, row.status, to_status, "vulnerability-report")
    old = row.status
    try:
        row.status = to_status
        if link_incident_id is not None:
            link = db.get(Incident, link_incident_id)
            if link is None or link.is_deleted:
                raise NotFoundError("not found")
            row.related_incident_id = link_incident_id
        if to_status == VulnReportStatus.FIXED.value:
            row.fixed_at = _now()
        if to_status == VulnReportStatus.DISCLOSED.value:
            row.coordinated_disclosure_at = _now()
        row.timeline = [*row.timeline,
                        _timeline_entry(str(admin.id), old, to_status, note)]
        db.commit()
        db.refresh(row)
        _audit_event(db, actor_admin_id=admin.id, action="vuln_report.status_changed",
                     target_type="vulnerability_report", target_id=row.id, outcome="allowed",
                     reason=f"vuln_report.status_changed:{old}->{to_status}",
                     metadata={"from": old, "to": to_status})
        return row
    except (ValidationError, NotFoundError):
        raise
    except Exception:
        db.rollback()
        logger.warning("vuln transition failed", exc_info=True)
        raise ValidationError("could not transition vulnerability report") from None


# --- admin review: complaints ------------------------------------------------------------


def list_complaints(db: Session, admin_id: uuid.UUID, *, status: str | None = None,
                    limit: int = 50, cursor: str | None = None,
                    ) -> tuple[list[Complaint], str | None]:
    _require_platform_admin(db, admin_id)
    lim = min(max(limit, 1), 200)
    stmt = select(Complaint).where(Complaint.is_deleted.is_(False))
    if status:
        stmt = stmt.where(Complaint.status == status)
    off, anchor = _parse_cursor(cursor)
    if anchor is not None:
        stmt = stmt.where(_keyset_older_than(db, Complaint, anchor))
    rows = list(db.execute(
        stmt.order_by(Complaint.created_at.desc(), Complaint.id.desc())
        .limit(lim + 1).offset(off)).scalars().all())
    next_cursor = str(rows[lim - 1].id) if len(rows) > lim else None
    return rows[:lim], next_cursor


def get_complaint(db: Session, admin_id: uuid.UUID, complaint_id: uuid.UUID) -> Complaint:
    _require_platform_admin(db, admin_id)
    row = db.get(Complaint, complaint_id)
    if row is None or row.is_deleted:
        raise NotFoundError("not found")
    return row


def transition_complaint(db: Session, admin_id: uuid.UUID, complaint_id: uuid.UUID, *,
                         to_status: str, note: str | None = None,
                         link_incident_id: uuid.UUID | None = None) -> Complaint:
    admin = _require_platform_admin(db, admin_id)
    row = db.get(Complaint, complaint_id)
    if row is None or row.is_deleted:
        raise NotFoundError("not found")
    _check_edge(COMPLAINT_EDGES, row.status, to_status, "complaint")
    old = row.status
    try:
        row.status = to_status
        if link_incident_id is not None:
            link = db.get(Incident, link_incident_id)
            if link is None or link.is_deleted:
                raise NotFoundError("not found")
            row.related_incident_id = link_incident_id
        row.timeline = [*row.timeline,
                        _timeline_entry(str(admin.id), old, to_status, note)]
        db.commit()
        db.refresh(row)
        _audit_event(db, actor_admin_id=admin.id, action="complaint.status_changed",
                     target_type="complaint", target_id=row.id, outcome="allowed",
                     reason=f"complaint.status_changed:{old}->{to_status}",
                     metadata={"from": old, "to": to_status})
        return row
    except (ValidationError, NotFoundError):
        raise
    except Exception:
        db.rollback()
        logger.warning("complaint transition failed", exc_info=True)
        raise ValidationError("could not transition complaint") from None


# --- abuse review queue (D-owned table, read-only from here) ---------------------------------


def get_abuse_review_queue(db: Session, admin_id: uuid.UUID, *, status: str | None = None,
                           limit: int = 50) -> dict:
    """F7 read-only pass-through to Agent D's `list_reports` (D owns intake +
    PATCH; F never writes abuse rows). Platform-admin callers see the full
    queue via D's `_is_admin` scope. D raises ValidationError on bad status.
    """
    _require_platform_admin(db, admin_id)
    from tollms.api.governance import service as governance_service
    items = governance_service.list_reports(db, admin_id, status=status, limit=limit)
    return {"items": items, "next_cursor": None, "pending_integration": False}


# --- subprocessors -----------------------------------------------------------------


def public_subprocessors(db: Session) -> list[dict]:
    """Trust Center shape — exactly F10 {name, purpose, location, status} for
    active rows only. Never includes dpa_ref or timestamps."""
    try:
        rows = db.execute(
            select(Subprocessor).where(
                Subprocessor.is_deleted.is_(False),
                Subprocessor.status == SubprocessorStatus.ACTIVE.value,
            ).order_by(Subprocessor.name.asc())
        ).scalars().all()
        return [{"name": r.name, "purpose": r.purpose, "location": r.location,
                 "status": r.status} for r in rows]
    except Exception:
        logger.warning("public subprocessor list failed", exc_info=True)
        raise ServiceUnavailableError("subprocessor list unavailable") from None


def list_subprocessors(db: Session, admin_id: uuid.UUID) -> list[Subprocessor]:
    _require_platform_admin(db, admin_id)
    return list(db.execute(
        select(Subprocessor).where(Subprocessor.is_deleted.is_(False))
        .order_by(Subprocessor.name.asc())).scalars().all())


def create_subprocessor(db: Session, admin_id: uuid.UUID, *, name: str, purpose: str,
                        location: str, status: str,
                        dpa_ref: str | None = None) -> Subprocessor:
    admin = _require_platform_admin(db, admin_id)
    if status not in {s.value for s in SubprocessorStatus}:
        raise ValidationError(f"unknown subprocessor status: {status!r}")
    if not name or not name.strip():
        raise ValidationError("subprocessor name is required")
    try:
        row = Subprocessor(name=name.strip(), purpose=(purpose or "").strip(),
                           location=(location or "").strip(), status=status,
                           dpa_ref=(dpa_ref or "").strip() or None)
        db.add(row)
        db.commit()
        db.refresh(row)
        _audit_event(db, actor_admin_id=admin.id, action="subprocessor.created",
                     target_type="subprocessor", target_id=row.id, outcome="allowed",
                     reason="subprocessor.created",
                     metadata={"subprocessor": row.name}, severity="info")
        return row
    except ValidationError:
        raise
    except Exception:
        db.rollback()
        logger.warning("subprocessor create failed", exc_info=True)
        raise ValidationError("could not create subprocessor") from None


def update_subprocessor(db: Session, admin_id: uuid.UUID, sub_id: uuid.UUID, *,
                        purpose: str | None = None, location: str | None = None,
                        status: str | None = None, dpa_ref: str | None = None,
                        ) -> Subprocessor:
    admin = _require_platform_admin(db, admin_id)
    row = db.get(Subprocessor, sub_id)
    if row is None or row.is_deleted:
        raise NotFoundError("not found")
    if status is not None and status not in {s.value for s in SubprocessorStatus}:
        raise ValidationError(f"unknown subprocessor status: {status!r}")
    try:
        if purpose is not None:
            row.purpose = purpose.strip()
        if location is not None:
            row.location = location.strip()
        if status is not None:
            row.status = status
            row.removed_at = _now() if status == SubprocessorStatus.REMOVED.value else None
        if dpa_ref is not None:
            row.dpa_ref = dpa_ref.strip() or None
        db.commit()
        db.refresh(row)
        _audit_event(db, actor_admin_id=admin.id, action="subprocessor.updated",
                     target_type="subprocessor", target_id=row.id, outcome="allowed",
                     reason="subprocessor.updated",
                     metadata={"subprocessor": row.name})
        return row
    except ValidationError:
        raise
    except Exception:
        db.rollback()
        logger.warning("subprocessor update failed", exc_info=True)
        raise ValidationError("could not update subprocessor") from None


def delete_subprocessor(db: Session, admin_id: uuid.UUID, sub_id: uuid.UUID) -> None:
    """Soft-delete only (name becomes reusable via the live-unique index)."""
    _require_platform_admin(db, admin_id)
    row = db.get(Subprocessor, sub_id)
    if row is None or row.is_deleted:
        raise NotFoundError("not found")
    try:
        from tollms.db.base import SoftDeleteMixin  # noqa: F401 (documents mixin use)
        row.is_deleted = True
        row.deleted_at = _now()
        row.deleted_by = admin_id
        db.commit()
    except Exception:
        db.rollback()
        logger.warning("subprocessor delete failed", exc_info=True)
        raise ValidationError("could not delete subprocessor") from None
