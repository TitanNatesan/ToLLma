"""Org member analytics: per-member usage across internal + gateway planes."""

import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tollms.models.api_key import ApiRequestLog
from tollms.models.guardrail import GuardrailTrigger
from tollms.models.request_log import RequestLog
from tests.test_prompt_logging import _assign, _invite, _me, _mk_key, _org, _other, _set

ORG = "/api/v1/orgs"


def _seed_member_traffic(db: Session, oid: str, member_id: str, key_id: str) -> None:
    now = datetime.now(timezone.utc)
    db.add(RequestLog(user_id=uuid.UUID(member_id), org_id=uuid.UUID(oid),
                      api_key_id=uuid.UUID(key_id), total_tokens=100,
                      prompt_tokens=60, completion_tokens=40,
                      cache_read_tokens=10, cache_write_tokens=5,
                      total_cost=Decimal("0.5"), status="success",
                      created_at=now - timedelta(hours=2)))
    db.add(RequestLog(user_id=uuid.UUID(member_id), org_id=uuid.UUID(oid),
                      api_key_id=None, total_tokens=50,
                      prompt_tokens=30, completion_tokens=20,
                      total_cost=Decimal("0.1"), status="failed",
                      created_at=now - timedelta(hours=1)))
    db.add(ApiRequestLog(request_id=f"ma-{uuid.uuid4().hex[:8]}",
                         user_id=uuid.UUID(member_id), org_id=uuid.UUID(oid),
                         api_key_id=uuid.UUID(key_id), endpoint="chat_completions",
                         status="success", model="mock", provider="mockprov",
                         input_tokens=20, output_tokens=10, total_tokens=30,
                         cost=Decimal("0.25"), created_at=now))
    # Personal-key traffic must not leak in.
    db.add(RequestLog(user_id=uuid.UUID(member_id), org_id=None,
                      total_tokens=999, total_cost=Decimal("9"), status="success"))
    db.commit()


def _setup(client: TestClient, db: Session, user_factory):
    user_factory()
    member_client = _other(f"ma-{uuid.uuid4().hex[:8]}@tollma.ai")
    oid = _org(client)["id"]
    _invite(client, member_client, db, oid)
    member_id = _me(member_client)["id"]
    key = _mk_key(db, uuid.UUID(member_id), uuid.UUID(oid))
    db.commit()
    _seed_member_traffic(db, oid, member_id, str(key.id))
    return oid, member_id, member_client, key


def test_member_analytics_totals_and_merge(client: TestClient, db: Session, user_factory) -> None:
    oid, member_id, _, key = _setup(client, db, user_factory)
    r = client.get(f"{ORG}/{oid}/members/{member_id}/analytics")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["user_id"] == member_id
    assert body["requests"] == 3
    assert body["succeeded"] == 2 and body["failed"] == 1
    assert body["total_tokens"] == 180 and body["input_tokens"] == 110
    assert body["output_tokens"] == 70
    assert body["cache_read_tokens"] == 10 and body["cache_write_tokens"] == 5
    assert Decimal(str(body["total_cost"])) == Decimal("0.85")
    assert Decimal(str(body["avg_cost_per_request"])) == Decimal("0.85") / 3
    assert body["blocked"] == 0 and body["blocked_source"] == "guardrail_triggers"
    assert {row["key_id"] for row in body["by_key"]} == {str(key.id)}
    key_row = body["by_key"][0]
    assert key_row["requests"] == 2 and key_row["tokens"] == 130  # gateway + keyed in-app
    assert body["last_activity"] and body["last_model"] == "mock"
    assert body["last_key"] == key.name
    assert len(body["trend"]) == 1 and body["trend"][0]["requests"] == 3
    assert body["by_model"] and body["by_provider"]


def test_member_analytics_personal_and_others_excluded(
        client: TestClient, db: Session, user_factory) -> None:
    oid, member_id, _, _ = _setup(client, db, user_factory)
    other_client = _other(f"ma-{uuid.uuid4().hex[:8]}@tollma.ai")
    _invite(client, other_client, db, oid)
    other_id = _me(other_client)["id"]
    db.add(RequestLog(user_id=uuid.UUID(other_id), org_id=uuid.UUID(oid),
                      total_tokens=500, total_cost=Decimal("5"), status="success"))
    db.commit()
    body = client.get(f"{ORG}/{oid}/members/{member_id}/analytics").json()
    assert body["requests"] == 3  # other's 500-token row not counted
    other_body = client.get(f"{ORG}/{oid}/members/{other_id}/analytics").json()
    assert other_body["requests"] == 1 and other_body["total_tokens"] == 500


def test_member_analytics_revoked_key_history_retained(
        client: TestClient, db: Session, user_factory) -> None:
    oid, member_id, _, key = _setup(client, db, user_factory)
    key.is_deleted = True  # revoked after use: history stays attributed
    db.commit()
    body = client.get(f"{ORG}/{oid}/members/{member_id}/analytics").json()
    assert body["requests"] == 3
    assert body["by_key"][0]["key_id"] == str(key.id)
    assert body["by_key"][0]["key_name"] is None  # deleted key: no name, no crash


def test_member_analytics_blocked_counts(client: TestClient, db: Session, user_factory) -> None:
    oid, member_id, _, _ = _setup(client, db, user_factory)
    db.add(GuardrailTrigger(org_id=uuid.UUID(oid), user_id=uuid.UUID(member_id),
                            action="blocked", endpoint="chat"))
    db.add(GuardrailTrigger(org_id=uuid.UUID(oid), user_id=uuid.UUID(member_id),
                            action="allowed", endpoint="chat"))
    db.commit()
    body = client.get(f"{ORG}/{oid}/members/{member_id}/analytics").json()
    assert body["blocked"] == 1


def test_member_analytics_gates(client: TestClient, db: Session, user_factory) -> None:
    oid, member_id, member_client, _ = _setup(client, db, user_factory)
    stranger = _other(f"ma-{uuid.uuid4().hex[:8]}@tollma.ai")
    # Stranger (no membership): 404 oracle.
    assert stranger.get(f"{ORG}/{oid}/members/{member_id}/analytics").status_code == 404
    # Member without Analytics.ViewUsage: 404.
    assert member_client.get(f"{ORG}/{oid}/members/{member_id}/analytics").status_code == 404
    # Unknown member: 404.
    assert client.get(f"{ORG}/{oid}/members/{uuid.uuid4()}/analytics").status_code == 404
    # Malformed dates: 422.
    assert client.get(f"{ORG}/{oid}/members/{member_id}/analytics",
                      params={"from": "not-a-date"}).status_code == 422
    sid = _set(client, oid, "UsageOnly", ["Analytics.ViewUsage"])
    _assign(client, oid, _me(member_client)["id"], [sid])
    r = member_client.get(f"{ORG}/{oid}/members/{member_id}/analytics")
    assert r.status_code == 200, r.text
    # Cost redacted without ViewCost.
    assert r.json()["total_cost"] is None and r.json()["avg_cost_per_request"] is None
    assert r.json()["by_key"][0]["cost"] is None


def test_member_analytics_date_range(client: TestClient, db: Session, user_factory) -> None:
    oid, member_id, _, _ = _setup(client, db, user_factory)
    today = datetime.now(timezone.utc).date().isoformat()
    tomorrow = (datetime.now(timezone.utc).date() + timedelta(days=1)).isoformat()
    body = client.get(f"{ORG}/{oid}/members/{member_id}/analytics",
                      params={"from": today, "to": tomorrow}).json()
    assert body["requests"] == 3
    old = (datetime.now(timezone.utc) - timedelta(days=30)).date().isoformat()
    older = (datetime.now(timezone.utc) - timedelta(days=29)).date().isoformat()
    body = client.get(f"{ORG}/{oid}/members/{member_id}/analytics",
                      params={"from": old, "to": older}).json()
    assert body["requests"] == 0 and body["total_cost"] is not None
    assert body["by_key"] == [] and body["trend"] == []
    assert body["last_activity"] is None


def test_member_by_key_excludes_personal_key_rows(
        client: TestClient, db: Session, user_factory) -> None:
    """Personal-key in-app rows attributed to the org never surface in by_key."""
    from tests.test_prompt_logging import _mk_key as _mk_pl_key

    oid, member_id, _, key = _setup(client, db, user_factory)
    personal = _mk_pl_key(db, uuid.UUID(member_id))  # org_id None
    db.commit()
    db.add(RequestLog(user_id=uuid.UUID(member_id), org_id=uuid.UUID(oid),
                      api_key_id=personal.id, total_tokens=77,
                      total_cost=Decimal("0.7"), status="success"))
    db.commit()
    body = client.get(f"{ORG}/{oid}/members/{member_id}/analytics").json()
    key_ids = {row["key_id"] for row in body["by_key"]}
    assert str(personal.id) not in key_ids
    assert key_ids == {str(key.id)}
