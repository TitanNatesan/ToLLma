"""Repeat-interval dedupe, failing flag + recovery, Trigger.notified."""

import time
import uuid

from sqlalchemy.orm import Session

from tollms.services.guardrails import enforcement as enforcement_engine
from tollms.services.guardrails import notify as notify_engine


def _policy(db: Session, uid: uuid.UUID, name: str = "P", **kw):
    from tollms.models.guardrail import GuardrailPolicy

    policy = GuardrailPolicy(name=name, user_id=uid, enforcement="warn",
                             stage="both", is_enabled=True,
                             notify_on_trigger=True, **kw)
    db.add(policy)
    db.commit()
    return policy


def _warn_result() -> dict:
    return {"verdict": "warn", "confidence": 0.7, "categories": ["pii"],
            "reason": "pii heuristic", "evaluator_type": "deterministic",
            "failure_kind": None, "latency_ms": 1.0}


def _fail_result() -> dict:
    out = _warn_result()
    return {**out, "failure_kind": "timeout", "verdict": "allow",
            "reason": "evaluation timed out"}


def _ok_result() -> dict:
    return {"verdict": "allow", "confidence": 0.9, "categories": [],
            "reason": None, "evaluator_type": "deterministic",
            "failure_kind": None, "latency_ms": 1.0}


def test_repeat_interval_ttl_and_bucket(db: Session, user_factory) -> None:
    from tollms.services.cache.manager import cache_get_sync

    user = user_factory()
    policy = _policy(db, uuid.UUID(user["id"]), "Repeat5", notify_repeat_minutes=5)
    assert notify_engine.notify_trigger(db, policy, "warned", _warn_result()) is True
    assert notify_engine.notify_trigger(db, policy, "warned", _warn_result()) is False
    bucket = str(int(time.time()) // 300)
    key = f"guardrail:notify:{policy.id}:{bucket}"
    assert cache_get_sync(key) == "1"


def test_default_sixty_keeps_hourly_key(db: Session, user_factory) -> None:
    from datetime import datetime, timezone

    from tollms.services.cache.manager import cache_get_sync

    user = user_factory()
    policy = _policy(db, uuid.UUID(user["id"]), "Hourly")
    assert notify_engine.notify_trigger(db, policy, "warned", _warn_result()) is True
    hour = datetime.now(timezone.utc).strftime("%Y%m%d%H")
    assert cache_get_sync(f"guardrail:notify:{policy.id}:{hour}") == "1"


def test_email_ttl_capped_by_short_repeat(db: Session, user_factory) -> None:
    from tollms.services.cache.manager import cache_get_sync, call_sync, get_manager

    async def _ttl(key: str):
        client = await get_manager().resolved_client()
        return await client.ttl(key)

    user = user_factory()
    policy = _policy(db, uuid.UUID(user["id"]), "Short1", notify_repeat_minutes=1)
    assert notify_engine.notify_trigger(db, policy, "warned", _warn_result()) is True
    assert cache_get_sync(f"guardrail:email:{policy.id}") == "1"
    assert call_sync(_ttl(f"guardrail:email:{policy.id}")) <= 60
    user2 = user_factory(email="s2@tollma.ai")
    policy2 = _policy(db, uuid.UUID(user2["id"]), "LongE", notify_repeat_minutes=60)
    assert notify_engine.notify_trigger(db, policy2, "warned", _warn_result()) is True
    assert call_sync(_ttl(f"guardrail:email:{policy2.id}")) <= 300


def test_recovery_fires_once_then_clears(db: Session, user_factory) -> None:
    from tollms.models.organization import Notification
    from tollms.services.cache.manager import cache_get_sync, cache_set_sync

    user = user_factory()
    uid = uuid.UUID(user["id"])
    policy = _policy(db, uuid.UUID(user["id"]), "Flaky")
    cache_set_sync(f"guardrail:failing:{policy.id}", "1", ttl=86400)
    result = {"verdict": "allow", "confidence": 0.9, "categories": [],
              "reason": None, "evaluator_type": "deterministic",
              "failure_kind": None, "latency_ms": 1.0}
    enforcement_engine._aftermath(db, policy, result, "allowed", stage="post",
                                 user_id=uid, org_id=None, provider_id=None,
                                 model_id=None, api_key_id=None, source="internal",
                                 endpoint="chat", request_id=None, generation_id=None)
    db.expire_all()
    assert db.query(Notification).filter(
        Notification.user_id == uid,
        Notification.kind == "guardrail.recovered").count() == 1
    assert cache_get_sync(f"guardrail:failing:{policy.id}") is None
    enforcement_engine._aftermath(db, policy, result, "allowed", stage="post",
                                 user_id=uid, org_id=None, provider_id=None,
                                 model_id=None, api_key_id=None, source="internal",
                                 endpoint="chat", request_id=None, generation_id=None)
    db.expire_all()
    assert db.query(Notification).filter(
        Notification.user_id == uid,
        Notification.kind == "guardrail.recovered").count() == 1


def test_recovery_never_on_warn(db: Session, user_factory) -> None:
    from tollms.models.organization import Notification
    from tollms.services.cache.manager import cache_get_sync, cache_set_sync

    user = user_factory()
    uid = uuid.UUID(user["id"])
    policy = _policy(db, uuid.UUID(user["id"]), "NoRec")
    cache_set_sync(f"guardrail:failing:{policy.id}", "1", ttl=86400)
    enforcement_engine._aftermath(db, policy, _warn_result(), "warned", stage="pre",
                                 user_id=uid, org_id=None, provider_id=None,
                                 model_id=None, api_key_id=None, source="internal",
                                 endpoint="chat", request_id=None, generation_id=None)
    db.expire_all()
    assert db.query(Notification).filter(
        Notification.kind == "guardrail.recovered").count() == 0
    assert cache_get_sync(f"guardrail:failing:{policy.id}") == "1"


def test_notified_flag_set_and_dedupe_clean(db: Session, user_factory) -> None:
    from tollms.models.guardrail import GuardrailTrigger

    user = user_factory()
    uid = uuid.UUID(user["id"])
    policy = _policy(db, uuid.UUID(user["id"]), "Flagged", log_triggers=True)
    enforcement_engine._aftermath(db, policy, _warn_result(), "warned", stage="pre",
                                 user_id=uid, org_id=None, provider_id=None,
                                 model_id=None, api_key_id=None, source="internal",
                                 endpoint="chat", request_id=None, generation_id=None)
    db.expire_all()
    rows = db.query(GuardrailTrigger).filter(
        GuardrailTrigger.policy_id == policy.id).order_by(
            GuardrailTrigger.created_at).all()
    assert len(rows) == 1 and rows[0].notified is True
    enforcement_engine._aftermath(db, policy, _warn_result(), "warned", stage="pre",
                                 user_id=uid, org_id=None, provider_id=None,
                                 model_id=None, api_key_id=None, source="internal",
                                 endpoint="chat", request_id=None, generation_id=None)
    db.expire_all()
    rows = db.query(GuardrailTrigger).filter(
        GuardrailTrigger.policy_id == policy.id).order_by(
            GuardrailTrigger.created_at).all()
    assert len(rows) == 2 and rows[1].notified is False


def test_failing_flag_set_on_failure_notify(db: Session, user_factory) -> None:
    from tollms.services.cache.manager import cache_get_sync

    user = user_factory()
    policy = _policy(db, uuid.UUID(user["id"]), "FailFlag")
    assert notify_engine.notify_trigger(db, policy, "warned", _fail_result()) is True
    assert cache_get_sync(f"guardrail:failing:{policy.id}") == "1"


def test_policy_repeat_validation(client, user_factory) -> None:
    from fastapi.testclient import TestClient

    user_factory()
    r = client.post("/api/v1/guardrails",
                    json={"name": "Bad", "notify_repeat_minutes": 0})
    assert r.status_code == 422, r.text
    r = client.post("/api/v1/guardrails",
                    json={"name": "Bad2", "notify_repeat_minutes": 1441})
    assert r.status_code == 422, r.text
    r = client.post("/api/v1/guardrails",
                    json={"name": "Good", "notify_repeat_minutes": 5})
    assert r.status_code == 201, r.text
    assert r.json()["notify_repeat_minutes"] == 5
    pid = r.json()["id"]
    assert client.get(f"/api/v1/guardrails/{pid}").json()["notify_repeat_minutes"] == 5
    r = client.patch(f"/api/v1/guardrails/{pid}", json={"notify_repeat_minutes": 10})
    assert r.status_code == 200 and r.json()["notify_repeat_minutes"] == 10
