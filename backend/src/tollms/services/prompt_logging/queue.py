"""Prompt-log async capture: bounded in-memory queue + background worker.

Policy resolution + truncation + encryption stay synchronous (cheap) at
enqueue time via ``capture.build_row_kwargs`` — each item is a fully
encrypted, immutable payload, so raw credentials/content never cross
threads and the worker only persists. Persistence runs on a single
background worker thread with its own Sessions: 1 retry, then drop +
metric (fail-open — generation paths never block on the ledger).

Idempotency: the ``uq_prompt_logs_request_delivery`` partial unique index
(request_id, generation_id) collapses redeliveries — the worker counts
IntegrityErrors as duplicate-suppressed, never re-raises.

When the worker is not running (tests without an explicit start, or a dead
worker), ``enqueue_post`` falls back to a synchronous ``capture_post`` on
the caller's Session so no capture is lost — fail-open, never fail-silent.
"""

import logging
import os
import queue as stdlib_queue
import threading
import time
from typing import Any

from sqlalchemy.exc import IntegrityError

logger = logging.getLogger(__name__)

MAXSIZE = 1000

_lock = threading.RLock()  # stats() nests running(); must be reentrant
_queue: stdlib_queue.Queue = stdlib_queue.Queue(maxsize=MAXSIZE)
_worker: threading.Thread | None = None
_stop = threading.Event()
_session_factory: Any | None = None

_enqueued = 0
_dropped_full = 0
_dropped_error = 0
_duplicates = 0
_last_error: str | None = None


def _default_factory() -> Any:
    from tollms.db.session import SessionLocal

    return SessionLocal()


def configure(session_factory: Any | None = None) -> None:
    """Test seam: override the worker's session factory (None = default)."""
    global _session_factory
    with _lock:
        _session_factory = session_factory


def _factory() -> Any:
    with _lock:
        maker = _session_factory
    if maker is not None:
        return maker()
    return _default_factory()


def running() -> bool:
    with _lock:
        return _worker is not None and _worker.is_alive()


def _insert(payload: dict[str, Any]) -> str:
    """Persist one payload: 1 retry, then drop. Returns stored|duplicate|error."""
    global _dropped_error, _duplicates, _last_error
    from tollms.models.prompt_logging import PromptLog

    for attempt in (1, 2):
        db = None
        try:
            db = _factory()
            db.add(PromptLog(**payload))
            db.commit()
            return "stored"
        except IntegrityError:
            try:
                db.rollback()
            except Exception:
                pass
            with _lock:
                _duplicates += 1
            try:
                from tollms.services.observability.events import incr_counter

                incr_counter("gateway.promptlog.duplicate")
            except Exception:
                pass
            return "duplicate"
        except Exception as exc:
            if db is not None:
                try:
                    db.rollback()
                except Exception:
                    pass
            if attempt == 1:
                continue
            with _lock:
                _dropped_error += 1
                # Error code only — never raw DB exception text (no payload,
                # no driver message in the API surface).
                _last_error = type(exc).__name__
            try:
                from tollms.services.observability.events import incr_counter

                incr_counter("gateway.promptlog.dropped", {"reason": "error"})
            except Exception:
                pass
            logger.warning(
                "promptlog queue dropped item request_id=%s generation_id=%s: %s",
                payload.get("request_id"), payload.get("generation_id"),
                _last_error, exc_info=True)
            return "error"
        finally:
            if db is not None:
                try:
                    db.close()
                except Exception:
                    logger.warning("promptlog queue session close failed", exc_info=True)
    return "error"


def _loop() -> None:
    while True:
        if _stop.is_set() and _queue.empty():
            return
        try:
            payload = _queue.get(timeout=0.2)
        except stdlib_queue.Empty:
            continue
        try:
            _insert(payload)
        finally:
            _queue.task_done()


def start() -> None:
    """Start the background worker. Idempotent; skipped under pytest (tests
    start it explicitly with a test-bound factory)."""
    global _worker
    if os.getenv("PYTEST_CURRENT_TEST"):
        return
    with _lock:
        if _worker is not None and _worker.is_alive():
            return
        _stop.clear()
        _worker = threading.Thread(target=_loop, name="promptlog-queue", daemon=True)
        _worker.start()


def start_for_tests() -> None:
    """Start the worker regardless of PYTEST_CURRENT_TEST (tests only)."""
    global _worker
    with _lock:
        if _worker is not None and _worker.is_alive():
            return
        _stop.clear()
        _worker = threading.Thread(target=_loop, name="promptlog-queue", daemon=True)
        _worker.start()


def stop(timeout_s: float = 10.0) -> None:
    """Stop the worker after draining queued items (best-effort timeout)."""
    global _worker
    with _lock:
        worker = _worker
    if worker is None:
        return
    _stop.set()
    worker.join(timeout_s if timeout_s > 0 else None)
    with _lock:
        if not worker.is_alive():
            _worker = None


def flush(timeout_s: float = 10.0) -> bool:
    """Block until queued items are persisted (deterministic tests)."""
    deadline = time.monotonic() + timeout_s
    while True:
        if _queue.unfinished_tasks <= 0:
            return True
        if time.monotonic() >= deadline:
            return False
        time.sleep(0.05)


def reset_stats() -> None:
    """Zero counters (tests only). Does not touch queued items."""
    global _enqueued, _dropped_full, _dropped_error, _duplicates, _last_error
    with _lock:
        _enqueued = 0
        _dropped_full = 0
        _dropped_error = 0
        _duplicates = 0
        _last_error = None


def stats() -> dict[str, Any]:
    with _lock:
        return {
            "queue_depth": _queue.qsize(),
            "last_error": _last_error,
            "enqueued": _enqueued,
            "dropped_full": _dropped_full,
            "dropped_error": _dropped_error,
            "duplicates": _duplicates,
            "running": running(),
        }


def enqueue_post(db: Any, **kwargs: Any) -> str:
    """Non-blocking capture: resolve + encrypt now, persist in the worker.

    Returns queued|stored (inline fallback when the worker is down) |
    skipped (policy) | dropped (queue full — counter + warning, no secrets).
    Never raises.
    """
    global _enqueued, _dropped_full
    try:
        from tollms.services.prompt_logging import capture as capture_engine

        payload = capture_engine.build_row_kwargs(db, **kwargs)
        if payload is None:
            return "skipped"
        if not running():
            row = capture_engine.capture_post(db, **kwargs)
            return "stored" if row is not None else "skipped"
        try:
            _queue.put_nowait(payload)
        except stdlib_queue.Full:
            with _lock:
                _dropped_full += 1
            try:
                from tollms.services.observability.events import incr_counter

                incr_counter("gateway.promptlog.dropped", {"reason": "full"})
            except Exception:
                pass
            # Ids/status only — the payload holds ciphers, never log it.
            logger.warning(
                "promptlog queue full (depth=%d): dropped request_id=%s status=%s",
                _queue.qsize(), payload.get("request_id"), payload.get("status"))
            return "dropped"
        with _lock:
            _enqueued += 1
        try:
            from tollms.services.observability.events import emit, incr_counter

            emit("gateway.promptlog.enqueued", depth=_queue.qsize(),
                 status=str(payload.get("status") or "unknown"),
                 source=str(payload.get("source") or "unknown"))
            incr_counter("gateway.promptlog.enqueued")
        except Exception:
            pass
        return "queued"
    except Exception:
        logger.warning("promptlog enqueue failed (fail-open)", exc_info=True)
        return "skipped"
