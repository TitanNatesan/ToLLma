"""Async non-blocking capture: bounded queue, worker, idempotency, failures.

The worker is explicitly started with a test-bound factory (lifespan skips
it under pytest); when it is not running, enqueue falls back to a sync
insert so captures are never lost.
"""

import threading
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from tollms.models.prompt_logging import MAX_BODY_CHARS, PromptLog
from tollms.services.prompt_logging import capture as capture_engine
from tollms.services.prompt_logging import queue as promptlog_queue
from tests.test_prompt_logging import _enable_personal


@pytest.fixture()
def _queue_db(db: Session):
    maker = sessionmaker(bind=db.get_bind())
    promptlog_queue.configure(maker)
    promptlog_queue.reset_stats()
    promptlog_queue.start_for_tests()
    yield db
    promptlog_queue.stop()
    promptlog_queue.configure(None)
    promptlog_queue.reset_stats()


def _uid(user: dict):
    return uuid.UUID(user["id"])


def _payload(db, **kw):
    kw.setdefault("input_text", "in")
    kw.setdefault("output_text", "out")
    return kw


def test_enqueue_flush_roundtrip(client: TestClient, db: Session, user_factory,
                                 _queue_db: Session) -> None:
    from tollms.api.prompt_logging.settings import decrypt_body

    user = user_factory()
    uid = _uid(user)
    _enable_personal(client)
    assert promptlog_queue.enqueue_post(
        db, input_text="hello in", output_text="hello out", user_id=uid,
        endpoint="chat", source="internal", request_id=f"q-{uuid.uuid4().hex[:8]}",
        status="completed") == "queued"
    assert promptlog_queue.flush() is True
    rows = list(db.scalars(select(PromptLog)))
    assert len(rows) == 1
    assert decrypt_body(rows[0].input_cipher) == "hello in"
    assert decrypt_body(rows[0].output_cipher) == "hello out"
    stats = promptlog_queue.stats()
    assert stats["enqueued"] == 1 and stats["duplicates"] == 0
    assert stats["queue_depth"] == 0 and stats["last_error"] is None


def test_disabled_enqueues_nothing(client: TestClient, db: Session, user_factory,
                                   _queue_db: Session) -> None:
    user = user_factory()
    uid = _uid(user)
    assert promptlog_queue.enqueue_post(
        db, input_text="in", output_text="out", user_id=uid,
        request_id=f"q-{uuid.uuid4().hex[:8]}") == "skipped"
    assert promptlog_queue.flush() is True
    assert promptlog_queue.stats()["enqueued"] == 0
    assert list(db.scalars(select(PromptLog))) == []


def test_oversized_truncated_before_enqueue(client: TestClient, db: Session, user_factory,
                                            _queue_db: Session) -> None:
    from tollms.api.prompt_logging.settings import decrypt_body

    user = user_factory()
    uid = _uid(user)
    _enable_personal(client)
    big = "x" * (MAX_BODY_CHARS + 100)
    assert promptlog_queue.enqueue_post(
        db, input_text=big, output_text="ok", user_id=uid,
        request_id=f"q-{uuid.uuid4().hex[:8]}") == "queued"
    assert promptlog_queue.flush() is True
    row = db.scalars(select(PromptLog)).one()
    assert row.input_truncated is True and row.input_chars == MAX_BODY_CHARS + 100
    assert decrypt_body(row.input_cipher) == big[:MAX_BODY_CHARS]


def test_duplicate_delivery_suppressed(client: TestClient, db: Session, user_factory,
                                       _queue_db: Session) -> None:
    user = user_factory()
    uid = _uid(user)
    _enable_personal(client)
    gid = uuid.uuid4()
    rid = f"q-{uuid.uuid4().hex[:8]}"
    for _ in range(2):
        assert promptlog_queue.enqueue_post(
            db, input_text="in", output_text="out", user_id=uid,
            request_id=rid, generation_id=gid) == "queued"
    assert promptlog_queue.flush() is True
    db.expire_all()
    assert db.scalar(select(func.count()).select_from(PromptLog)) == 1
    assert promptlog_queue.stats()["duplicates"] == 1


def test_queue_full_drops_with_metric(client: TestClient, db: Session, user_factory,
                                      _queue_db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    user = user_factory()
    uid = _uid(user)
    _enable_personal(client)
    gate = threading.Event()
    taken = threading.Event()
    real_insert = promptlog_queue._insert  # noqa: SLF001

    def _blocked(payload):
        taken.set()
        gate.wait(10)
        return real_insert(payload)

    monkeypatch.setattr(promptlog_queue, "_insert", _blocked)
    # Occupy the single worker thread first: once it holds item #1 it cannot
    # consume further, so the fill below is race-free.
    assert promptlog_queue.enqueue_post(
        db, input_text="a", output_text="b", user_id=uid,
        request_id=f"q-{uuid.uuid4().hex[:8]}") == "queued"
    assert taken.wait(10)
    promptlog_queue._queue.maxsize = 2  # noqa: SLF001
    try:
        rids = [f"q-{uuid.uuid4().hex[:8]}" for _ in range(3)]
        assert promptlog_queue.enqueue_post(
            db, input_text="a", output_text="b", user_id=uid,
            request_id=rids[0]) == "queued"
        assert promptlog_queue.enqueue_post(
            db, input_text="a", output_text="b", user_id=uid,
            request_id=rids[1]) == "queued"
        assert promptlog_queue.enqueue_post(
            db, input_text="a", output_text="b", user_id=uid,
            request_id=rids[2]) == "dropped"
    finally:
        promptlog_queue._queue.maxsize = promptlog_queue.MAXSIZE  # noqa: SLF001
        gate.set()
    assert promptlog_queue.flush(15) is True
    assert promptlog_queue.stats()["dropped_full"] == 1


def test_worker_db_down_drops_and_generation_survives(
        client: TestClient, db: Session, user_factory, provider_factory,
        model_factory, monkeypatch: pytest.MonkeyPatch, _queue_db: Session) -> None:
    from tollms.api.gateway import service as chat_service
    from tollms.api.gateway.schemas import ChatRequest
    from tests.test_prompt_logging_hooks import _FakeChatAdapter, _bind_chat, _make_key

    user = user_factory()
    uid = _uid(user)
    p = provider_factory("QDown")
    m = model_factory(p["id"])
    _, kid = _make_key(client)
    _bind_chat(monkeypatch, _FakeChatAdapter([]))
    client.put("/api/v1/prompt-logs/settings",
               json={"enabled": True, "capture_input": True, "capture_output": True})

    def _broken():
        raise RuntimeError("db down")

    promptlog_queue.configure(_broken)

    import asyncio

    result = asyncio.run(chat_service.run_chat(
        db, ChatRequest(provider_id=uuid.UUID(p["id"]), model_id=uuid.UUID(m["id"]),
                        message="hook input", key_id=uuid.UUID(kid)),
        None, user_id=uid))
    assert result.content == "Hello world"  # generation still 200
    assert promptlog_queue.flush(15) is True
    stats = promptlog_queue.stats()
    assert stats["dropped_error"] >= 1 and stats["last_error"]
    assert stats["last_error"] == "RuntimeError"
    assert "db down" not in (stats["last_error"] or "")  # code only, no raw text
    assert "hello" not in (stats["last_error"] or "").lower()  # no content in errors
    assert list(db.scalars(select(PromptLog))) == []


def test_worker_restart_drains(client: TestClient, db: Session, user_factory,
                               _queue_db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    user = user_factory()
    uid = _uid(user)
    _enable_personal(client)
    gate = threading.Event()
    real_insert = promptlog_queue._insert  # noqa: SLF001

    def _blocked(payload):
        gate.wait(10)
        return real_insert(payload)

    monkeypatch.setattr(promptlog_queue, "_insert", _blocked)
    for i in range(3):
        assert promptlog_queue.enqueue_post(
            db, input_text=f"in-{i}", output_text="out", user_id=uid,
            request_id=f"q-restart-{i}-{uuid.uuid4().hex[:4]}") == "queued"
    gate.set()  # let the blocked worker finish, then stop and restart it
    promptlog_queue.stop()
    assert promptlog_queue.running() is False
    promptlog_queue.start_for_tests()
    assert promptlog_queue.flush(15) is True
    db.expire_all()
    assert db.scalar(select(func.count()).select_from(PromptLog)) == 3


def test_inline_fallback_when_worker_down(client: TestClient, db: Session,
                                          user_factory) -> None:
    """Worker not running (no explicit start): enqueue persists synchronously."""
    from tollms.api.prompt_logging.settings import decrypt_body

    assert promptlog_queue.running() is False
    user = user_factory()
    uid = _uid(user)
    _enable_personal(client)
    assert promptlog_queue.enqueue_post(
        db, input_text="sync-in", output_text="sync-out", user_id=uid,
        request_id=f"q-{uuid.uuid4().hex[:8]}") == "stored"
    row = db.scalars(select(PromptLog)).one()
    assert decrypt_body(row.input_cipher) == "sync-in"


def test_emit_gauge_and_retention_fields(client: TestClient, db: Session, user_factory,
                                         _queue_db: Session) -> None:
    user_factory()
    _enable_personal(client)
    body = client.get("/api/v1/prompt-logs/retention").json()
    assert body["queue_depth"] == 0 and body["last_error"] is None


def test_capture_sync_bridge_kept(client: TestClient, db: Session, user_factory) -> None:
    user = user_factory()
    uid = _uid(user)
    _enable_personal(client)
    assert capture_engine.capture_post_sync(
        db, input_text="x", output_text="y", user_id=uid,
        request_id=f"q-{uuid.uuid4().hex[:8]}") == "stored"
    assert db.scalar(select(func.count()).select_from(PromptLog)) == 1
