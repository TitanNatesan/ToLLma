"""API-key lifecycle + IP-restriction audit matrix (Subagent B: SSS 5, 6, 11-part, 13).

Locks the REAL implementation (read first, then tested - no invented rules):

* Lifecycle: `services.api_keys.keys.generate_key` -> `tma_sk_live_` + 48 hex
  chars; only SHA-256 `key_hash` + 20-char `key_prefix` persist. Raw shown
  once (`KeyCreated.raw_key`), never re-returned, never in list/get/detail.
* AuthN (public `api_key_required`): missing/invalid -> 401 UNAUTHENTICATED;
  unknown-key class (random/truncated/prefix-only/revoked/deleted) is
  INDISTINGUISHABLE ("invalid API key"); disabled/expired/owner-blocked/IP ->
  403 with distinct reasons; in-app chat uses a 404 oracle instead.
* IP (`services/gateway/key_policy.ip_allowed`): no rules = open; missing /
  unparseable client IP with rules = fail-closed deny; DENY wins over allow;
  same-CIDR allow+deny rejected at validation (deny would silently win).
* Client IP (`core.sessions.gateway_client_ip`): X-Forwarded-For honored ONLY
  behind a trusted direct peer (loopback/private/`TRUSTED_PROXIES`); leftmost
  entry wins; `X-Real-IP`/`Forwarded` NEVER read; empty peer never elects XFF.
* Revocation: delete/rotate write a tombstone + invalidate the 30s compiled-
  context cache, so a revoked hash stops working immediately (no stale-cache
  hole); owner-status verdicts ride the cached context (<=30s lag documented).

Probes use GET /v1/models (auth-only, zero provider I/O) plus POST
/v1/chat/completions behind a MOCK upstream adapter (no network). Serial-safe.
"""

import json
import logging
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from tollms.api.keys import service as key_service
from tollms.api.public_gateway import service as pg_service
from tollms.core import sessions as session_mod
from tollms.main import app
from tollms.models.api_key import ApiKey, ApiKeyPolicy, ApiRequestLog
from tollms.services.api_keys import keys as key_engine
from tollms.services.api_keys.keys import KeyContext, KeyPolicy
from tollms.services.gateway import key_policy, limits
from tollms.services.gateway.adapters.base import ChatResult, StreamChunk

ORG = "/api/v1/orgs"
MODELS_PROBE = "/v1/models"


# --- helpers --------------------------------------------------------------


def _create(client: TestClient, **overrides) -> dict:
    payload = {"name": "Audit key", **overrides}
    r = client.post("/api/v1/keys", json=payload)
    assert r.status_code == 201, r.text
    return r.json()


def _raw(custom: TestClient, **overrides) -> tuple[str, str]:
    body = _create(custom, **overrides)
    return body["raw_key"], body["key"]["id"]


def _auth(raw: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {raw}"}


def _xkey(raw: str) -> dict[str, str]:
    return {"x-api-key": raw}


def _ref(provider: dict, model_id: str = "mock-model") -> str:
    return f"{provider['name']}/{model_id}"


def _chat_body(provider: dict, text: str = "hi") -> dict:
    return {"model": _ref(provider), "messages": [{"role": "user", "content": text}]}


def _pg_rows(db: Session, kid: str) -> list[ApiRequestLog]:
    return list(
        db.scalars(select(ApiRequestLog).where(ApiRequestLog.api_key_id == uuid.UUID(kid))))


def _expire_key(db: Session, raw: str, kid: str) -> None:
    """Age a key out of band (PATCH rejects past expiries): mirrors time passing."""
    db.execute(ApiKey.__table__.update().where(ApiKey.id == uuid.UUID(kid)).values(
        expires_at=datetime.now(timezone.utc) - timedelta(days=1)))
    db.commit()
    key_engine.invalidate_context(key_engine.hash_key(raw))


def _events(caplog: pytest.LogCaptureFixture, name: str) -> list[dict]:
    out = []
    for record in caplog.records:
        if record.name != "tollms.events":
            continue
        try:
            payload = json.loads(record.getMessage())
        except (ValueError, TypeError):
            continue
        if payload.get("event") == name:
            out.append(payload)
    return out


@pytest.fixture()
def _cap_events(caplog: pytest.LogCaptureFixture):
    caplog.set_level(logging.INFO, logger="tollms.events")
    return caplog


class _FakePublicAdapter:
    """Mock upstream: replays fixed usage, records calls. No network."""

    def __init__(self, calls: list) -> None:
        self._calls = calls

    async def chat(self, messages):
        self._calls.append(("chat", list(messages)))
        return ChatResult(text="Hello world", prompt_tokens=10, completion_tokens=5, total_tokens=15)

    async def chat_stream(self, messages):
        self._calls.append(("stream", list(messages)))
        yield StreamChunk(delta="Hello")
        yield StreamChunk(delta=" world", prompt_tokens=10, completion_tokens=5, total_tokens=15)


def _bind_public(monkeypatch: pytest.MonkeyPatch, adapter: _FakePublicAdapter) -> list:
    calls: list = adapter._calls
    monkeypatch.setattr(pg_service, "build_adapter", lambda *a, **k: adapter)
    return calls


def _mkuser(tag: str) -> TestClient:
    c = TestClient(app)
    r = c.post("/auth/signup", json={
        "email": f"auditkeys-{tag}-{uuid.uuid4().hex[:8]}@tollma.ai",
        "password": "Password123", "age_confirmed": True})
    assert r.status_code == 200, r.text
    token = r.json().get("debug_verification_token")
    if token:
        assert c.get("/auth/verify", params={"token": token}).status_code == 200
    return c


def _member_set_id(c: TestClient, oid: str) -> str:
    sets = c.get(f"{ORG}/{oid}/sets").json()
    return next(s["id"] for s in sets if s["name"] == "Member")


def _invite_and_accept(owner: TestClient, member: TestClient, db: Session, oid: str) -> str:
    from tollms.models.organization import Invitation

    email = member.get("/auth/me").json()["email"]
    inv = owner.post(f"{ORG}/{oid}/invitations",
                     json={"email": email, "set_ids": [_member_set_id(owner, oid)]})
    assert inv.status_code == 201, inv.text
    token = db.get(Invitation, uuid.UUID(inv.json()["id"])).token
    assert member.post(f"{ORG}/invitations/by-token/{token}/accept").status_code == 200
    return member.get("/auth/me").json()["id"]


# --- lifecycle: create / shape / uniqueness / storage ---------------------


def test_lifecycle_create_shape_unique_and_hash_stored(
    client: TestClient, db: Session, user_factory
) -> None:
    user_factory()
    raws, ids, prefixes, hashes = [], [], [], []
    for name in ("K1", "K2", "K3"):
        raw, kid = _raw(client, name=name)
        raws.append(raw)
        ids.append(kid)
        row = db.scalar(select(ApiKey).where(ApiKey.id == uuid.UUID(kid)))
        assert row is not None
        prefixes.append(row.key_prefix)
        hashes.append(row.key_hash)
        assert raw.startswith("tma_sk_live_") and len(raw) == len("tma_sk_live_") + 48
        assert row.key_prefix == raw[:20]
        assert row.key_hash == key_engine.hash_key(raw) != raw
        assert raw not in (row.key_hash or "")
    assert len(set(raws)) == 3 and len(set(ids)) == 3
    assert len(set(prefixes)) == 3 and len(set(hashes)) == 3


def test_lifecycle_listing_metadata_and_defaults(
    client: TestClient, db: Session, user_factory
) -> None:
    user = user_factory()
    uid = uuid.UUID(user["id"])
    raw, kid = _raw(client, name="Meta", description="spend key",
                    policy={"rpm": 60, "max_budget_usd": "5"})
    listed = client.get("/api/v1/keys").json()
    assert raw not in json.dumps(listed) and "key_hash" not in json.dumps(listed)
    detail = client.get(f"/api/v1/keys/{kid}").json()
    assert detail["description"] == "spend key"
    assert detail["policy"]["rpm"] == 60
    assert Decimal(detail["policy"]["max_budget_usd"]) == Decimal("5")
    assert detail["rotation_count"] == 0 and detail["enabled"] is True
    assert detail["is_primary"] is False  # signup primary owns that slot
    assert detail["is_default"] is True  # newest personal key takes the default slot
    assert detail["masked"] == f"{raw[:16]}…"
    row = db.scalar(select(ApiKey).where(ApiKey.id == uuid.UUID(kid)))
    assert row is not None and row.org_id is None and row.user_id == uid
    assert row.last_used_at is None


def test_lifecycle_duplicate_personal_names_allowed(
    client: TestClient, user_factory
) -> None:
    """ACTUAL rule: personal keys carry NO name uniqueness (the live-name UQ is
    org-scoped only) - duplicates succeed, no 500."""
    user_factory()
    first = _create(client, name="Same")
    second = _create(client, name="Same")
    assert first["key"]["id"] != second["key"]["id"]
    names = [k["name"] for k in client.get("/api/v1/keys").json()]
    assert names.count("Same") == 2


def test_lifecycle_invalid_payloads_rejected_without_rows(
    client: TestClient, db: Session, user_factory
) -> None:
    user_factory()
    before = db.scalar(select(func.count()).select_from(ApiKey))
    bad = [
        {"name": ""},  # empty
        {"name": "x" * 121},  # over max_length=120
        {"name": "Past", "expires_at": (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()},
        {"name": "Neg", "policy": {"rpm": -1}},
        {"name": "NegB", "policy": {"max_budget_usd": "-1"}},
        {"name": "NegD", "policy": {"budget_reset_days": 0}},
        {"name": "Bad cidr", "ip_rules": [{"type": "allow", "cidr": "not-an-ip"}]},
    ]
    for payload in bad:
        r = client.post("/api/v1/keys", json=payload)
        assert r.status_code == 422, payload
        assert r.json()["error"]["code"] == "VALIDATION_ERROR"
    assert db.scalar(select(func.count()).select_from(ApiKey)) == before


def test_lifecycle_patch_description_and_expiry_null_clear(
    client: TestClient, user_factory
) -> None:
    user_factory()
    future = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
    _, kid = _raw(client, name="Patch me", expires_at=future)
    patched = client.patch(f"/api/v1/keys/{kid}", json={"description": "d1"})
    assert patched.status_code == 200 and patched.json()["description"] == "d1"
    assert client.patch(f"/api/v1/keys/{kid}", json={"name": ""}).status_code == 422
    cleared = client.patch(f"/api/v1/keys/{kid}", json={"expires_at": None})
    assert cleared.status_code == 200 and cleared.json()["expires_at"] is None


def test_lifecycle_org_key_assoc_and_isolation(
    client: TestClient, db: Session, user_factory
) -> None:
    user_factory("org-owner@tollma.ai")
    oid = client.post(ORG, json={"name": "Audit Org"}).json()["id"]
    member = _mkuser("orgmember")
    member_id = _invite_and_accept(client, member, db, oid)

    member_default_before = key_service.find_default_key(db, uuid.UUID(member_id))
    issued = client.post(f"{ORG}/{oid}/keys",
                         json={"assignee_user_id": member_id, "name": "mem-key"})
    assert issued.status_code == 201, issued.text
    org_raw, org_kid = issued.json()["raw_key"], issued.json()["key"]["id"]
    row = db.scalar(select(ApiKey).where(ApiKey.id == uuid.UUID(org_kid)))
    assert row is not None and str(row.org_id) == oid
    assert row.issued_by is not None and str(row.user_id) == member_id
    assert org_raw.startswith("tma_sk_live_")

    # Isolation both directions; org issuance never moves the personal default.
    assert org_kid not in [k["id"] for k in client.get("/api/v1/keys").json()]
    assert org_kid not in [k["id"] for k in member.get("/api/v1/keys").json()]
    assert org_kid in [k["id"] for k in client.get(f"{ORG}/{oid}/keys").json()]
    assert key_service.find_default_key(db, uuid.UUID(member_id)).id == member_default_before.id
    # Non-member assignee + outsider caller: 404 oracle either way.
    outsider = _mkuser("orgoutsider")
    outsider_id = outsider.get("/auth/me").json()["id"]
    assert client.post(f"{ORG}/{oid}/keys",
                       json={"assignee_user_id": outsider_id, "name": "x"}).status_code == 404
    assert outsider.post(f"{ORG}/{oid}/keys",
                         json={"assignee_user_id": member_id, "name": "x"}).status_code == 404


def test_lifecycle_raw_never_rereturned(
    client: TestClient, db: Session, user_factory
) -> None:
    user_factory()
    raw, kid = _raw(client, name="Once")
    blob = json.dumps({
        "list": client.get("/api/v1/keys").json(),
        "detail": client.get(f"/api/v1/keys/{kid}").json(),
        "analytics": client.get(f"/api/v1/keys/{kid}/analytics?preset=last_7d").json(),
    })
    assert raw not in blob and key_engine.hash_key(raw) not in blob
    rotated = client.post(f"/api/v1/keys/{kid}/rotate")
    assert rotated.status_code == 200, rotated.text
    assert raw not in rotated.text  # only the NEW raw appears
    assert rotated.json()["raw_key"] != raw


# --- authN matrix --------------------------------------------------------


def test_authn_valid_and_missing(client: TestClient, user_factory) -> None:
    user_factory()
    raw, _ = _raw(client, name="Probe")
    assert client.get(MODELS_PROBE, headers=_auth(raw)).status_code == 200
    missing = client.get(MODELS_PROBE)
    assert missing.status_code == 401
    body = missing.json()
    assert body["success"] is False
    assert body["error"]["code"] == "UNAUTHENTICATED"
    assert body["error"]["message"] == "missing API key"


@pytest.mark.parametrize("headers", [
    {"Authorization": "Bearer"},          # scheme, no credential
    {"Authorization": "Bearer "},         # scheme, blank credential
    {"Authorization": "Token abcdef"},    # wrong scheme
    {"Authorization": ""},                # empty header
    {"Authorization": "   "},             # whitespace only
    {"x-api-key": ""},                    # empty alt header
])
def test_authn_malformed_headers_401(client: TestClient, user_factory, headers: dict) -> None:
    user_factory()
    _raw(client, name="Malformed")
    r = client.get(MODELS_PROBE, headers=headers)
    assert r.status_code == 401, headers
    assert r.json()["error"]["code"] == "UNAUTHENTICATED"


def test_authn_unknown_class_indistinguishable(
    client: TestClient, db: Session, user_factory
) -> None:
    """No existence oracle: random / truncated / prefix-only / deleted / rotated
    raws all produce the IDENTICAL 401 (status + code + message)."""
    user_factory()
    raw, kid = _raw(client, name="Oracle")
    doomed_raw, doomed_kid = _raw(client, name="Doomed")
    rotated_raw, rotated_kid = _raw(client, name="Rotated")
    new_raw = client.post(f"/api/v1/keys/{rotated_kid}/rotate").json()["raw_key"]
    assert client.delete(f"/api/v1/keys/{doomed_kid}").status_code == 204
    assert key_engine.authenticate(db, rotated_raw) is None
    assert key_engine.authenticate(db, new_raw) is not None

    candidates = [
        "tma_sk_live_" + "0" * 48,          # well-formed random
        raw[:20],                            # prefix only
        raw[: len(raw) - 10],                # truncated
        raw[:-2] + ("00" if not raw.endswith("00") else "ff"),  # tampered tail
        doomed_raw,                          # soft-deleted
        rotated_raw,                         # rotated-away
    ]
    signatures = set()
    for candidate in candidates:
        r = client.get(MODELS_PROBE, headers=_auth(candidate))
        assert r.status_code == 401, candidate
        body = r.json()
        assert body["error"]["code"] == "UNAUTHENTICATED"
        assert raw not in r.text and key_engine.hash_key(raw) not in r.text
        signatures.add((r.status_code, body["error"]["code"], body["error"]["message"]))
    assert signatures == {(401, "UNAUTHENTICATED", "invalid API key")}


def test_authn_x_api_key_header_and_precedence(client: TestClient, user_factory) -> None:
    user_factory()
    raw, _ = _raw(client, name="Alt header")
    assert client.get(MODELS_PROBE, headers=_xkey(raw)).status_code == 200
    both_ok = dict(_xkey(raw), **_auth("tma_sk_live_" + "0" * 48))
    assert client.get(MODELS_PROBE, headers=both_ok).status_code == 200  # x-api-key wins
    both_bad = dict(_xkey("tma_sk_live_" + "0" * 48), **_auth(raw))
    assert client.get(MODELS_PROBE, headers=both_bad).status_code == 401


def test_authn_whitespace_padded_key_stripped(client: TestClient, user_factory) -> None:
    """ACTUAL `parse_bearer` behavior: surrounding whitespace is stripped."""
    user_factory()
    raw, _ = _raw(client, name="Padded")
    assert client.get(MODELS_PROBE, headers=_auth(f"  {raw}  ")).status_code == 200


def test_authn_expired_403_no_provider_call(
    client: TestClient, db: Session, user_factory, provider_factory, model_factory,
    monkeypatch: pytest.MonkeyPatch, _cap_events,
) -> None:
    user_factory()
    p = provider_factory("ExpProbe")
    model_factory(p["id"])
    calls = _bind_public(monkeypatch, _FakePublicAdapter([]))
    raw, kid = _raw(client, name="Expiring")
    assert client.post("/v1/chat/completions", json=_chat_body(p), headers=_auth(raw)).status_code == 200
    assert len(calls) == 1 and len(_pg_rows(db, kid)) == 1

    _expire_key(db, raw, kid)
    assert key_engine.authenticate(db, raw) is not None  # context returned...
    assert key_engine.authenticate(db, raw).is_expired() is True  # ...flagged expired
    denied = client.post("/v1/chat/completions", json=_chat_body(p), headers=_auth(raw))
    assert denied.status_code == 403, denied.text
    assert "expired" in denied.json()["error"]["message"]
    assert len(calls) == 1  # no new provider I/O
    assert len(_pg_rows(db, kid)) == 1  # auth-layer deny writes no new row


def test_authn_disabled_403(client: TestClient, db: Session, user_factory, _cap_events) -> None:
    user_factory()
    raw, kid = _raw(client, name="Disable me")
    assert client.patch(f"/api/v1/keys/{kid}", json={"enabled": False}).status_code == 200
    ctx = key_engine.authenticate(db, raw)
    assert ctx is not None and ctx.enabled is False  # context returned, flagged
    r = client.get(MODELS_PROBE, headers=_auth(raw))
    assert r.status_code == 403 and "disabled" in r.json()["error"]["message"]
    assert [e for e in _events(_cap_events, "gateway.denied") if e.get("reason") == "disabled"]
    assert client.patch(f"/api/v1/keys/{kid}", json={"enabled": True}).status_code == 200
    assert client.get(MODELS_PROBE, headers=_auth(raw)).status_code == 200


def test_authn_policy_expiry_source_blocks(
    client: TestClient, db: Session, user_factory
) -> None:
    """The policy row carries its own expires_at - either source denies."""
    user_factory()
    raw, kid = _raw(client, name="Policy expiry", policy={"rpm": 60})
    db.execute(ApiKeyPolicy.__table__.update().where(
        ApiKeyPolicy.api_key_id == uuid.UUID(kid)).values(
        expires_at=datetime.now(timezone.utc) - timedelta(hours=1)))
    db.commit()
    key_engine.invalidate_context(key_engine.hash_key(raw))
    assert key_engine.authenticate(db, raw).is_expired() is True
    r = client.get(MODELS_PROBE, headers=_auth(raw))
    assert r.status_code == 403 and "expired" in r.json()["error"]["message"]


def test_authn_safe_error_shape(client: TestClient, user_factory) -> None:
    user_factory()
    raw, _ = _raw(client, name="Safe")
    for headers in ({}, _auth("tma_sk_live_" + "f" * 48)):
        r = client.get(MODELS_PROBE, headers=headers)
        body = r.json()
        assert body["success"] is False
        assert set(body["error"]) >= {"code", "message", "retryable", "timestamp"}
        assert raw not in r.text and key_engine.hash_key(raw) not in r.text
        assert "Traceback" not in r.text


def test_authn_cross_user_management_404(
    client: TestClient, db: Session, user_factory
) -> None:
    user_factory("owner-a@tollma.ai")
    _, kid = _raw(client, name="A key")
    intruder = _mkuser("intruder")
    stranger = _mkuser("stranger")
    stranger_keys = stranger.get("/api/v1/keys").json()
    assert kid not in [k["id"] for k in stranger_keys]  # list scoped to owner
    for method, path, payload in (
        ("get", f"/api/v1/keys/{kid}", None),
        ("patch", f"/api/v1/keys/{kid}", {"name": "Stolen"}),
        ("delete", f"/api/v1/keys/{kid}", None),
        ("post", f"/api/v1/keys/{kid}/rotate", None),
        ("put", f"/api/v1/keys/{kid}/policy", {}),
        ("put", f"/api/v1/keys/{kid}/ip-rules", []),
        ("put", f"/api/v1/keys/{kid}/model-permissions", []),
        ("get", f"/api/v1/keys/{kid}/analytics?preset=last_7d", None),
    ):
        r = getattr(intruder, method)(path) if payload is None else getattr(intruder, method)(path, json=payload)
        assert r.status_code == 404, (method, path, r.text)
    assert client.get(f"/api/v1/keys/{kid}").status_code == 200  # owner unaffected


def test_authn_personal_key_cannot_see_other_workspace_models(
    client: TestClient, provider_factory, model_factory, user_factory
) -> None:
    """Per-key scope: a personal key resolves only its owner's providers;
    another workspace's model never leaks (absent from the listing)."""
    user_factory("ws-a@tollma.ai")
    raw_a, _ = _raw(client, name="A key")
    other = _mkuser("wsb")
    r = other.post("/api/v1/providers", json={
        "name": "B provider", "provider_type": "CUSTOM",
        "credentials": {"base_url": "http://mock"}})
    assert r.status_code == 201, r.text
    m = other.post("/api/v1/models", json={
        "provider_id": r.json()["id"], "model_id": "b-model",
        "name": "B", "endpoint_type": "chat_completions",
        "input_price": "1", "output_price": "1"})
    assert m.status_code == 201, m.text
    data = client.get(MODELS_PROBE, headers=_auth(raw_a)).json()["data"]
    assert all("b-model" not in entry["id"] for entry in data)


def test_authn_org_membership_loss_kills_org_key(
    client: TestClient, db: Session, user_factory, _cap_events
) -> None:
    user_factory("mem-owner@tollma.ai")
    oid = client.post(ORG, json={"name": "Lapse Org"}).json()["id"]
    member = _mkuser("lapse")
    member_id = _invite_and_accept(client, member, db, oid)
    issued = client.post(f"{ORG}/{oid}/keys",
                         json={"assignee_user_id": member_id, "name": "lapse-key"})
    assert issued.status_code == 201, issued.text
    org_raw = issued.json()["raw_key"]
    assert client.get(MODELS_PROBE, headers=_auth(org_raw)).status_code == 200
    assert key_engine.authenticate(db, org_raw) is not None

    # Suspend REVOKES the member's org keys (soft-delete + tombstone + audit):
    # the backstop 401 below would hold either way, but the row is really dead.
    assert client.post(f"{ORG}/{oid}/members/{member_id}/suspend").status_code == 200
    db.expire_all()
    row = db.scalar(select(ApiKey).where(ApiKey.key_hash == key_engine.hash_key(org_raw)))
    assert row is not None and row.is_deleted is True  # soft-deleted, gone from live reads
    assert key_engine.authenticate(db, org_raw) is None  # backstop: 401, never an oracle
    assert client.get(MODELS_PROBE, headers=_auth(org_raw)).status_code == 401

    # Resume NEVER restores revoked keys: re-issuance is always a new row.
    assert client.post(f"{ORG}/{oid}/members/{member_id}/resume").status_code == 200
    assert client.get(MODELS_PROBE, headers=_auth(org_raw)).status_code == 401
    reissued = client.post(f"{ORG}/{oid}/keys",
                           json={"assignee_user_id": member_id, "name": "lapse-key-2"})
    assert reissued.status_code == 201, reissued.text
    org_raw2 = reissued.json()["raw_key"]
    assert client.get(MODELS_PROBE, headers=_auth(org_raw2)).status_code == 200

    assert client.delete(f"{ORG}/{oid}/members/{member_id}").status_code == 204
    assert key_engine.authenticate(db, org_raw2) is None
    assert client.get(MODELS_PROBE, headers=_auth(org_raw2)).status_code == 401


# --- restrictions: rates / budgets / models --------------------------------


def test_restrict_rpm_allow_then_deny(
    client: TestClient, db: Session, user_factory, provider_factory, model_factory,
    monkeypatch: pytest.MonkeyPatch, _cap_events,
) -> None:
    user_factory()
    p = provider_factory("RpmP")
    model_factory(p["id"])
    calls = _bind_public(monkeypatch, _FakePublicAdapter([]))
    raw, kid = _raw(client, name="RPM", policy={"rpm": 1})
    assert client.post("/v1/chat/completions", json=_chat_body(p), headers=_auth(raw)).status_code == 200
    denied = client.post("/v1/chat/completions", json=_chat_body(p), headers=_auth(raw))
    assert denied.status_code == 429, denied.text
    assert denied.json()["error"]["code"] == "RATE_LIMITED"
    assert "Retry-After" in denied.headers
    assert len(calls) == 1  # denied-before-dispatch: no upstream call
    rows = _pg_rows(db, kid)
    assert [row.status for row in rows] == ["success", "failed"]  # deny audited once
    assert [e for e in _events(_cap_events, "gateway.denied") if e.get("reason") == "rpm"]


def test_restrict_rpm_boundary_exact_then_one_over(
    client: TestClient, user_factory, provider_factory, model_factory,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_factory()
    p = provider_factory("RpmBoundary")
    model_factory(p["id"])
    _bind_public(monkeypatch, _FakePublicAdapter([]))
    raw, _ = _raw(client, name="Boundary", policy={"rpm": 2})
    assert client.post("/v1/chat/completions", json=_chat_body(p), headers=_auth(raw)).status_code == 200
    assert client.post("/v1/chat/completions", json=_chat_body(p), headers=_auth(raw)).status_code == 200
    assert client.post("/v1/chat/completions", json=_chat_body(p), headers=_auth(raw)).status_code == 429


def test_restrict_update_while_active_takes_effect(
    client: TestClient, user_factory, provider_factory, model_factory,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Policy edits invalidate the cached context: live -> blocked -> live."""
    user_factory()
    p = provider_factory("Live update")
    model_factory(p["id"])
    _bind_public(monkeypatch, _FakePublicAdapter([]))
    raw, kid = _raw(client, name="Live")
    ok = {"model": _ref(p), "messages": [{"role": "user", "content": "hi"}]}
    assert client.post("/v1/chat/completions", json=ok, headers=_auth(raw)).status_code == 200
    assert client.put(f"/api/v1/keys/{kid}/policy", json={"rpm": 0}).status_code == 200  # 0 = blocked
    assert client.post("/v1/chat/completions", json=ok, headers=_auth(raw)).status_code == 429
    assert client.put(f"/api/v1/keys/{kid}/policy", json={}).status_code == 200  # clear = unlimited
    assert client.post("/v1/chat/completions", json=ok, headers=_auth(raw)).status_code == 200


def test_restrict_model_allow_list_bypass_attempts(
    client: TestClient, db: Session, user_factory, provider_factory, model_factory,
    monkeypatch: pytest.MonkeyPatch, _cap_events,
) -> None:
    user_factory()
    p = provider_factory("ScopedP")
    allowed = model_factory(p["id"])
    other = model_factory(p["id"], model_id="other-model", name="Other")
    calls = _bind_public(monkeypatch, _FakePublicAdapter([]))
    raw, kid = _raw(
        client, name="Scoped",
        model_permissions=[{"provider_id": p["id"], "model_id": allowed["id"]}],
    )
    good = {"model": _ref(p), "messages": [{"role": "user", "content": "hi"}]}
    assert client.post("/v1/chat/completions", json=good, headers=_auth(raw)).status_code == 200
    bad = {"model": _ref(p, "other-model"), "messages": [{"role": "user", "content": "hi"}]}
    denied = client.post("/v1/chat/completions", json=bad, headers=_auth(raw))
    assert denied.status_code == 403, denied.text
    assert "model_not_allowed" in denied.json()["error"]["message"]
    assert len(calls) == 1  # scoped model only; bypass never dispatched
    rows = _pg_rows(db, kid)
    assert len(rows) == 2 and rows[-1].status == "failed"
    assert [e for e in _events(_cap_events, "gateway.denied")
            if e.get("reason") in ("model", "capability")]


def test_restrict_zero_budget_blocks_priced_traffic(
    client: TestClient, db: Session, user_factory, provider_factory, model_factory,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """`max_budget_usd: 0` means blocked (NULL = unlimited); priced estimate denies."""
    user_factory()
    p = provider_factory("ZeroBudget")
    model_factory(p["id"])
    calls = _bind_public(monkeypatch, _FakePublicAdapter([]))
    raw, kid = _raw(client, name="Zero", policy={"max_budget_usd": "0"})
    denied = client.post("/v1/chat/completions", json=_chat_body(p), headers=_auth(raw))
    assert denied.status_code == 403, denied.text
    assert len(calls) == 0
    assert [row.status for row in _pg_rows(db, kid)] == ["failed"]


def test_restrict_concurrent_requests_share_one_rpm_window(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Five concurrent reservations against rpm=1: exactly one wins (atomic)."""
    ctx = KeyContext(
        key_id=uuid.uuid4(), user_id=uuid.uuid4(), name="race",
        key_prefix="tma_sk_live_test", enabled=True, expires_at=None,
        policy=KeyPolicy(rpm=1), model_permissions=(),
    )
    pid, mid = uuid.uuid4(), uuid.uuid4()

    def attempt(n: int) -> bool:
        return limits.check_request(
            ctx, provider_id=pid, model_id=mid,
            estimated_tokens=1, estimated_cost=Decimal("0"),
            request_id=f"race-{n}",
        ).allowed

    with ThreadPoolExecutor(max_workers=5) as pool:
        assert sum(pool.map(attempt, range(5))) == 1


def test_restrict_failed_call_refunds_spend_not_rpm_slot(
    client: TestClient, db: Session, user_factory, provider_factory, model_factory,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """ACTUAL refund contract: a provider failure refunds the pre-flight SPEND
    reservation (no phantom cost), but the rpm attempt slot stays consumed -
    failures must not let callers retry-flood past a rate window."""
    from tollms.core.exceptions import ProviderError

    user_factory()
    p = provider_factory("RefundP")
    model_factory(p["id"])
    calls: list = []

    class _Flaky(_FakePublicAdapter):
        async def chat(self, messages):
            self._calls.append(("chat", list(messages)))
            raise ProviderError("boom")

    monkeypatch.setattr(pg_service, "build_adapter", lambda *a, **k: _Flaky(calls))
    raw, kid = _raw(client, name="Refund", policy={"rpm": 2})
    first = client.post("/v1/chat/completions", json=_chat_body(p), headers=_auth(raw))
    assert first.status_code == 502, first.text  # provider failure mapped

    ctx = key_engine.authenticate(db, raw)
    assert ctx is not None and limits.current_spend(ctx) == Decimal(0)  # spend refunded

    monkeypatch.setattr(pg_service, "build_adapter", lambda *a, **k: _FakePublicAdapter(calls))
    retry = client.post("/v1/chat/completions", json=_chat_body(p), headers=_auth(raw))
    assert retry.status_code == 200, retry.text  # second rpm slot
    third = client.post("/v1/chat/completions", json=_chat_body(p), headers=_auth(raw))
    assert third.status_code == 429  # failed attempt consumed slot one


# --- IP restrictions --------------------------------------------------------


def _ip_ctx(allow=(), deny=()) -> KeyContext:
    return KeyContext(
        key_id=uuid.uuid4(), user_id=uuid.uuid4(), name="ip",
        key_prefix="tma_x", enabled=True, expires_at=None,
        policy=KeyPolicy(), model_permissions=(),
        allow_rules=tuple(allow), deny_rules=tuple(deny),
    )


def test_ip_engine_matrix() -> None:
    assert key_policy.ip_allowed(_ip_ctx(), None) is True  # no rules: open
    assert key_policy.ip_allowed(_ip_ctx(), "not-an-ip") is True
    assert key_policy.ip_allowed(_ip_ctx(), "8.8.8.8") is True

    allow = _ip_ctx(allow=("1.2.3.0/24",))
    assert key_policy.ip_allowed(allow, "1.2.3.4") is True
    assert key_policy.ip_allowed(allow, "1.2.4.4") is False
    assert key_policy.ip_allowed(allow, "not-an-ip") is False  # fail-closed
    assert key_policy.ip_allowed(allow, None) is False  # missing: fail-closed

    deny = _ip_ctx(deny=("10.0.0.0/8",))
    assert key_policy.ip_allowed(deny, "10.1.2.3") is False
    assert key_policy.ip_allowed(deny, "8.8.8.8") is True  # deny-only: rest open

    multi = _ip_ctx(allow=("1.2.3.0/24", "5.6.7.8/32"))
    assert key_policy.ip_allowed(multi, "5.6.7.8") is True
    assert key_policy.ip_allowed(multi, "9.9.9.9") is False

    v6 = _ip_ctx(allow=("2001:db8::/32",))
    assert key_policy.ip_allowed(v6, "2001:db8::1") is True
    assert key_policy.ip_allowed(v6, "::1") is False
    # ACTUAL: IPv4-mapped IPv6 does NOT match an IPv4 rule (mixed families
    # raise TypeError inside `in`, caught -> no match -> deny).
    assert key_policy.ip_allowed(_ip_ctx(allow=("1.2.3.4/32",)), "::ffff:1.2.3.4") is False
    # ...but matches when the rule itself is the mapped form.
    assert key_policy.ip_allowed(_ip_ctx(allow=("::ffff:1.2.3.4/128",)), "::ffff:1.2.3.4") is True


def test_ip_deny_wins_over_allow() -> None:
    """ACTUAL precedence: deny checked first; an allow entry under a deny is
    dead (creation of that exact overlap is rejected - see below)."""
    both = _ip_ctx(allow=("0.0.0.0/0",), deny=("203.0.113.7/32",))
    assert key_policy.ip_allowed(both, "203.0.113.7") is False
    assert key_policy.ip_allowed(both, "8.8.8.8") is True


def test_ip_overlap_rejected_at_api(client: TestClient, user_factory) -> None:
    user_factory()
    dup = client.post("/api/v1/keys", json={
        "name": "Overlap",
        "ip_rules": [{"type": "allow", "cidr": "1.2.3.4"},
                     {"type": "deny", "cidr": "1.2.3.4/32"}]})
    assert dup.status_code == 422 and dup.json()["error"]["code"] == "VALIDATION_ERROR"
    _, kid = _raw(client, name="Rules", ip_rules=[{"type": "allow", "cidr": "9.9.9.9"}])
    clash = client.put(f"/api/v1/keys/{kid}/ip-rules", json=[
        {"type": "allow", "cidr": "5.6.7.8"}, {"type": "deny", "cidr": "5.6.7.8"}])
    assert clash.status_code == 422
    kept = client.get(f"/api/v1/keys/{kid}").json()["ip_rules"]
    assert [r["cidr"] for r in kept] == ["9.9.9.9/32"]  # failed replace kept old rules


def test_ip_gateway_client_ip_trust_matrix(monkeypatch: pytest.MonkeyPatch) -> None:
    import ipaddress

    def req(peer, headers=None):
        return SimpleNamespace(
            client=SimpleNamespace(host=peer) if peer else None, headers=headers or {})

    # Trusted direct peers: leftmost XFF wins.
    assert session_mod.gateway_client_ip(req("127.0.0.1", {"x-forwarded-for": "9.9.9.9"})) == "9.9.9.9"
    assert session_mod.gateway_client_ip(req("10.0.0.5", {"x-forwarded-for": "1.1.1.1, 2.2.2.2"})) == "1.1.1.1"
    # Untrusted public peer: forged XFF ignored - the direct peer is the identity.
    assert session_mod.gateway_client_ip(req("8.8.8.8", {"x-forwarded-for": "9.9.9.9"})) == "8.8.8.8"
    # Unparseable peer (TestClient "testclient"): never trusts XFF.
    assert session_mod.gateway_client_ip(req("testclient", {"x-forwarded-for": "9.9.9.9"})) == "testclient"
    # X-Real-IP and Forwarded are NEVER read (spoof-proof by construction).
    spoof = {"x-forwarded-for": "", "x-real-ip": "9.9.9.9", "forwarded": "for=9.9.9.9"}
    assert session_mod.gateway_client_ip(req("8.8.8.8", spoof)) == "8.8.8.8"
    # Empty / whitespace-only XFF falls back to the peer.
    assert session_mod.gateway_client_ip(req("10.0.0.5", {"x-forwarded-for": "  "})) == "10.0.0.5"
    assert session_mod.gateway_client_ip(req("10.0.0.5", {"x-forwarded-for": " , 1.2.3.4"})) in ("10.0.0.5", "")
    # Empty peer never elects XFF (policy fail-closes when rules exist).
    assert session_mod.gateway_client_ip(req(None, {"x-forwarded-for": "9.9.9.9"})) == ""
    assert session_mod.gateway_client_ip(req(None)) == ""
    # Extra trusted proxy via TRUSTED_PROXIES honours XFF from that peer.
    real = session_mod._trusted_proxy_nets
    session_mod._trusted_proxy_nets = lambda: [ipaddress.ip_network("8.8.8.0/24")]
    try:
        assert session_mod.gateway_client_ip(req("8.8.8.8", {"x-forwarded-for": "9.9.9.9"})) == "9.9.9.9"
    finally:
        session_mod._trusted_proxy_nets = real


def test_ip_blocked_no_provider_call_no_success_row_audit_event(
    client: TestClient, db: Session, user_factory, provider_factory, model_factory,
    monkeypatch: pytest.MonkeyPatch, _cap_events,
) -> None:
    user_factory()
    p = provider_factory("IpDeny")
    model_factory(p["id"])
    calls = _bind_public(monkeypatch, _FakePublicAdapter([]))
    raw, kid = _raw(client, name="IP fenced", ip_rules=[{"type": "allow", "cidr": "10.99.0.1/32"}])

    monkeypatch.setattr(pg_service, "policy_client_ip", lambda request: "9.9.9.9")
    denied = client.post("/v1/chat/completions", json=_chat_body(p), headers=_auth(raw))
    assert denied.status_code == 403, denied.text
    assert "IP rules" in denied.json()["error"]["message"]
    assert denied.json()["error"]["code"] == "FORBIDDEN"
    assert raw not in denied.text and key_engine.hash_key(raw) not in denied.text
    assert calls == []  # blocked: zero provider I/O
    assert _pg_rows(db, kid) == []  # auth-layer deny persists nothing (no success row)
    emits = [e for e in _events(_cap_events, "gateway.denied") if e.get("reason") == "ip"]
    assert emits  # blocked: structured audit event present

    monkeypatch.setattr(pg_service, "policy_client_ip", lambda request: "not-an-ip")
    closed = client.post("/v1/chat/completions", json=_chat_body(p), headers=_auth(raw))
    assert closed.status_code == 403  # unparseable client IP: fail-closed


def test_ip_allowed_proceeds_with_other_restrictions_applied(
    client: TestClient, db: Session, user_factory, provider_factory, model_factory,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_factory()
    p = provider_factory("IpAllow")
    model_factory(p["id"])
    calls = _bind_public(monkeypatch, _FakePublicAdapter([]))
    raw, kid = _raw(client, name="IP open", ip_rules=[{"type": "allow", "cidr": "10.10.0.0/16"}])
    monkeypatch.setattr(pg_service, "policy_client_ip", lambda request: "10.10.1.2")
    assert client.post("/v1/chat/completions", json=_chat_body(p), headers=_auth(raw)).status_code == 200
    assert len(calls) == 1

    # Allowed IP does NOT waive the remaining gates: rpm=0 still denies...
    assert client.put(f"/api/v1/keys/{kid}/policy", json={"rpm": 0}).status_code == 200
    assert client.post("/v1/chat/completions", json=_chat_body(p), headers=_auth(raw)).status_code == 429
    assert client.put(f"/api/v1/keys/{kid}/policy", json={}).status_code == 200
    # ...and expiry is checked BEFORE IP (documented gate order).
    _expire_key(db, raw, kid)
    expired = client.post("/v1/chat/completions", json=_chat_body(p), headers=_auth(raw))
    assert expired.status_code == 403 and "expired" in expired.json()["error"]["message"]


def test_ip_spoofed_headers_from_untrusted_peer_cannot_bypass(
    client: TestClient, user_factory,
) -> None:
    """Direct-API bypass attempt: TestClient's peer ("testclient") is untrusted,
    so every spoofed identity header must be ignored and the allow-list enforced."""
    user_factory()
    raw, _ = _raw(client, name="Spoof fenced", ip_rules=[{"type": "allow", "cidr": "10.9.9.9/32"}])
    spoof = dict(_auth(raw), **{
        "X-Forwarded-For": "10.9.9.9",
        "X-Real-IP": "10.9.9.9",
        "Forwarded": "for=10.9.9.9",
    })
    r = client.get(MODELS_PROBE, headers=spoof)
    assert r.status_code == 403, r.text
    assert "IP rules" in r.json()["error"]["message"]
    # ...while the same request without spoofing is equally denied (no oracle delta).
    plain = client.get(MODELS_PROBE, headers=_auth(raw))
    assert (plain.status_code, plain.json()["error"]["message"]) == (
        r.status_code, r.json()["error"]["message"])


def test_ip_missing_client_ip_fail_closed_but_open_key_passes(
    client: TestClient, user_factory, monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_factory()
    fenced_raw, _ = _raw(client, name="Fenced", ip_rules=[{"type": "deny", "cidr": "9.9.9.9/32"}])
    open_raw, _ = _raw(client, name="Open")
    monkeypatch.setattr(pg_service, "policy_client_ip", lambda request: None)
    assert client.get(MODELS_PROBE, headers=_auth(fenced_raw)).status_code == 403
    assert client.get(MODELS_PROBE, headers=_auth(open_raw)).status_code == 200


def test_ip_update_while_active_revoke_and_empty_clear(
    client: TestClient, db: Session, user_factory, monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_factory()
    raw, kid = _raw(client, name="IP live")
    ip = lambda: "10.20.30.40"  # noqa: E731
    monkeypatch.setattr(pg_service, "policy_client_ip", lambda request: ip())
    assert client.get(MODELS_PROBE, headers=_auth(raw)).status_code == 200  # no rules: open

    key_engine.authenticate(db, raw)  # warm the compiled-context cache
    assert client.put(f"/api/v1/keys/{kid}/ip-rules",
                      json=[{"type": "allow", "cidr": "192.0.2.1/32"}]).status_code == 200
    assert client.get(MODELS_PROBE, headers=_auth(raw)).status_code == 403  # immediate, no stale allow

    assert client.put(f"/api/v1/keys/{kid}/ip-rules", json=[]).status_code == 200  # [] clears
    assert client.get(MODELS_PROBE, headers=_auth(raw)).status_code == 200

    assert client.delete(f"/api/v1/keys/{kid}").status_code == 204
    assert client.get(MODELS_PROBE, headers=_auth(raw)).status_code == 401
    assert key_engine.authenticate(db, raw) is None
    assert key_engine.authenticate(db, raw) is None  # no cache resurrection


# --- rotation / revocation --------------------------------------------------


def test_rotate_old_dead_new_live(
    client: TestClient, db: Session, user_factory, _cap_events,
) -> None:
    user_factory()
    raw, kid = _raw(client, name="Rotate me")
    key_engine.authenticate(db, raw)  # warm cache
    rotated = client.post(f"/api/v1/keys/{kid}/rotate")
    assert rotated.status_code == 200, rotated.text
    new_raw = rotated.json()["raw_key"]
    assert new_raw != raw and raw not in rotated.text
    body = rotated.json()["key"]
    assert body["rotation_count"] == 1 and body["key_prefix"] == new_raw[:20]

    assert key_engine.authenticate(db, raw) is None  # tombstoned, even warm
    assert client.get(MODELS_PROBE, headers=_auth(raw)).status_code == 401
    assert client.get(MODELS_PROBE, headers=_auth(new_raw)).status_code == 200
    assert [e for e in _events(_cap_events, "key.rotated")]
    # Second rotation keeps working; only the latest hash authenticates.
    newer = client.post(f"/api/v1/keys/{kid}/rotate").json()["raw_key"]
    assert client.get(MODELS_PROBE, headers=_auth(new_raw)).status_code == 401
    assert client.get(MODELS_PROBE, headers=_auth(newer)).status_code == 200


def test_revoke_then_use_writes_nothing(
    client: TestClient, db: Session, user_factory, provider_factory, model_factory,
    monkeypatch: pytest.MonkeyPatch, _cap_events,
) -> None:
    user_factory()
    p = provider_factory("RevokeP")
    model_factory(p["id"])
    _bind_public(monkeypatch, _FakePublicAdapter([]))
    raw, kid = _raw(client, name="Revoke me")
    assert client.post("/v1/chat/completions", json=_chat_body(p), headers=_auth(raw)).status_code == 200
    assert len(_pg_rows(db, kid)) == 1

    assert client.delete(f"/api/v1/keys/{kid}").status_code == 204
    assert client.get(MODELS_PROBE, headers=_auth(raw)).status_code == 401
    reuse = client.post("/v1/chat/completions", json=_chat_body(p), headers=_auth(raw))
    assert reuse.status_code == 401
    assert len(_pg_rows(db, kid)) == 1  # revoked reuse persists nothing
    assert [e for e in _events(_cap_events, "key.deleted")]
    assert client.get(f"/api/v1/keys/{kid}").status_code == 404  # management oracle


def test_revocation_propagates_within_the_same_request_window(
    client: TestClient, db: Session, user_factory,
) -> None:
    """The documented window is the 30s compiled-context cache; delete/rotate
    close it via synchronous invalidate + tombstone, so propagation here is
    immediate - a revoked key must fail on the VERY NEXT request, never later."""
    user_factory()
    raw, kid = _raw(client, name="Window")
    assert key_engine.authenticate(db, raw) is not None
    assert client.get(MODELS_PROBE, headers=_auth(raw)).status_code == 200
    assert client.delete(f"/api/v1/keys/{kid}").status_code == 204
    assert key_engine.authenticate(db, raw) is None
    assert client.get(MODELS_PROBE, headers=_auth(raw)).status_code == 401


def test_owner_disable_propagates_on_invalidation_not_before(
    client: TestClient, db: Session, user_factory,
) -> None:
    """ACTUAL cache contract: the owner-status verdict is snapshotted into the
    compiled context (<=30s lag documented in `compile_context`). An out-of-band
    owner change is invisible until the context is invalidated - then it blocks."""
    from tollms.models.user import User

    user = user_factory()
    raw, _ = _raw(client, name="Owner lag")
    assert key_engine.authenticate(db, raw) is not None  # warm: snapshots active owner
    db.execute(User.__table__.update().where(
        User.id == uuid.UUID(user["id"])).values(is_active=False))
    db.commit()
    assert key_engine.authenticate(db, raw).owner_is_active is True  # stale verdict (documented lag)
    key_engine.invalidate_context(key_engine.hash_key(raw))
    assert key_engine.authenticate(db, raw).owner_is_active is False
    assert client.get(MODELS_PROBE, headers=_auth(raw)).status_code == 403


def test_mutation_paths_all_invalidate_cached_context(
    client: TestClient, db: Session, user_factory,
) -> None:
    """Every mutation endpoint drops the compiled context: the next
    authenticate() reflects the change with no manual invalidation."""
    user_factory()
    raw, kid = _raw(client, name="Invalidate me", ip_rules=[{"type": "allow", "cidr": "9.9.9.9/32"}])
    hashed = key_engine.hash_key(raw)
    assert key_engine.authenticate(db, raw) is not None

    assert client.patch(f"/api/v1/keys/{kid}", json={"enabled": False}).status_code == 200
    assert key_engine.authenticate(db, raw).enabled is False
    assert client.patch(f"/api/v1/keys/{kid}", json={"enabled": True}).status_code == 200

    assert client.put(f"/api/v1/keys/{kid}/policy", json={"rpm": 7}).status_code == 200
    assert key_engine.authenticate(db, raw).policy.rpm == 7

    assert client.put(f"/api/v1/keys/{kid}/ip-rules",
                      json=[{"type": "deny", "cidr": "1.1.1.1/32"}]).status_code == 200
    assert key_engine.authenticate(db, raw).deny_rules == ("1.1.1.1/32",)

    assert client.put(f"/api/v1/keys/{kid}/model-permissions", json=[]).status_code == 200
    assert key_engine.authenticate(db, raw).model_permissions == ()
    assert len(hashed) == 64  # hash format sanity: hex sha256


def test_org_key_revoke_on_membership_remove(
    client: TestClient, db: Session, user_factory,
) -> None:
    user_factory("revoke-owner@tollma.ai")
    oid = client.post(ORG, json={"name": "Revoke Org"}).json()["id"]
    member = _mkuser("revokee")
    member_id = _invite_and_accept(client, member, db, oid)
    issued = client.post(f"{ORG}/{oid}/keys",
                         json={"assignee_user_id": member_id, "name": "revokee-key"})
    assert issued.status_code == 201, issued.text
    org_raw = issued.json()["raw_key"]
    assert client.get(MODELS_PROBE, headers=_auth(org_raw)).status_code == 200
    assert client.delete(f"{ORG}/{oid}/members/{member_id}").status_code == 204
    assert key_engine.authenticate(db, org_raw) is None
    r = client.get(MODELS_PROBE, headers=_auth(org_raw))
    assert r.status_code == 401 and r.json()["error"]["code"] == "UNAUTHENTICATED"
