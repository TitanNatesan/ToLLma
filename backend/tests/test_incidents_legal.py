"""MODULE 5 legal requests: verification flow, dual approval, legal holds.

Same harness note as test_incidents_cases: local app mount until the
orchestrator wires `api.incidents.router` into main.py + migration.
"""

import uuid

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

import tollms.models.governance  # noqa: F401 (sibling metadata: create_all ordering)
import tollms.models.incidents  # noqa: F401 (metadata registration)
import tollms.models.security_audit  # noqa: F401 (sibling metadata: create_all ordering)
from tollms.api.incidents import router as incidents_module
from tollms.api.incidents import service
from tollms.core.deps import get_db
from tollms.core.exceptions import (
    ConflictError,
    NotFoundError,
    ValidationError,
    register_handlers,
)
from tollms.core.security import platform_admin_required
from tollms.models.user import PlatformRole, User


def _promote(db: Session, user_id: str) -> User:
    user = db.get(User, uuid.UUID(user_id))
    assert user is not None
    user.platform_role = PlatformRole.PLATFORM_ADMIN
    db.commit()
    db.refresh(user)
    return user


@pytest.fixture()
def admin_a(db: Session, client: TestClient, user_factory) -> User:
    return _promote(db, user_factory(email="legal-a@tollma.ai")["id"])


@pytest.fixture()
def admin_b(db: Session, client: TestClient, user_factory) -> User:
    return _promote(db, user_factory(email="legal-b@tollma.ai")["id"])


@pytest.fixture()
def admin_app(db: Session, admin_a: User):
    app = FastAPI()
    register_handlers(app)
    app.include_router(incidents_module.router)

    def _db():
        yield db

    async def _no_limit() -> None:
        return None

    async def _admin():
        return admin_a

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[incidents_module._intake_guard] = _no_limit
    app.dependency_overrides[platform_admin_required] = _admin
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


def _walk(db: Session, admin: User, row_id: uuid.UUID, *states: str):
    row = None
    for nxt in states:
        row = service.transition_legal_request(db, admin.id, row_id, to_status=nxt)
    return row


def test_verify_then_fulfill_by_different_admins(db: Session, admin_a: User,
                                                 admin_b: User) -> None:
    row = service.submit_legal_contact(db, claimant="County Court")
    row = _walk(db, admin_a, row.id, "verifying", "validated", "in_review")
    assert row.verified_by == admin_a.id
    row = service.transition_legal_request(db, admin_b.id, row.id, to_status="fulfilled")
    assert row.fulfilled_by == admin_b.id and row.status == "fulfilled"


def test_self_fulfillment_rejected(db: Session, admin_a: User) -> None:
    row = service.submit_legal_contact(db, claimant="Regulator")
    row = _walk(db, admin_a, row.id, "verifying", "validated", "in_review")
    with pytest.raises(ValidationError):
        service.transition_legal_request(db, admin_a.id, row.id, to_status="fulfilled")


def test_fulfill_without_validation_rejected(db: Session, admin_a: User,
                                             admin_b: User) -> None:
    row = service.submit_legal_contact(db, claimant="Claimant")
    _walk(db, admin_a, row.id, "verifying")
    # validating admin must differ from fulfilling admin only at fulfill time;
    # skipping validation entirely must fail regardless of who fulfills.
    row2 = service.get_legal_request(db, admin_a.id, row.id)
    assert row2.verified_by is None
    with pytest.raises(ValidationError):
        service.transition_legal_request(db, admin_b.id, row.id, to_status="in_review")


def test_illegal_skip_rejected(db: Session, admin_a: User) -> None:
    row = service.submit_legal_contact(db, claimant="Claimant")
    with pytest.raises(ValidationError):
        service.transition_legal_request(db, admin_a.id, row.id, to_status="fulfilled")


def test_hold_blocks_purge_until_closed(db: Session, admin_a: User,
                                        admin_b: User) -> None:
    row = service.submit_legal_contact(db, claimant="Court")
    assert row.hold_active is True
    with pytest.raises(ConflictError):
        service.assert_no_active_hold(db)
    _walk(db, admin_a, row.id, "verifying", "validated", "in_review")
    service.transition_legal_request(db, admin_b.id, row.id, to_status="fulfilled")
    with pytest.raises(ConflictError):
        service.assert_no_active_hold(db)  # fulfilled but not closed: hold stays
    service.transition_legal_request(db, admin_a.id, row.id, to_status="closed")
    service.assert_no_active_hold(db)  # closed releases the hold


def test_reject_path_closes_hold(db: Session, admin_a: User) -> None:
    row = service.submit_legal_contact(db, claimant="Bogus party")
    service.transition_legal_request(db, admin_a.id, row.id, to_status="verifying")
    service.transition_legal_request(db, admin_a.id, row.id, to_status="rejected",
                                      note="unverifiable authority")
    service.transition_legal_request(db, admin_a.id, row.id, to_status="closed")
    service.assert_no_active_hold(db)


def test_link_incident_requires_live_row(db: Session, admin_a: User) -> None:
    row = service.submit_legal_contact(db, claimant="Court")
    with pytest.raises(NotFoundError):
        service.transition_legal_request(db, admin_a.id, row.id, to_status="verifying",
                                         link_incident_id=uuid.uuid4())


def test_legal_http_roundtrip_hides_pii_from_list(admin_app: TestClient) -> None:
    r = admin_app.get("/api/admin/compliance/legal-requests")
    assert r.status_code == 200, r.text
    for item in r.json()["items"]:
        assert "reporter_contact" not in item and "verify_notes" not in item


def test_vuln_disclosure_stamps_and_links_incident(db: Session, admin_a: User) -> None:
    inc = service.create_incident(db, admin_a.id, title="RCE in renderer",
                                  kind="security", severity="sev1_critical")
    vuln = service.submit_vulnerability_report(db, title="RCE in renderer", details="poc details here")
    vuln = service.transition_vuln_report(db, admin_a.id, vuln.id, to_status="triaged")
    vuln = service.transition_vuln_report(db, admin_a.id, vuln.id, to_status="confirmed",
                                          link_incident_id=inc.id)
    assert vuln.related_incident_id == inc.id
    vuln = service.transition_vuln_report(db, admin_a.id, vuln.id, to_status="fixed")
    assert vuln.fixed_at is not None
    vuln = service.transition_vuln_report(db, admin_a.id, vuln.id, to_status="disclosed")
    assert vuln.coordinated_disclosure_at is not None
    with pytest.raises(ValidationError):
        service.transition_vuln_report(db, admin_a.id, vuln.id, to_status="fixed")


def test_complaint_escalation_links_incident(db: Session, admin_a: User) -> None:
    inc = service.create_incident(db, admin_a.id, title="Billing outage",
                                  kind="availability", severity="sev2_high")
    comp = service.submit_complaint(db, subject="Refund refused",
                                    details="Support refused a refund for the outage window.")
    comp = service.transition_complaint(db, admin_a.id, comp.id, to_status="under_review")
    comp = service.transition_complaint(db, admin_a.id, comp.id, to_status="escalated",
                                        link_incident_id=inc.id)
    assert comp.related_incident_id == inc.id
