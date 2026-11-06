"""DSR workflow (F5): submit/list/get, transition validation, terminal
immutability, SLA, cross-user 404. Plus export shape and erasure scheduling."""

import uuid
from datetime import datetime, timedelta, timezone

import tollms.models.privacy  # noqa: F401 — register tables before create_all
from tollms.models.conversation import Conversation
from tollms.models.message import Message, MessageStatus, Role
from tests.test_privacy_helpers import privacy_client


def _uid(user: dict) -> uuid.UUID:
    return uuid.UUID(user["id"])


def _submit(pc, dtype="access", detail=None):
    payload = {"type": dtype}
    if detail:
        payload["detail"] = detail
    return pc.post("/api/v1/privacy/dsr", json=payload)


def test_submit_sets_sla_and_audit_event(client, db, user_factory):
    user = user_factory("d-submit@tollma.ai")
    pc = privacy_client(db, _uid(user))
    before = datetime.now(timezone.utc)
    r = _submit(pc, "access")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "submitted"
    due = datetime.fromisoformat(body["due_at"])
    assert timedelta(days=29) < due - before < timedelta(days=31)
    assert len(body["events"]) == 1
    assert body["events"][0]["to_status"] == "submitted"


def test_invalid_type_422(client, db, user_factory):
    user = user_factory("d-bad@tollma.ai")
    assert _submit(privacy_client(db, _uid(user)), "delete_everything").status_code == 422


def test_full_lifecycle_to_fulfilled(client, db, user_factory):
    user = user_factory("d-life@tollma.ai")
    pc = privacy_client(db, _uid(user))
    dsr_id = _submit(pc, "erasure").json()["id"]
    for nxt in ("under_review", "in_progress", "fulfilled"):
        r = pc.patch(f"/api/v1/privacy/dsr/{dsr_id}", json={"to_status": nxt})
        assert r.status_code == 200, r.text
        assert r.json()["status"] == nxt
    body = pc.get(f"/api/v1/privacy/dsr/{dsr_id}").json()
    assert body["fulfilled_at"] is not None
    assert [e["to_status"] for e in body["events"]] == [
        "submitted",
        "under_review",
        "in_progress",
        "fulfilled",
    ]


def test_illegal_transition_422(client, db, user_factory):
    user = user_factory("d-ill@tollma.ai")
    pc = privacy_client(db, _uid(user))
    dsr_id = _submit(pc, "access").json()["id"]
    # submitted -> fulfilled skips two states.
    r = pc.patch(f"/api/v1/privacy/dsr/{dsr_id}", json={"to_status": "fulfilled"})
    assert r.status_code == 422, r.text
    # submitted -> in_progress skips under_review.
    assert pc.patch(f"/api/v1/privacy/dsr/{dsr_id}", json={"to_status": "in_progress"}).status_code == 422


def test_terminal_states_immutable(client, db, user_factory):
    user = user_factory("d-term@tollma.ai")
    pc = privacy_client(db, _uid(user))
    dsr_id = _submit(pc, "portability").json()["id"]
    pc.patch(f"/api/v1/privacy/dsr/{dsr_id}", json={"to_status": "under_review"})
    pc.patch(f"/api/v1/privacy/dsr/{dsr_id}", json={"to_status": "in_progress"})
    pc.patch(
        f"/api/v1/privacy/dsr/{dsr_id}",
        json={"to_status": "partially_fulfilled", "reason_code": "partial_scope"},
    )
    locked = pc.patch(f"/api/v1/privacy/dsr/{dsr_id}", json={"to_status": "fulfilled"})
    assert locked.status_code == 422, locked.text
    assert "closed" in locked.json()["error"]["message"]


def test_rejection_requires_reason_code(client, db, user_factory):
    user = user_factory("d-rej@tollma.ai")
    pc = privacy_client(db, _uid(user))
    dsr_id = _submit(pc, "grievance", detail="billing dispute").json()["id"]
    bare = pc.patch(f"/api/v1/privacy/dsr/{dsr_id}", json={"to_status": "rejected"})
    assert bare.status_code == 422, bare.text
    ok = pc.patch(
        f"/api/v1/privacy/dsr/{dsr_id}",
        json={"to_status": "rejected", "reason_code": "out_of_scope"},
    )
    assert ok.status_code == 200, ok.text
    assert ok.json()["reason_code"] == "out_of_scope"


def test_cross_user_dsr_404(client, db, user_factory):
    a = user_factory("d-a@tollma.ai")
    b = user_factory("d-b@tollma.ai")
    dsr_id = _submit(privacy_client(db, _uid(a)), "access").json()["id"]
    bpc = privacy_client(db, _uid(b))
    assert bpc.get(f"/api/v1/privacy/dsr/{dsr_id}").status_code == 404
    assert bpc.patch(f"/api/v1/privacy/dsr/{dsr_id}", json={"to_status": "rejected",
        "reason_code": "x"}).status_code == 404
    assert all(x["id"] != dsr_id for x in bpc.get("/api/v1/privacy/dsr").json())


def test_export_shape_and_no_secrets(client, db, user_factory):
    user = user_factory("d-exp@tollma.ai")
    uid = _uid(user)
    db.add(Conversation(id=uuid.uuid4(), user_id=uid, title="Export me"))
    db.commit()
    conv = db.query(Conversation).filter_by(user_id=uid).one()
    db.add(
        Message(
            user_id=uid,
            conversation_id=conv.id,
            role=Role.USER,
            content="hello export",
            status=MessageStatus.COMPLETED,
        )
    )
    db.commit()
    pc = privacy_client(db, uid)
    pc.put("/api/v1/privacy/consents", json={"category": "analytics", "granted": True})
    _submit(pc, "portability")
    r = pc.get("/api/v1/privacy/export")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["profile"]["email"] == user["email"]
    assert body["conversations"][0]["messages"][0]["content"] == "hello export"
    assert body["consents"][0]["category"] == "analytics"
    assert body["dsr_requests"][0]["type"] == "portability"
    dumped = r.text.lower()
    for secret in ("password_hash", "credentials_encrypted", "key_hash", "token_hash",
                   "input_cipher", "output_cipher", "share_token", "storage_path"):
        assert secret not in dumped, secret


def test_export_empty_account(client, db, user_factory):
    user = user_factory("d-empty@tollma.ai")
    r = privacy_client(db, _uid(user)).get("/api/v1/privacy/export")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["profile"]["email"] == user["email"]
    assert body["conversations"] == [] and body["consents"] == []


def test_erasure_schedules_deletion_grace(client, db, user_factory):
    user = user_factory("d-erase@tollma.ai")
    pc = privacy_client(db, _uid(user))
    r = pc.post("/api/v1/privacy/erasure", json={"current_password": "Password123"})
    assert r.status_code == 200, r.text
    assert r.json()["days_remaining"] == 15
    # Idempotent re-request while pending (no re-auth needed).
    again = pc.post("/api/v1/privacy/erasure", json={})
    assert again.status_code == 200, again.text
    assert again.json()["scheduled_for"] == r.json()["scheduled_for"]
    # Wrong password on a fresh account is 401, nothing scheduled.
    other = user_factory("d-erase2@tollma.ai")
    opc = privacy_client(db, _uid(other))
    denied = opc.post("/api/v1/privacy/erasure", json={"current_password": "nope"})
    assert denied.status_code == 401, denied.text
