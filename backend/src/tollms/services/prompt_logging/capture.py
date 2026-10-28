"""Prompt-log capture: one immutable row per generation, fail-open always.

Never raises, never touches Valkey usage counters, never writes content to
app logs. Bodies are Fernet-encrypted (core/crypto); metadata rows persist
even when both capture flags are off or the conversation is disabled.
"""

import logging
import time
import uuid
from collections.abc import Mapping
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy.orm import Session

from tollms.core.crypto import encrypt
from tollms.models.prompt_logging import MAX_BODY_CHARS, STATUSES, PromptLog
from tollms.services.prompt_logging import resolution as resolution_engine

logger = logging.getLogger(__name__)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _clip(text: str | None) -> tuple[str, bool]:
    """(bounded text, truncated flag). Lengths are measured pre-clip."""
    body = text or ""
    if len(body) > MAX_BODY_CHARS:
        return body[:MAX_BODY_CHARS], True
    return body, False


def build_row_kwargs(
    db: Session,
    *,
    input_text: str | None,
    output_text: str | None,
    user_id: uuid.UUID | None,
    org_id: uuid.UUID | None = None,
    api_key_id: uuid.UUID | None = None,
    key_provenance: str | None = None,
    provider_id: uuid.UUID | None = None,
    model_id: uuid.UUID | None = None,
    conversation_id: uuid.UUID | None = None,
    endpoint: str = "",
    source: str = "internal",
    request_id: str | None = None,
    generation_id: uuid.UUID | None = None,
    status: str = "completed",
    tokens: Mapping[str, int] | None = None,
    latency_ms: float | None = None,
    error_code: str | None = None,
    allow_store: bool = True,
) -> dict[str, Any] | None:
    """Policy resolution + truncation + encryption, synchronously.

    Returns immutable, fully-encrypted ``PromptLog`` kwargs, or None when
    skipped (disabled, out-of-scope, allow_store False). Never touches the
    DB beyond policy reads and never raises (fail-closed to None). Shared by
    the sync writer and the async queue (which encrypts at enqueue so the
    worker only persists — raw credentials/content never cross threads)."""
    try:
        if not allow_store:
            return None
        resolved = resolution_engine.resolve_setting(
            db, user_id=user_id, org_id=org_id, api_key_id=api_key_id,
            key_provenance=key_provenance,
        )
        setting = resolved.setting
        if setting is None:
            return None
        now = _utcnow()
        bounded_in, in_truncated = _clip(input_text)
        bounded_out, out_truncated = _clip(output_text)
        return dict(
            workspace_type=(
                "organization" if setting.org_id is not None else "personal"
            ),
            user_id=user_id,
            org_id=setting.org_id,
            api_key_id=api_key_id,
            key_provenance=(
                "organization" if setting.org_id is not None else "personal"
            ),
            team_ids=list(resolved.team_ids or []),
            # Which allow-list leg matched (global|team|key). Only rows
            # written before key targets existed carry NULL.
            match_source=resolved.match_source,
            conversation_id=conversation_id,
            provider_id=provider_id,
            model_id=model_id,
            endpoint=(endpoint or "")[:64],
            source=source if source in ("internal", "external") else "internal",
            request_id=(request_id or "")[:128] or None,
            generation_id=generation_id,
            status=status if status in STATUSES else "failed",
            input_cipher=encrypt(bounded_in) if setting.capture_input and bounded_in else None,
            output_cipher=encrypt(bounded_out) if setting.capture_output and bounded_out else None,
            input_truncated=in_truncated,
            output_truncated=out_truncated,
            input_chars=len(input_text or ""),
            output_chars=len(output_text or ""),
            prompt_tokens=(tokens.get("prompt") if tokens else None),
            completion_tokens=(tokens.get("completion") if tokens else None),
            latency_ms=latency_ms,
            error_code=(error_code or "")[:64] or None,
            policy_version=setting.version or 1,
            content_expired=False,
            expires_at=(None if setting.retention_days is None
                          else now + timedelta(days=max(1, setting.retention_days))),
        )
    except Exception:
        # Resolution/encryption failure — never content in app logs.
        logger.warning("promptlog build failed", exc_info=True)
        return None


def capture_post(db: Session, **kwargs: Any) -> PromptLog | None:
    """Write one immutable row honoring the resolved policy. Returns the row,
    or None when skipped (disabled, out-of-scope, allow_store False)."""
    try:
        row_kwargs = build_row_kwargs(db, **kwargs)
        if row_kwargs is None:
            return None
        row = PromptLog(**row_kwargs)
        db.add(row)
        db.commit()
        try:
            from tollms.services.observability.events import emit, incr_counter

            emit("gateway.promptlog", status=row.status, source=row.source)
            incr_counter("gateway.promptlog", {"status": row.status})
        except Exception:
            pass
        return row
    except Exception:
        try:
            db.rollback()
        except Exception:
            pass
        # Operational error only — content never reaches app logs.
        logger.warning("promptlog capture failed", exc_info=True)
        return None


def _run_isolated(coro_factory: Any, db: Session, timeout_s: float) -> Any:
    """Worker thread + fresh Session on the same bind (mirrors the guardrail
    sync bridge: the caller's Session never leaves its thread)."""
    import asyncio
    import threading

    try:
        bind = db.get_bind()
    except Exception:
        bind = None
    outcome: dict[str, Any] = {}

    def _target() -> None:
        fresh = Session(bind=bind) if bind is not None else Session()
        try:
            outcome["result"] = asyncio.run(coro_factory(fresh))
        except BaseException as exc:  # noqa: BLE001 — re-raised on caller thread
            outcome["error"] = exc
        finally:
            try:
                fresh.close()
            except Exception:
                logger.warning("promptlog worker session close failed", exc_info=True)

    worker = threading.Thread(target=_target, name="promptlog-sync", daemon=True)
    worker.start()
    worker.join(timeout_s)
    if worker.is_alive():
        raise TimeoutError("promptlog worker timed out")
    if "error" in outcome:
        raise outcome["error"]
    return outcome.get("result")


async def _capture_async(db: Session, kwargs: dict[str, Any]) -> PromptLog | None:
    return capture_post(db, **kwargs)


def _capture_fresh(bind: Any, params: dict[str, Any]) -> PromptLog | None:
    """capture_post on a thread-local Session (the caller's Session never
    leaves its thread — SQLAlchemy Sessions are not thread-safe)."""
    from sqlalchemy.orm import Session as _Session

    fresh = _Session(bind=bind) if bind is not None else _Session()
    try:
        return capture_post(fresh, **params)
    finally:
        try:
            fresh.close()
        except Exception:
            logger.warning("promptlog worker session close failed", exc_info=True)


async def capture_post_async(*args: Any, timeout_s: float = 12.0, **kwargs: Any) -> str:
    """Non-blocking hook for async gateway paths. The DB work runs in a
    worker thread (``asyncio.to_thread``) with a timeout; timeouts and errors
    fail open to 'skipped' so logging never breaks a generation."""
    import asyncio

    started = time.monotonic()
    try:
        if args:
            db, params = args[0], dict(kwargs)
        else:
            params = dict(kwargs)
            db = params.pop("db")
        try:
            bind = db.get_bind()
        except Exception:
            bind = None
        result = await asyncio.wait_for(
            asyncio.to_thread(_capture_fresh, bind, params), timeout=timeout_s
        )
        return "stored" if result is not None else "skipped"
    except Exception:
        logger.warning("promptlog async bridge failed (fail-open)", exc_info=True)
        return "skipped"
    finally:
        elapsed = (time.monotonic() - started) * 1000
        if elapsed > timeout_s * 1000:
            logger.warning("promptlog capture timed out after %.0fms", elapsed)


def capture_post_sync(*args: Any, timeout_s: float = 12.0, **kwargs: Any) -> str:
    """Sync wrapper for genuinely sync call sites (tests, sync hooks).
    Fail-open to 'skipped': worker/timeout or capture failures never break
    the generation — they return 'skipped'. Async callers must use
    ``capture_post_async`` instead (``worker.join`` here blocks the loop)."""
    started = time.monotonic()
    try:
        if args:
            db, params = args[0], dict(kwargs)
        else:
            params = dict(kwargs)
            db = params.pop("db")
        result = _run_isolated(lambda fresh: _capture_async(fresh, params), db, timeout_s)
        return "stored" if result is not None else "skipped"
    except Exception:
        logger.warning("promptlog sync bridge failed (fail-open)", exc_info=True)
        return "skipped"
    finally:
        elapsed = (time.monotonic() - started) * 1000
        if elapsed > timeout_s * 1000:
            logger.warning("promptlog capture timed out after %.0fms", elapsed)
