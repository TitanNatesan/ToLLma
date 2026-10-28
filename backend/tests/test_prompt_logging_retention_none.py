"""retention_days None = keep forever: upsert contract, capture, expiry, purge."""

import uuid
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from tollms.models.prompt_logging import PromptLog
from tollms.services.prompt_logging import capture as capture_engine
from tollms.services.prompt_logging import retention as retention_engine

PL = "/api/v1/prompt-logs"


def _enable(client: TestClient, **kw) -> dict:
    body = {"enabled": True, "mode": "global", "capture_input": True,
            "capture_output": True, **kw}
    r = client.put(f"{PL}/settings", json=body)
    assert r.status_code == 200, r.text
    return r.json()


def test_upsert_null_persists_and_omitted_keeps(client: TestClient, user_factory) -> None:
    user_factory()
    assert _enable(client)["retention_days"] == 90  # create default

    assert _enable(client, retention_days=None)["retention_days"] is None
    assert client.get(f"{PL}/settings").json()["retention_days"] is None

    # Absent key = update keeps the existing None.
    assert _enable(client)["retention_days"] is None

    # Absent key keeps a numeric value too.
    assert _enable(client, retention_days=30)["retention_days"] == 30
    assert _enable(client)["retention_days"] == 30


def test_upsert_invalid_still_422(client: TestClient, user_factory) -> None:
    user_factory()
    assert client.put(f"{PL}/settings", json={"retention_days": 0}).status_code == 422
    assert client.put(f"{PL}/settings", json={"retention_days": 4000}).status_code == 422


def test_capture_none_never_expires(client: TestClient, db: Session, user_factory) -> None:
    user = user_factory()
    uid = uuid.UUID(user["id"])
    _enable(client, retention_days=None)
    row = capture_engine.capture_post(
        db, input_text="keep-in", output_text="keep-out", user_id=uid,
        endpoint="chat", source="internal", request_id="r-keep", status="completed")
    assert row is not None and row.expires_at is None

    assert retention_engine.due_count(db) == 0
    assert retention_engine.expire_due_logs(db) == 0
    db.refresh(row)
    assert row.content_expired is False
    assert row.input_cipher is not None and row.output_cipher is not None


def test_numbered_retention_still_expires(client: TestClient, db: Session,
                                         user_factory) -> None:
    user = user_factory()
    uid = uuid.UUID(user["id"])
    _enable(client, retention_days=30)
    row = capture_engine.capture_post(
        db, input_text="tmp-in", output_text="tmp-out", user_id=uid,
        endpoint="chat", source="internal", request_id="r-tmp", status="completed")
    assert row is not None and row.expires_at is not None
    past = datetime.now(timezone.utc) - timedelta(days=1)
    db.execute(PromptLog.__table__.update().where(
        PromptLog.id == row.id).values(expires_at=past))
    db.commit()
    assert retention_engine.due_count(db) == 1
    assert retention_engine.expire_due_logs(db) == 1


def test_retention_info_none_and_purge_still_works(client: TestClient, db: Session,
                                                  user_factory) -> None:
    user = user_factory()
    uid = uuid.UUID(user["id"])
    assert client.get(f"{PL}/retention").json()["effective_days"] == 90
    _enable(client, retention_days=None)
    assert client.get(f"{PL}/retention").json()["effective_days"] is None

    for i in range(2):
        row = capture_engine.capture_post(
            db, input_text=f"p-{i}", output_text=f"q-{i}", user_id=uid,
            endpoint="chat", source="internal", request_id=f"r-p{i}",
            status="completed")
        assert row is not None and row.expires_at is None
    r = client.post(f"{PL}/logs/purge", json={})
    assert r.status_code == 200 and r.json()["expired_count"] == 2
    rows = db.scalars(select(PromptLog)).all()
    assert all(row.content_expired and row.input_cipher is None for row in rows)
