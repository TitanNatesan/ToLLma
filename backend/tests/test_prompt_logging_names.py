"""Display enrichment: user email / provider / model names + int duration."""

import uuid

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session
from tollms.models.provider import Provider
from tollms.models.registered_model import AIModel
from tollms.services.prompt_logging import capture as capture_engine

PL = "/api/v1/prompt-logs"


def _enable_personal(client: TestClient) -> None:
    r = client.put(
        f"{PL}/settings",
        json={
            "enabled": True,
            "mode": "global",
            "capture_input": True,
            "capture_output": True,
        },
    )
    assert r.status_code == 200, r.text


def _mk_key(db: Session, owner_id: uuid.UUID):
    from tollms.models.api_key import ApiKey

    key = ApiKey(
        user_id=owner_id,
        org_id=None,
        name=f"k-{uuid.uuid4().hex[:6]}",
        key_prefix=f"p-{uuid.uuid4().hex[:8]}",
        key_hash=uuid.uuid4().hex * 2,
    )
    db.add(key)
    db.flush()
    return key


def test_names_present_and_duration_int(
    client: TestClient, db: Session, user_factory, provider_factory, model_factory
) -> None:
    user = user_factory()
    uid = uuid.UUID(user["id"])
    _enable_personal(client)
    key = _mk_key(db, uid)
    provider = provider_factory("Name P")
    model = model_factory(provider["id"], model_id="display-x-1")
    row = capture_engine.capture_post(
        db,
        input_text="in",
        output_text="out",
        user_id=uid,
        api_key_id=uuid.UUID(key.id) if isinstance(key.id, str) else key.id,
        provider_id=uuid.UUID(provider["id"]),
        model_id=uuid.UUID(model["id"]),
        endpoint="chat",
        source="internal",
        request_id="names-1",
        status="completed",
        latency_ms=4803.219999999999,
    )
    assert row is not None

    items = client.get(f"{PL}/logs").json()["items"]
    assert len(items) == 1
    item = items[0]
    assert item["user_email"] == user["email"]
    assert item["provider_name"] == provider["name"]
    assert item["model_name"] == "display-x-1"
    assert item["key_name"] == key.name
    assert item["duration_ms"] == 4803 and isinstance(item["duration_ms"], int)
    assert item["latency_ms"] == 4803.219999999999

    detail = client.get(f"{PL}/logs/{row.id}").json()
    assert detail["user_email"] == user["email"]
    assert detail["provider_name"] == provider["name"]
    assert detail["model_name"] == "display-x-1"
    assert detail["duration_ms"] == 4803 and isinstance(detail["duration_ms"], int)


def test_names_none_safe_on_soft_delete(
    client: TestClient, db: Session, user_factory, provider_factory, model_factory
) -> None:
    user = user_factory()
    uid = uuid.UUID(user["id"])
    _enable_personal(client)
    key = _mk_key(db, uid)
    provider = provider_factory("Soft P")
    model = model_factory(provider["id"], model_id="display-soft-1")
    row = capture_engine.capture_post(
        db,
        input_text="in",
        output_text="out",
        user_id=uid,
        api_key_id=uuid.UUID(key.id) if isinstance(key.id, str) else key.id,
        provider_id=uuid.UUID(provider["id"]),
        model_id=uuid.UUID(model["id"]),
        endpoint="chat",
        source="internal",
        request_id="names-soft",
        status="completed",
        latency_ms=10.6,
    )
    assert row is not None

    db.scalar(select(1))
    key.is_deleted = True
    db.get(Provider, uuid.UUID(provider["id"])).is_deleted = True
    db.get(AIModel, uuid.UUID(model["id"])).is_deleted = True
    db.commit()

    item = client.get(f"{PL}/logs").json()["items"][0]
    assert item["key_name"] is None
    assert item["provider_name"] is None
    assert item["model_name"] is None
    # user untouched: still resolves
    assert item["user_email"] == user["email"]
    assert item["duration_ms"] == 11 and isinstance(item["duration_ms"], int)

    detail = client.get(f"{PL}/logs/{row.id}").json()
    assert detail["key_name"] is None
    assert detail["provider_name"] is None
    assert detail["model_name"] is None
    assert detail["user_email"] == user["email"]

    # soft-deleted user falls back to None (service-level: auth would block API)
    from tollms.api.prompt_logging import records as recs
    from tollms.models.user import User

    db.get(User, uid).is_deleted = True
    db.commit()
    items, _ = recs.list_logs(db, uid)
    assert items[0].user_email is None
    got = recs.get_log_detail(db, uid, row.id, None)
    assert got.user_email is None
