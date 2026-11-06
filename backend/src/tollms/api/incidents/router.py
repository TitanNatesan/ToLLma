"""Compliance operations endpoints only. No business logic.

Public intake (vuln/complaint/legal-contact) is intentionally unauthenticated
— external reporters may hold no account — and IP rate-limited instead.
Abuse intake is NOT here (F7: Agent D owns it). Everything under
`/api/admin/compliance` requires `platform_admin_required` (platform-role
gate only; org RBAC never widens it).
"""

import uuid

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from tollms.api.incidents import schemas, service
from tollms.core.deps import get_db
from tollms.core.rate_limit import limit
from tollms.core.security import platform_admin_required
from tollms.models.user import User

router = APIRouter(tags=["incidents"])

_intake_guard = limit("incidents:intake", max_attempts=20, window_seconds=3600)


# --- public intake -----------------------------------------------------------------


@router.post("/api/v1/incidents/reports/vulnerability",
             response_model=schemas.IntakeAccepted, status_code=201)
def report_vulnerability(data: schemas.VulnIntake,
                         db: Session = Depends(get_db),
                         _guard: None = Depends(_intake_guard)) -> schemas.IntakeAccepted:
    row = service.submit_vulnerability_report(
        db, title=data.title, details=data.details, affected=data.affected,
        reporter_contact=data.reporter_contact)
    return schemas.IntakeAccepted(id=row.id, status=row.status, received_at=row.created_at)


@router.post("/api/v1/incidents/reports/complaint",
             response_model=schemas.IntakeAccepted, status_code=201)
def report_complaint(data: schemas.ComplaintIntake,
                     db: Session = Depends(get_db),
                     _guard: None = Depends(_intake_guard)) -> schemas.IntakeAccepted:
    row = service.submit_complaint(
        db, subject=data.subject, details=data.details, category=data.category,
        reporter_contact=data.reporter_contact)
    return schemas.IntakeAccepted(id=row.id, status=row.status, received_at=row.created_at)


@router.post("/api/v1/incidents/reports/legal-contact",
             response_model=schemas.IntakeAccepted, status_code=201)
def report_legal_contact(data: schemas.LegalContactIntake,
                         db: Session = Depends(get_db),
                         _guard: None = Depends(_intake_guard)) -> schemas.IntakeAccepted:
    row = service.submit_legal_contact(
        db, claimant=data.claimant, authority_ref=data.authority_ref,
        details=data.details, reporter_contact=data.reporter_contact)
    return schemas.IntakeAccepted(id=row.id, status=row.status, received_at=row.created_at)


@router.get("/api/v1/subprocessors", response_model=list[schemas.SubprocessorPublic])
def read_subprocessors(db: Session = Depends(get_db),
                       _guard: None = Depends(_intake_guard)) -> list[schemas.SubprocessorPublic]:
    """Public Trust Center feed: exactly F10 {name, purpose, location, status}."""
    return [schemas.SubprocessorPublic(**item) for item in service.public_subprocessors(db)]


# --- admin review --------------------------------------------------------------------


def _page(items, next_cursor: str | None) -> schemas.CaseListPage:
    return schemas.CaseListPage(
        items=[schemas.CaseListItem(
            id=r.id, title=getattr(r, "title", None) or getattr(r, "subject", None)
            or getattr(r, "claimant", ""),
            status=r.status, severity=getattr(r, "severity", None),
            created_at=r.created_at, updated_at=r.updated_at) for r in items],
        next_cursor=next_cursor)


@router.get("/api/admin/compliance/incidents", response_model=schemas.CaseListPage)
def admin_list_incidents(response: Response,
                         status: str | None = Query(default=None, max_length=32),
                         severity: str | None = Query(default=None, max_length=32),
                         limit: int = Query(default=50, ge=1, le=200),
                         cursor: str | None = None,
                         db: Session = Depends(get_db),
                         admin: User = Depends(platform_admin_required)) -> schemas.CaseListPage:
    items, next_cursor = service.list_incidents(
        db, admin.id, status=status, severity=severity, limit=limit, cursor=cursor)
    if next_cursor is not None:
        response.headers["X-Next-Cursor"] = next_cursor
    return _page(items, next_cursor)


@router.post("/api/admin/compliance/incidents",
             response_model=schemas.IncidentDetail, status_code=201)
def admin_create_incident(data: schemas.IncidentCreate,
                          db: Session = Depends(get_db),
                          admin: User = Depends(platform_admin_required),
                          ) -> schemas.IncidentDetail:
    return schemas.IncidentDetail.model_validate(
        service.create_incident(db, admin.id, title=data.title, kind=data.kind,
                                severity=data.severity, summary=data.summary),
        from_attributes=True)


@router.get("/api/admin/compliance/incidents/{incident_id}",
            response_model=schemas.IncidentDetail)
def admin_get_incident(incident_id: uuid.UUID,
                       db: Session = Depends(get_db),
                       admin: User = Depends(platform_admin_required),
                       ) -> schemas.IncidentDetail:
    return schemas.IncidentDetail.model_validate(
        service.get_incident(db, admin.id, incident_id), from_attributes=True)


@router.patch("/api/admin/compliance/incidents/{incident_id}",
              response_model=schemas.IncidentDetail)
def admin_patch_incident(incident_id: uuid.UUID, data: schemas.StatusPatch,
                         db: Session = Depends(get_db),
                         admin: User = Depends(platform_admin_required),
                         ) -> schemas.IncidentDetail:
    return schemas.IncidentDetail.model_validate(
        service.transition_incident(db, admin.id, incident_id, to_status=data.to,
                                    note=data.note, owner_admin_id=data.owner_admin_id),
        from_attributes=True)


@router.get("/api/admin/compliance/legal-requests", response_model=schemas.CaseListPage)
def admin_list_legal(response: Response,
                     status: str | None = Query(default=None, max_length=32),
                     limit: int = Query(default=50, ge=1, le=200),
                     cursor: str | None = None,
                     db: Session = Depends(get_db),
                     admin: User = Depends(platform_admin_required)) -> schemas.CaseListPage:
    items, next_cursor = service.list_legal_requests(
        db, admin.id, status=status, limit=limit, cursor=cursor)
    if next_cursor is not None:
        response.headers["X-Next-Cursor"] = next_cursor
    return _page(items, next_cursor)


@router.get("/api/admin/compliance/legal-requests/{request_id}",
            response_model=schemas.LegalDetail)
def admin_get_legal(request_id: uuid.UUID,
                    db: Session = Depends(get_db),
                    admin: User = Depends(platform_admin_required)) -> schemas.LegalDetail:
    return schemas.LegalDetail.model_validate(
        service.get_legal_request(db, admin.id, request_id), from_attributes=True)


@router.patch("/api/admin/compliance/legal-requests/{request_id}",
              response_model=schemas.LegalDetail)
def admin_patch_legal(request_id: uuid.UUID, data: schemas.StatusPatch,
                      db: Session = Depends(get_db),
                      admin: User = Depends(platform_admin_required)) -> schemas.LegalDetail:
    return schemas.LegalDetail.model_validate(
        service.transition_legal_request(db, admin.id, request_id, to_status=data.to,
                                         note=data.note,
                                         link_incident_id=data.link_incident_id),
        from_attributes=True)


@router.get("/api/admin/compliance/vuln-reports", response_model=schemas.CaseListPage)
def admin_list_vuln(response: Response,
                    status: str | None = Query(default=None, max_length=32),
                    severity: str | None = Query(default=None, max_length=32),
                    limit: int = Query(default=50, ge=1, le=200),
                    cursor: str | None = None,
                    db: Session = Depends(get_db),
                    admin: User = Depends(platform_admin_required)) -> schemas.CaseListPage:
    items, next_cursor = service.list_vuln_reports(
        db, admin.id, status=status, severity=severity, limit=limit, cursor=cursor)
    if next_cursor is not None:
        response.headers["X-Next-Cursor"] = next_cursor
    return _page(items, next_cursor)


@router.get("/api/admin/compliance/vuln-reports/{report_id}",
            response_model=schemas.VulnDetail)
def admin_get_vuln(report_id: uuid.UUID,
                   db: Session = Depends(get_db),
                   admin: User = Depends(platform_admin_required)) -> schemas.VulnDetail:
    return schemas.VulnDetail.model_validate(
        service.get_vuln_report(db, admin.id, report_id), from_attributes=True)


@router.patch("/api/admin/compliance/vuln-reports/{report_id}",
              response_model=schemas.VulnDetail)
def admin_patch_vuln(report_id: uuid.UUID, data: schemas.StatusPatch,
                     db: Session = Depends(get_db),
                     admin: User = Depends(platform_admin_required)) -> schemas.VulnDetail:
    return schemas.VulnDetail.model_validate(
        service.transition_vuln_report(db, admin.id, report_id, to_status=data.to,
                                       note=data.note,
                                       link_incident_id=data.link_incident_id),
        from_attributes=True)


@router.get("/api/admin/compliance/complaints", response_model=schemas.CaseListPage)
def admin_list_complaints(response: Response,
                          status: str | None = Query(default=None, max_length=32),
                          limit: int = Query(default=50, ge=1, le=200),
                          cursor: str | None = None,
                          db: Session = Depends(get_db),
                          admin: User = Depends(platform_admin_required),
                          ) -> schemas.CaseListPage:
    items, next_cursor = service.list_complaints(
        db, admin.id, status=status, limit=limit, cursor=cursor)
    if next_cursor is not None:
        response.headers["X-Next-Cursor"] = next_cursor
    return _page(items, next_cursor)


@router.get("/api/admin/compliance/complaints/{complaint_id}",
            response_model=schemas.ComplaintDetail)
def admin_get_complaint(complaint_id: uuid.UUID,
                        db: Session = Depends(get_db),
                        admin: User = Depends(platform_admin_required),
                        ) -> schemas.ComplaintDetail:
    return schemas.ComplaintDetail.model_validate(
        service.get_complaint(db, admin.id, complaint_id), from_attributes=True)


@router.patch("/api/admin/compliance/complaints/{complaint_id}",
              response_model=schemas.ComplaintDetail)
def admin_patch_complaint(complaint_id: uuid.UUID, data: schemas.StatusPatch,
                          db: Session = Depends(get_db),
                          admin: User = Depends(platform_admin_required),
                          ) -> schemas.ComplaintDetail:
    return schemas.ComplaintDetail.model_validate(
        service.transition_complaint(db, admin.id, complaint_id, to_status=data.to,
                                     note=data.note,
                                     link_incident_id=data.link_incident_id),
        from_attributes=True)


@router.get("/api/admin/compliance/abuse-reviews")
def admin_abuse_reviews(status: str | None = Query(default=None, max_length=32),
                        limit: int = Query(default=50, ge=1, le=200),
                        db: Session = Depends(get_db),
                        admin: User = Depends(platform_admin_required)) -> dict:
    """F7 read-only pass-through to Agent D's governance queue."""
    return service.get_abuse_review_queue(db, admin.id, status=status, limit=limit)


@router.get("/api/admin/compliance/subprocessors",
            response_model=list[schemas.SubprocessorAdminRead])
def admin_list_subprocessors(db: Session = Depends(get_db),
                             admin: User = Depends(platform_admin_required),
                             ) -> list[schemas.SubprocessorAdminRead]:
    return [schemas.SubprocessorAdminRead.model_validate(r, from_attributes=True)
            for r in service.list_subprocessors(db, admin.id)]


@router.post("/api/admin/compliance/subprocessors",
             response_model=schemas.SubprocessorAdminRead, status_code=201)
def admin_create_subprocessor(data: schemas.SubprocessorCreate,
                              db: Session = Depends(get_db),
                              admin: User = Depends(platform_admin_required),
                              ) -> schemas.SubprocessorAdminRead:
    return schemas.SubprocessorAdminRead.model_validate(
        service.create_subprocessor(db, admin.id, name=data.name, purpose=data.purpose,
                                   location=data.location, status=data.status,
                                   dpa_ref=data.dpa_ref),
        from_attributes=True)


@router.patch("/api/admin/compliance/subprocessors/{sub_id}",
              response_model=schemas.SubprocessorAdminRead)
def admin_patch_subprocessor(sub_id: uuid.UUID, data: schemas.SubprocessorUpdate,
                             db: Session = Depends(get_db),
                             admin: User = Depends(platform_admin_required),
                             ) -> schemas.SubprocessorAdminRead:
    return schemas.SubprocessorAdminRead.model_validate(
        service.update_subprocessor(db, admin.id, sub_id, purpose=data.purpose,
                                   location=data.location, status=data.status,
                                   dpa_ref=data.dpa_ref),
        from_attributes=True)


@router.delete("/api/admin/compliance/subprocessors/{sub_id}", status_code=204)
def admin_delete_subprocessor(sub_id: uuid.UUID,
                              db: Session = Depends(get_db),
                              admin: User = Depends(platform_admin_required)) -> None:
    service.delete_subprocessor(db, admin.id, sub_id)
