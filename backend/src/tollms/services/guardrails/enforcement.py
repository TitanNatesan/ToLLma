"""Pre/post enforcement hooks for the gateway planes. Sync entry points.

Pre runs inside _enforce_chat_key / _prepare (before rows + provider I/O):
blocks raise ForbiddenError, warns return a notice string (callers log it —
no response schema carries guardrail metadata, so warn never mutates the
contract). Post runs at terminal/cancel branches: audit-first, never raises,
never touches Valkey usage counters, writes GuardrailTrigger when the policy
opts into logging, and emits gateway.guardrail{action}.

Streaming limitation (documented, never silent): only non-streaming paths
with delivery_mode == buffer_then_inspect can withhold output (callers pass
allow_block=True). Streaming paths always deliver; a blocked post verdict is
still recorded as action=blocked (audit trail) and notified — the row says
what happened, nothing is downgraded.
"""

import logging
import time
import uuid
from typing import Any

from sqlalchemy.orm import Session

from tollms.core.exceptions import ForbiddenError
from tollms.services.guardrails import evaluation as evaluation_engine
from tollms.services.guardrails import resolution as resolution_engine

logger = logging.getLogger(__name__)

MAX_INPUT_CHARS = 32 * 1024


async def check_pre(
    db: Session,
    *,
    text: str,
    user_id: uuid.UUID | None,
    org_id: uuid.UUID | None = None,
    provider_id: uuid.UUID | None = None,
    model_id: uuid.UUID | None = None,
    api_key_id: uuid.UUID | None = None,
    source: str = "internal",
    endpoint: str | None = None,
    request_id: str | None = None,
    generation_id: uuid.UUID | None = None,
    ctx: dict[str, Any] | None = None,
) -> str | None:
    """Returns a warning notice when any applicable policy warns, else None.
    Raises ForbiddenError on the highest-severity blocking verdict (org
    mandatory-wins: no allow from another policy overrides a block)."""
    resolved = resolution_engine.resolve_applicable(
        db, user_id=user_id, org_id=org_id, provider_id=provider_id,
        model_id=model_id, api_key_id=api_key_id, source=source,
    )
    blocked: list[tuple[Any, dict[str, Any]]] = []
    notices: list[str] = []
    for policy in resolved.applied:
        if not evaluation_engine.policy_allows_pre(policy):
            continue
        result = await evaluation_engine.evaluate_policy(
            db, policy, (text or "")[:MAX_INPUT_CHARS], stage="pre", ctx=ctx,
            llm_user_id=user_id)
        action = evaluation_engine.effective_action(policy, result)
        _aftermath(db, policy, result, action, stage="pre", user_id=user_id,
                   org_id=org_id, provider_id=provider_id, model_id=model_id,
                   api_key_id=api_key_id, source=source, endpoint=endpoint,
                   request_id=request_id, generation_id=generation_id)
        if action == "blocked":
            blocked.append((policy, result))
        elif action == "warned":
            notices.append(
                f"guardrail {policy.name}: "
                f"{(result.get('categories') or ['warn'])[0]}"
            )
    if blocked:
        policy, result = max(blocked, key=lambda item: _severity_rank(item[0]))
        # Category-only: external/model reasons may echo secrets or prompt
        # text, so they never reach the 403 message (redacted copy persists).
        first_category = (result.get("categories") or ["blocked"])[0]
        raise ForbiddenError(f"guardrail_blocked: {policy.name}: {first_category}")
    if notices:
        notice = "; ".join(notices)[:500]
        logger.info("guardrail warn: %s", notice)
        return notice
    return None


async def record_post(
    db: Session,
    *,
    text: str,
    user_id: uuid.UUID | None,
    org_id: uuid.UUID | None = None,
    provider_id: uuid.UUID | None = None,
    model_id: uuid.UUID | None = None,
    api_key_id: uuid.UUID | None = None,
    source: str = "internal",
    endpoint: str | None = None,
    request_id: str | None = None,
    generation_id: uuid.UUID | None = None,
    allow_block: bool = False,
    ctx: dict[str, Any] | None = None,
) -> str:
    """Audit one output. Never raises. Returns the worst action so a
    non-streaming buffer_then_inspect caller can withhold delivery."""
    if not (text or "").strip():
        return "allowed"
    resolved = resolution_engine.resolve_applicable(
        db, user_id=user_id, org_id=org_id, provider_id=provider_id,
        model_id=model_id, api_key_id=api_key_id, source=source,
    )
    worst = "allowed"
    for policy in resolved.applied:
        if not evaluation_engine.policy_allows_post(policy):
            continue
        try:
            result = await evaluation_engine.evaluate_policy(
                db, policy, (text or "")[:MAX_INPUT_CHARS], stage="post", ctx=ctx,
            llm_user_id=user_id)
        except Exception:
            logger.warning("guardrail post evaluation failed", exc_info=True)
            continue
        action = evaluation_engine.effective_action(policy, result)
        if action == "blocked" and not _may_block_output(policy, allow_block):
            # Streaming/audit delivery: the bytes already went out, so the
            # caller cannot withhold them — but the audit row still records
            # the blocked verdict (never downgraded to warned/allowed).
            logger.warning(
                "guardrail post block unactionable (delivery=%s allow_block=%s): %s",
                policy.delivery_mode, allow_block, policy.name,
            )
        _aftermath(db, policy, result, action, stage="post", user_id=user_id,
                   org_id=org_id, provider_id=provider_id, model_id=model_id,
                   api_key_id=api_key_id, source=source, endpoint=endpoint,
                   request_id=request_id, generation_id=generation_id)
        if _action_rank(action) > _action_rank(worst):
            worst = action
    return worst


def _may_block_output(policy, allow_block: bool) -> bool:
    return bool(allow_block and (policy.delivery_mode or "") == "buffer_then_inspect")


def _aftermath(db: Session, policy, result: dict[str, Any], action: str, *,
               stage: str, user_id, org_id, provider_id, model_id, api_key_id,
               source: str, endpoint: str | None, request_id: str | None,
               generation_id: uuid.UUID | None) -> None:
    from tollms.services.guardrails import deterministic as det_engine
    from tollms.services.observability.events import emit, incr_counter

    emit("gateway.guardrail", action=action, policy=str(policy.id),
         stage=stage, source=source)
    incr_counter("gateway.guardrail", {"action": action})
    if not policy.log_triggers:
        return
    if action == "allowed" and not result.get("failure_kind"):
        # monitor is log-only: even clean allows leave an audit row.
        if (policy.enforcement or "").lower() != "monitor":
            # Clean allows leave no audit row, but a prior failure episode
            # still gets its one-shot recovery notice here.
            if getattr(policy, "notify_on_trigger", False):
                try:
                    from tollms.services.guardrails import notify as notify_engine

                    notify_engine.maybe_notify_recovery(db, policy)
                except Exception:
                    logger.warning("guardrail recovery notify failed", exc_info=True)
            return
    # Redact once, centrally: non-deterministic reasons may carry model or
    # external text (secrets, prompts). Deterministic kind-only reasons have
    # no secret shapes, so redaction leaves them unchanged.
    safe = dict(result)
    if safe.get("reason"):
        safe["reason"] = det_engine.redact_text(str(safe["reason"]))
    result = safe
    trigger_row = None
    try:
        trigger_row = _write_trigger(db, policy, result, action, stage=stage, user_id=user_id,
                                     org_id=org_id, provider_id=provider_id, model_id=model_id,
                                     api_key_id=api_key_id, source=source, endpoint=endpoint,
                                     request_id=request_id, generation_id=generation_id)
    except Exception:
        logger.warning("guardrail trigger write failed", exc_info=True)
    notified = False
    if policy.notify_on_trigger and (action in ("warned", "blocked") or result.get("failure_kind")):
        try:
            from tollms.services.guardrails import notify as notify_engine

            notified = bool(notify_engine.notify_trigger(db, policy, action, result))
        except Exception:
            logger.warning("guardrail notify failed", exc_info=True)
    if notified and trigger_row is not None:
        try:
            trigger_row.notified = True
            db.commit()
        except Exception:
            try:
                db.rollback()
            except Exception:
                pass
            logger.warning("guardrail notified stamp failed", exc_info=True)
    if (not result.get("failure_kind") and action == "allowed"
            and getattr(policy, "notify_on_trigger", False)):
        try:
            from tollms.services.guardrails import notify as notify_engine

            notify_engine.maybe_notify_recovery(db, policy)
        except Exception:
            logger.warning("guardrail recovery notify failed", exc_info=True)


def _write_trigger(db: Session, policy, result: dict[str, Any], action: str, *,
                   stage: str, user_id, org_id, provider_id, model_id, api_key_id,
                   source: str, endpoint: str | None, request_id: str | None,
                   generation_id: uuid.UUID | None) -> Any:
    from tollms.models.guardrail import GuardrailTrigger

    workspace = "organization" if (org_id is not None or policy.org_id is not None) else "personal"
    row = GuardrailTrigger(
        policy_id=policy.id,
        policy_version=policy.version or 1,
        workspace_type=workspace,
        user_id=user_id,
        org_id=org_id if org_id is not None else policy.org_id,
        request_id=(request_id or "")[:128] or None,
        generation_id=generation_id,
        endpoint=endpoint,
        source=source,
        api_key_id=api_key_id,
        provider_id=provider_id,
        model_id=model_id,
        evaluator_type=result.get("evaluator_type"),
        stage=stage,
        category=(result.get("categories") or [None])[0],
        severity=policy.severity,
        confidence=result.get("confidence"),
        enforcement=policy.enforcement,
        action=action,
        reason=(result.get("reason") or "")[:500] or None,
        latency_ms=result.get("latency_ms"),
        failure_kind=result.get("failure_kind"),
    )
    db.add(row)
    db.commit()
    return row


def _severity_rank(policy) -> int:
    return {"low": 0, "medium": 1, "high": 2, "critical": 3}.get(policy.severity or "medium", 1)


def _action_rank(action: str) -> int:
    return {"allowed": 0, "fallback_continued": 1, "warned": 2, "blocked": 3}.get(action, 0)


def _split_db(args: tuple, kwargs: dict) -> tuple[Any, tuple, dict]:
    """Pull the caller's Session out of (args, kwargs); it stays put."""
    if args:
        return args[0], args[1:], kwargs
    params = dict(kwargs)
    return params.pop("db"), (), params


def _run_isolated(coro_factory, db: Session, timeout_s: float):
    """Run a guardrail coroutine on a dedicated worker thread with a fresh
    Session on the same engine bind.

    SQLAlchemy sessions are not thread-safe, so the caller's Session never
    leaves the caller's thread; the coroutine also stays off the shared
    cache bridge loop (sync cache calls made from inside it target that same
    loop and would self-deadlock). Worker startup/join failures raise
    TimeoutError so callers fail open; the coroutine's own errors (notably
    ForbiddenError for pre-check blocks) propagate unwrapped.
    """
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
        except BaseException as exc:
            outcome["error"] = exc
        finally:
            try:
                fresh.close()
            except Exception:
                pass

    worker = threading.Thread(target=_target, name="guardrail-sync", daemon=True)
    worker.start()
    worker.join(timeout_s)
    if worker.is_alive():
        raise TimeoutError("guardrail worker timed out")
    if "error" in outcome:
        raise outcome["error"]
    return outcome.get("result")


def check_pre_sync(*args: Any, timeout_s: float = 12.0, **kwargs: Any) -> str | None:
    """Sync wrapper for sync call sites (gateway hooks). Blocks propagate.

    Worker/timeout failures fail open ONLY when no applied pre policy demands
    otherwise: on a bridge failure the caller thread re-resolves the
    applicable policies on its own session (cheap sync read, no thread hop,
    read-only so thread-safe) and any blocking pre policy with
    failure_action == block turns the failure into a ForbiddenError. A
    bridge_timeout trigger row is written when the blocking policy opts into
    logging (best-effort, never raises).
    """
    started = time.monotonic()
    db, rest, kw = _split_db(args, kwargs)
    try:
        result = _run_isolated(lambda fresh: check_pre(fresh, *rest, **kw), db, timeout_s)
        return result if isinstance(result, str) or result is None else None
    except ForbiddenError:
        raise
    except Exception:
        logger.warning("guardrail pre-check bridge failed; fail-closed fallback", exc_info=True)
        _bridge_fail_closed(db, kw)
        return None
    finally:
        elapsed = (time.monotonic() - started) * 1000
        if elapsed > timeout_s * 1000:
            logger.warning("guardrail pre-check timed out after %.0fms", elapsed)


def _bridge_fail_closed(db: Session, kw: dict[str, Any]) -> None:
    """Caller-thread fallback for a dead/timed-out guardrail worker.

    Read-only resolve_applicable on the caller's session (no thread hop, so
    no session sharing). Raises ForbiddenError when an applied blocking pre
    policy has failure_action == block; otherwise records a bridge_timeout
    trigger row for blocking fail-closed policies that log (best-effort).
    Never raises except for the fail-closed ForbiddenError.
    """
    try:
        resolved = resolution_engine.resolve_applicable(
            db, user_id=kw.get("user_id"), org_id=kw.get("org_id"),
            provider_id=kw.get("provider_id"), model_id=kw.get("model_id"),
            api_key_id=kw.get("api_key_id"), source=kw.get("source", "internal"),
        )
    except Exception:
        logger.warning("guardrail fail-closed resolve failed", exc_info=True)
        return
    candidates = [
        policy for policy in resolved.applied
        if (policy.enforcement or "") == "block"
        and (policy.failure_action or "") == "block"
        and evaluation_engine.policy_allows_pre(policy)
    ]
    if not candidates:
        return
    synthetic = {
        "verdict": "allow", "confidence": 0.0, "categories": [],
        "reason": "guardrail bridge timeout", "evaluator_type": None,
        "failure_kind": "bridge_timeout", "latency_ms": 0.0,
    }
    for policy in candidates:
        if not policy.log_triggers:
            continue
        try:
            _write_trigger(
                db, policy, synthetic, "blocked", stage="pre",
                user_id=kw.get("user_id"), org_id=kw.get("org_id"),
                provider_id=kw.get("provider_id"), model_id=kw.get("model_id"),
                api_key_id=kw.get("api_key_id"), source=kw.get("source", "internal"),
                endpoint=kw.get("endpoint"), request_id=kw.get("request_id"),
                generation_id=kw.get("generation_id"),
            )
        except Exception:
            logger.warning("guardrail bridge_timeout trigger write failed", exc_info=True)
            try:
                db.rollback()
            except Exception:
                pass
    top = max(candidates, key=_severity_rank)
    raise ForbiddenError(f"guardrail_blocked: {top.name}: blocked")


def record_post_sync(*args: Any, timeout_s: float = 12.0, **kwargs: Any) -> str:
    db, rest, kw = _split_db(args, kwargs)
    try:
        result = _run_isolated(lambda fresh: record_post(fresh, *rest, **kw), db, timeout_s)
        return result if isinstance(result, str) else "allowed"
    except Exception:
        logger.warning("guardrail post bridge failed", exc_info=True)
        return "allowed"
