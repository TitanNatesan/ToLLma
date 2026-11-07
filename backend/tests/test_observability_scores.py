"""Wave-3 observability scores tests (Agent 7 wave-1 scope A/B/E).

Covers POST/GET/DELETE /api/v1/scores: workspace scoping (personal vs org),
404-oracle subject resolution, same-(name, subject, day) rewrite, boolean
validation, and the Read-create / Manage-delete permission split.
"""

import uuid

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from tollms.models.api_key import ApiKey
from tollms.models.organization import Invitation
from tollms.models.prompt_logging import PromptLog
from tollms.models.scores import Score
from tollms.services.prompt_logging import capture as capture_engine

PL = "/api/v1/prompt-logs"
SC = "/api/v1/scores"
ORG = "/api/v1/orgs"


def _other(email: str) -> TestClient:
    from tollms.main import app

    c = TestClient(app)
    r = c.post("/auth/signup", json={"email": email, "password": "Password123", "age_confirmed": True})
    assert r.status_code == 200, r.text
    token = r.json().get("debug_verification_token")
    if token:
        c.get("/auth/verify", params={"token": token})
    return c


def _me(c: TestClient) -> dict:
    r = c.get("/auth/me")
    assert r.status_code == 200, r.text
    return r.json()


def _org(c: TestClient, name: str = "Score Org") -> str:
    r = c.post(ORG, json={"name": name})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _invite(root: TestClient, member: TestClient, db: Session, oid: str) -> None:
    inv = root.post(f"{ORG}/{oid}/invitations",
                    json={"email": _me(member)["email"], "set_ids": []})
    assert inv.status_code == 201, inv.text
    row = db.get(Invitation, uuid.UUID(inv.json()["id"]))
    db.refresh(row)
    acc = member.post(f"{ORG}/invitations/by-token/{row.token}/accept")
    assert acc.status_code == 200, acc.text


def _set(root: TestClient, oid: str, name: str, codes: list[str]) -> str:
    r = root.post(f"{ORG}/{oid}/sets", json={"name": name, "permissions": codes})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _assign(root: TestClient, oid: str, uid: str, sids: list[str]) -> None:
    r = root.post(f"{ORG}/{oid}/members/{uid}/sets", json={"set_ids": sids})
    assert r.status_code == 200, r.text


def _mk_key(db: Session, owner_id: uuid.UUID, org_id=None) -> ApiKey:
    key = ApiKey(user_id=owner_id, org_id=org_id, name=f"sk-{uuid.uuid4().hex[:6]}",
                 key_prefix=f"p-{uuid.uuid4().hex[:8]}",
                 key_hash=uuid.uuid4().hex * 2)
    db.add(key)
    db.flush()
    return key


def _enable_personal(c: TestClient) -> None:
    r = c.put(f"{PL}/settings", json={"enabled": True, "mode": "global",
                                      "capture_input": True, "capture_output": True})
    assert r.status_code == 200, r.text


def _seed_personal_trace(c: TestClient, db: Session, user: dict, trace: str) -> str:
    _enable_personal(c)
    row = capture_engine.capture_post(
        db, input_text="in", output_text="out",
        user_id=uuid.UUID(user["id"]), endpoint="chat", source="internal",
        request_id=f"req-{trace}", trace_id=trace, status="completed")
    assert row is not None
    return trace


def _seed_org_trace(c: TestClient, db: Session, user: dict, oid: str, trace: str) -> str:
    r = c.put(f"{PL}/settings", json={"org_id": oid, "enabled": True, "mode": "global",
                                      "capture_input": True, "capture_output": True})
    assert r.status_code == 200, r.text
    uid = uuid.UUID(user["id"])
    key = _mk_key(db, uid, uuid.UUID(oid))
    db.commit()
    row = capture_engine.capture_post(
        db, input_text="org-in", output_text="org-out", user_id=uid,
        org_id=uuid.UUID(oid), api_key_id=key.id, key_provenance="organization",
        endpoint="chat_completions", source="external",
        request_id=f"req-{trace}", trace_id=trace, status="completed")
    assert row is not None
    return trace


def _score_body(trace=None, log_id=None, **kw) -> dict:
    body = {"name": "quality", "data_type": "numeric", "value_num": 0.9}
    if trace is not None:
        body["trace_id"] = trace
    if log_id is not None:
        body["prompt_log_id"] = log_id
    body.update(kw)
    return body


# --- personal CRUD ------------------------------------------------------------


def test_personal_create_list_delete(client: TestClient, db: Session, user_factory) -> None:
    user = user_factory()
    trace = _seed_personal_trace(client, db, user, "T-personal-1")

    r = client.post(SC, json=_score_body(trace=trace, comment="good"))
    assert r.status_code == 200, r.text
    sid = r.json()["id"]
    assert r.json()["comment"] == "good" and r.json()["org_id"] is None

    listed = client.get(SC, params={"trace_id": trace}).json()["items"]
    assert [s["id"] for s in listed] == [sid]

    assert client.delete(f"{SC}/{sid}").status_code == 204
    assert client.get(SC, params={"trace_id": trace}).json()["items"] == []
    assert client.delete(f"{SC}/{sid}").status_code == 404  # already gone: oracle


def test_create_validation(client: TestClient, db: Session, user_factory) -> None:
    user = user_factory()
    _seed_personal_trace(client, db, user, "T-valid-1")

    no_subject = {"name": "q", "data_type": "numeric", "value_num": 1}
    assert client.post(SC, json=no_subject).status_code == 422
    no_value = {"name": "q", "data_type": "numeric", "trace_id": "T-valid-1"}
    assert client.post(SC, json=no_value).status_code == 422
    unknown_trace = _score_body(trace="T-nope-missing")
    assert client.post(SC, json=unknown_trace).status_code == 404
    unknown_log = _score_body(log_id=str(uuid.uuid4()))
    assert client.post(SC, json=unknown_log).status_code == 404
    bad_type = _score_body(trace="T-valid-1", data_type="stars")
    assert client.post(SC, json=bad_type).status_code == 422


def test_boolean_validation(client: TestClient, db: Session, user_factory) -> None:
    user = user_factory()
    _seed_personal_trace(client, db, user, "T-bool-1")

    bad_text = _score_body(trace="T-bool-1", data_type="boolean", value_num=None,
                           value_text="maybe")
    del bad_text["value_num"]
    assert client.post(SC, json=bad_text).status_code == 422
    bad_num = _score_body(trace="T-bool-1", data_type="boolean", value_num=2)
    assert client.post(SC, json=bad_num).status_code == 422
    ok = _score_body(trace="T-bool-1", data_type="boolean", value_num=None,
                     value_text="true")
    del ok["value_num"]
    r = client.post(SC, json=ok)
    assert r.status_code == 200, r.text
    assert r.json()["value_text"] == "true"


def test_same_name_day_rewrite(client: TestClient, db: Session, user_factory) -> None:
    user = user_factory()
    trace = _seed_personal_trace(client, db, user, "T-rewrite-1")

    first = client.post(SC, json=_score_body(trace=trace, value_num=0.2))
    assert first.status_code == 200, first.text
    second = client.post(SC, json=_score_body(trace=trace, value_num=0.8,
                                              comment="revised"))
    assert second.status_code == 200, second.text
    assert second.json()["id"] == first.json()["id"]  # rewrite, not a new row
    assert second.json()["value_num"] == "0.80000000" or float(second.json()["value_num"]) == 0.8
    rows = db.scalars(select(Score).where(Score.trace_id == trace)).all()
    assert len(rows) == 1 and str(rows[0].value_num) == "0.80000000"


def test_personal_subject_cross_user_oracle(client: TestClient, db: Session, user_factory) -> None:
    user = user_factory()
    trace = _seed_personal_trace(client, db, user, "T-priv-1")
    row_id = str(db.scalar(select(PromptLog.id).where(PromptLog.trace_id == trace)))

    stranger = _other("score-stranger@tollma.ai")
    # Stranger's workspace holds no such subject: 404, never the value.
    assert stranger.post(SC, json=_score_body(trace=trace)).status_code == 404
    assert stranger.post(SC, json=_score_body(log_id=row_id)).status_code == 404
    assert stranger.get(SC, params={"trace_id": trace}).json()["items"] == []


def test_session_key_and_name_filters(client: TestClient, db: Session, user_factory) -> None:
    user = user_factory()
    trace = _seed_personal_trace(client, db, user, "T-sess-1")
    for name, sk in (("q-a", "sess-1"), ("q-b", "sess-1"), ("q-a", "sess-2")):
        r = client.post(SC, json=_score_body(trace=trace, name=name, session_key=sk))
        assert r.status_code == 200, r.text

    # Same (name, subject, day) is one judgment: the third POST rewrites q-a
    # (session sess-1 -> sess-2) instead of inserting a duplicate row.
    got = client.get(SC, params={"session_key": "sess-1"}).json()["items"]
    assert {s["name"] for s in got} == {"q-b"}
    got = client.get(SC, params={"session_key": "sess-2"}).json()["items"]
    assert {s["name"] for s in got} == {"q-a"}
    got = client.get(SC, params={"name": "q-a"}).json()["items"]
    assert len(got) == 1 and got[0]["session_key"] == "sess-2"
    assert client.get(SC, params={"session_key": "sess-nope"}).json()["items"] == []


# --- org gates ----------------------------------------------------------------


def _org_roster(client: TestClient, db: Session, codes: list[str]):
    member = _other(f"sc-{uuid.uuid4().hex[:8]}@tollma.ai")
    oid = _org(client)
    _invite(client, member, db, oid)
    if codes:
        _assign(client, oid, _me(member)["id"], [_set(client, oid, "Set", codes)])
    return member, oid


def test_org_read_create_list_manage_delete(client: TestClient, db: Session, user_factory) -> None:
    root = user_factory()
    member, oid = _org_roster(client, db, ["PromptLogs.Read"])
    trace = _seed_org_trace(client, db, root, oid, "T-org-1")

    # Read-only member: no rows yet, create allowed, delete denied.
    assert member.get(SC, params={"org_id": oid}).json()["items"] == []
    r = member.post(SC, params={"org_id": oid}, json=_score_body(trace=trace))
    assert r.status_code == 200, r.text
    sid = r.json()["id"]
    assert r.json()["org_id"] == oid
    assert member.delete(f"{SC}/{sid}", params={"org_id": oid}).status_code == 404

    # Root sees the member's org score; Manage-holder can delete it.
    assert any(s["id"] == sid for s in
               client.get(SC, params={"org_id": oid}).json()["items"])
    _assign(client, oid, _me(member)["id"],
            [_set(client, oid, "Mgr", ["PromptLogs.Read", "PromptLogs.Manage"])])
    assert member.delete(f"{SC}/{sid}", params={"org_id": oid}).status_code == 204
    assert member.delete(f"{SC}/{sid}", params={"org_id": oid}).status_code == 404


def test_org_member_without_perms_denied(client: TestClient, db: Session, user_factory) -> None:
    root = user_factory()
    member, oid = _org_roster(client, db, [])
    trace = _seed_org_trace(client, db, root, oid, "T-org-deny")

    assert member.post(SC, params={"org_id": oid},
                       json=_score_body(trace=trace)).status_code == 404
    assert member.get(SC, params={"org_id": oid}).status_code == 404


def test_cross_org_score_idor(client: TestClient, db: Session, user_factory) -> None:
    """A5: org_a score invisible from org_b; cross-org create/delete are 404."""
    root = user_factory()
    oid_a = _org(client, "Score A")
    member = _other("sc-xorg@tollma.ai")
    oid_b = _org(member, "Score B")
    _invite(client, member, db, oid_a)
    _assign(client, oid_a, _me(member)["id"],
            [_set(client, oid_a, "Read", ["PromptLogs.Read"])])
    trace_a = _seed_org_trace(client, db, root, oid_a, "T-xorg-a")

    # Member scoped to org_b: org_a subject does not resolve, no leak.
    assert member.post(SC, params={"org_id": oid_b},
                       json=_score_body(trace=trace_a)).status_code == 404
    assert member.get(SC, params={"org_id": oid_b,
                                  "trace_id": trace_a}).json()["items"] == []

    # Org_a score created by root; member cannot delete it via org_b scope.
    created = client.post(SC, params={"org_id": oid_a}, json=_score_body(trace=trace_a))
    assert created.status_code == 200, created.text
    sid = created.json()["id"]
    assert member.delete(f"{SC}/{sid}", params={"org_id": oid_b}).status_code == 404
    # Still present under org_a.
    assert any(s["id"] == sid for s in
               member.get(SC, params={"org_id": oid_a}).json()["items"])

    # Stranger (no membership): 404 oracle on org_a surfaces, no values.
    stranger = _other("sc-stranger2@tollma.ai")
    assert stranger.post(SC, params={"org_id": oid_a},
                         json=_score_body(trace=trace_a)).status_code == 404
    assert stranger.get(SC, params={"org_id": oid_a}).status_code == 404


def test_personal_scores_never_in_org_listing(client: TestClient, db: Session, user_factory) -> None:
    user = user_factory()
    trace = _seed_personal_trace(client, db, user, "T-mix-1")
    oid = _org(client, "Score Mix")
    r = client.post(SC, json=_score_body(trace=trace, name="personal-only"))
    assert r.status_code == 200, r.text

    org_items = client.get(SC, params={"org_id": oid}).json()["items"]
    assert all(s["name"] != "personal-only" for s in org_items)
