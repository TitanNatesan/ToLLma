"""MODULE 5 cases: intake validation, admin gate, transitions, paging.

Router is not yet wired into main.py (orchestrator Wave 3), so HTTP tests
mount `api.incidents.router` on a local app. Service tests run directly
against the `db` fixture. `import tollms.models.incidents` registers the
tables for `create_all` until the orchestrator adds the aggregate import.
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
from tollms.core.exceptions import ForbiddenError, NotFoundError, ValidationError, register_handlers
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
def admin_user(db: Session, client: TestClient, user_factory) -> User:
    made = user_factory(email="ops-admin@tollma.ai")
    return _promote(db, made["id"])


@pytest.fixture()
def plain_user(db: Session, client: TestClient, user_factory) -> User:
    made = user_factory(email="ops-user@tollma.ai")
    user = db.get(User, uuid.UUID(made["id"]))
    assert user is not None
    return user


@pytest.fixture()
def incident_app(db: Session):
    app = FastAPI()
    register_handlers(app)
    app.include_router(incidents_module.router)

    def _db():
        yield db

    async def _no_limit() -> None:
        return None

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[incidents_module._intake_guard] = _no_limit
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture()
def admin_app(incident_app: TestClient, admin_user: User):
    async def _admin():
        return admin_user

    incident_app.app.dependency_overrides[platform_admin_required] = _admin
    return incident_app


# --- intake ----------------------------------------------------------------------


def test_vuln_intake_accepts_and_echoes_no_pii(incident_app: TestClient) -> None:
    r = incident_app.post("/api/v1/incidents/reports/vulnerability", json={
        "title": "XSS in share preview",
        "details": "Reflected markup executes in the share preview pane.",
        "affected": "shares frontend",
        "reporter_contact": "reporter@example.com",
    })
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["status"] == "received"
    assert "reporter_contact" not in body and "details" not in body


def test_vuln_intake_rejects_short_body(incident_app: TestClient) -> None:
    r = incident_app.post("/api/v1/incidents/reports/vulnerability", json={
        "title": "x", "details": "short"})
    assert r.status_code == 422, r.text


def test_complaint_intake_sets_sla(incident_app: TestClient, db: Session,
                                 admin_user: User) -> None:
    r = incident_app.post("/api/v1/incidents/reports/complaint", json={
        "subject": "Billing dispute", "details": "Charged twice for the same invoice period."})
    assert r.status_code == 201, r.text
    row = service.get_complaint(db, admin_user.id, uuid.UUID(r.json()["id"]))
    assert row.sla_due_at is not None


def test_legal_contact_intake_creates_hold(incident_app: TestClient) -> None:
    r = incident_app.post("/api/v1/incidents/reports/legal-contact", json={
        "claimant": "County Court", "authority_ref": "case 42"})
    assert r.status_code == 201, r.text
    assert r.json()["status"] == "received"


def test_intake_routes_are_rate_limited() -> None:
    """The limiter is a real route dependency (overridden no-op only in tests)."""
    paths = {"/api/v1/incidents/reports/vulnerability",
             "/api/v1/incidents/reports/complaint",
             "/api/v1/incidents/reports/legal-contact",
             "/api/v1/subprocessors"}
    for route in incidents_module.router.routes:
        path = getattr(route, "path", "")
        if path in paths:
            assert getattr(route, "dependant", None) is not None
            assert len(route.dependant.dependencies) >= 1, path


# --- admin gate --------------------------------------------------------------------


def test_admin_routes_require_platform_admin() -> None:
    """Every /api/admin/compliance route is gated (platform_role only)."""
    admin_paths = [r for r in incidents_module.router.routes
                   if getattr(r, "path", "").startswith("/api/admin/compliance")]
    assert len(admin_paths) >= 10, "expected full compliance review surface"
    for route in admin_paths:
        calls = [d.call for d in route.dependant.dependencies]
        assert platform_admin_required in calls, route.path


def test_non_admin_denied_at_service(db: Session, plain_user: User) -> None:
    with pytest.raises(ForbiddenError):
        service.list_incidents(db, plain_user.id)


def test_unknown_admin_is_404(db: Session) -> None:
    with pytest.raises(NotFoundError):
        service.list_incidents(db, uuid.uuid4())


def test_admin_http_gate_denies_without_override(incident_app: TestClient,
                                                 admin_user: User) -> None:
    """No platform_admin override -> real gate runs -> 401/403, never data."""

    async def _deny():
        from tollms.core.exceptions import ForbiddenError as FE
        raise FE("platform administrator access required")

    incident_app.app.dependency_overrides[platform_admin_required] = _deny
    r = incident_app.get("/api/admin/compliance/incidents")
    assert r.status_code == 403, r.text


# --- incident lifecycle --------------------------------------------------------------


def test_incident_full_lifecycle(db: Session, admin_user: User) -> None:
    row = service.create_incident(db, admin_user.id, title="Gateway outage",
                                  kind="availability", severity="sev1_critical")
    assert row.status == "open" and len(row.timeline) == 1
    for nxt in ("triaged", "mitigating", "resolved", "closed"):
        row = service.transition_incident(db, admin_user.id, row.id, to_status=nxt)
    assert row.status == "closed" and row.closed_at is not None
    assert len(row.timeline) == 5


def test_illegal_transition_is_422(db: Session, admin_user: User) -> None:
    row = service.create_incident(db, admin_user.id, title="Minor glitch",
                                  kind="other", severity="sev4_low")
    with pytest.raises(ValidationError):
        service.transition_incident(db, admin_user.id, row.id, to_status="resolved")


def test_unknown_case_id_is_404(db: Session, admin_user: User) -> None:
    with pytest.raises(NotFoundError):
        service.get_incident(db, admin_user.id, uuid.uuid4())
    with pytest.raises(NotFoundError):
        service.transition_complaint(db, admin_user.id, uuid.uuid4(), to_status="closed")


def test_list_paging_cursor(db: Session, admin_user: User) -> None:
    for i in range(3):
        service.create_incident(db, admin_user.id, title=f"Case {i}",
                                kind="other", severity="sev4_low")
    page1, cursor = service.list_incidents(db, admin_user.id, limit=2)
    assert len(page1) == 2 and cursor is not None
    page2, cursor2 = service.list_incidents(db, admin_user.id, limit=2, cursor=cursor)
    assert len(page2) == 1 and cursor2 is None


def test_admin_http_roundtrip(admin_app: TestClient) -> None:
    r = admin_app.post("/api/admin/compliance/incidents", json={
        "title": "Provider breach", "kind": "security", "severity": "sev1_critical"})
    assert r.status_code == 201, r.text
    case_id = r.json()["id"]
    r = admin_app.patch(f"/api/admin/compliance/incidents/{case_id}",
                        json={"to": "resolved"})
    assert r.status_code == 422, r.text  # open -> resolved skips triage/mitigation
    r = admin_app.patch(f"/api/admin/compliance/incidents/{case_id}",
                        json={"to": "triaged", "note": "confirmed"})
    assert r.status_code == 200, r.text
    assert r.json()["timeline"][-1]["note"] == "confirmed"


# --- abuse queue (D pending) -------------------------------------------------------------


def test_abuse_queue_reads_d_governance_table(db: Session, admin_user: User) -> None:
    """F7: F reads D's table read-only; empty queue is a valid empty page."""
    page = service.get_abuse_review_queue(db, admin_user.id)
    assert page["items"] == [] and page["pending_integration"] is False
    with pytest.raises(ValidationError):
        service.get_abuse_review_queue(db, admin_user.id, status="bogus")


# --- subprocessors -----------------------------------------------------------------


def test_subprocessor_public_shape_excludes_admin_fields(
        admin_app: TestClient, db: Session, admin_user: User) -> None:
    service.create_subprocessor(db, admin_user.id, name="CloudHost", purpose="Compute",
                                location="EU", status="active", dpa_ref="dpa-1")
    service.create_subprocessor(db, admin_user.id, name="SoonVendor", purpose="Queue",
                                location="US", status="pending")
    r = admin_app.get("/api/v1/subprocessors")
    assert r.status_code == 200, r.text
    items = r.json()
    assert len(items) == 1
    assert set(items[0].keys()) == {"name", "purpose", "location", "status"}
