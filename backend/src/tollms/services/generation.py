"""Backend-owned generation lifecycle.

The generation IS the assistant message row (generation_id == message id).
A background asyncio task drives the provider stream, persists chunks
progressively, and owns status transitions — the HTTP connection is only a
subscriber. Client disconnect never stops generation; refresh reattaches.

Valkey holds active-state pointers (fast lookup, cancel signalling);
PostgreSQL rows are the permanent source of truth. All Valkey access is
best-effort: a Valkey outage degrades to DB + in-process state, never an
error.

Single-process assumption: the task registry lives in memory. Horizontal
scale-out would need a worker handoff (documented, not implemented).
"""

import asyncio
import logging
import time
import uuid
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass, field
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import select

from tollms.db.session import SessionLocal
from tollms.models.conversation import Conversation
from tollms.models.message import TERMINAL_STATUSES, Message, MessageStatus
from tollms.services.cache import keys as cache_keys
from tollms.services.cache.manager import get_manager
from tollms.services.gateway.adapters.base import (
    THINK_CLOSE,
    THINK_OPEN,
    BaseProviderAdapter,
    ChatMessage,
    ChatResult,
)
from tollms.core.exceptions import classify_provider_failure
from tollms.models.message_history import GenerationRun
from tollms.models.request_log import RequestStatus
from tollms.services import request_logs as request_log_engine
from tollms.services.gateway.costing import CostBreakdown, UsageTokens, calculate, prices_for_model
from tollms.services.model_repository.lookup import find_for_model

logger = logging.getLogger(__name__)

GENERATION_TTL = 3600
FLUSH_EVERY_CHUNKS = 10
FLUSH_EVERY_SECONDS = 1.0
CANCEL_POLL_EVERY_CHUNKS = 25


@dataclass
class GenerationSpec:
    """Everything the background task needs. Plain data + built adapter."""

    generation_id: uuid.UUID
    conversation_id: uuid.UUID
    user_id: uuid.UUID | None
    adapter: BaseProviderAdapter
    history: list[ChatMessage]
    history_text: str
    # Pricing context (plain values; ORM rows stay in the request session).
    provider_type: str
    model_label: str
    input_price: str
    output_price: str
    cache_read_price: str
    cache_write_price: str
    # Auth session that started this generation (JWT sid) — durable per-session
    # usage/activity for the session-management UI.
    session_id: str | None = None
    # Regeneration + request-log identity (all optional; absent for legacy paths).
    run_id: uuid.UUID | None = None
    is_regeneration: bool = False
    provider_id: uuid.UUID | None = None
    model_id: uuid.UUID | None = None
    # Server-derived org attribution for the org usage ledger: the provider's
    # org when the caller holds ACTIVE membership there, else None (personal).
    # In-app generations carry no API key (api_key_id stays None in the log).
    org_id: uuid.UUID | None = None
    # Session-user key serving a keyed in-app generation (None = legacy keyless).
    api_key_id: uuid.UUID | None = None
    error_code: str | None = None
    # Time to first streamed token (ms), measured by the driver.
    ttfb_ms: float | None = None
    # Normalized <think> span timing (set by the driver; persisted as
    # messages.thinking_ms — provider-agnostic because every adapter
    # normalizes reasoning into these spans).
    think_started_at: float | None = None
    think_ended_at: float | None = None
    # Media generations: rate-card cost (Decimal) replaces token pricing. The
    # driver prefers the adapter's actual provider-usage cost when it set one.
    media_cost: Decimal | None = None
    media_cost_source: str | None = None


@dataclass
class ActiveGeneration:
    spec: GenerationSpec
    task: asyncio.Task | None = None
    cancel_event: asyncio.Event = field(default_factory=asyncio.Event)
    fail_reason: str | None = None
    subscribers: set[asyncio.Queue] = field(default_factory=set)
    started_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    session_factory: Callable | None = None
    # Emitted text chunks (shared with the driver loop — no per-chunk copy).
    # Reattach snapshots join this (rare) instead of the DB (stale by a flush).
    parts: list = field(default_factory=list)


SubscriberEvent = tuple[str, object]  # ("delta", str) | ("terminal", dict)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _observe_thinking(spec: GenerationSpec, delta: str) -> None:
    """Track normalized <think> span timing. Adapters emit THINK_OPEN/CLOSE
    as whole deltas, so substring checks are exact."""
    if spec.think_started_at is None and THINK_OPEN in delta:
        spec.think_started_at = time.monotonic()
    if (
        spec.think_started_at is not None
        and spec.think_ended_at is None
        and THINK_CLOSE in delta
    ):
        spec.think_ended_at = time.monotonic()


def _thinking_duration_ms(spec: GenerationSpec) -> int | None:
    """Reasoning phase duration. Interrupted reasoning (cancel/fail mid-think)
    ends at finalization time, so 'stopped after Xs' stays truthful."""
    if spec.think_started_at is None:
        return None
    end = spec.think_ended_at if spec.think_ended_at is not None else time.monotonic()
    return max(0, int((end - spec.think_started_at) * 1000))


def _estimate_tokens(text: str) -> int:
    return max(1, len(text) // 4)


def _media_breakdown(spec: GenerationSpec, *, partial: bool = False):
    """(CostBreakdown, estimated) for media specs, or None for token-priced runs.

    Actual provider usage (the adapter's ``final_cost``) always wins. Partial
    content (cancel/failure before the media existed) bills nothing.
    """
    adapter_cost = getattr(getattr(spec, "adapter", None), "final_cost", None)
    if adapter_cost is not None:
        cost = Decimal(str(adapter_cost.estimated_cost))
        return CostBreakdown(output_cost=cost, total_cost=cost), bool(adapter_cost.estimated)
    if partial:
        return CostBreakdown(), False
    if spec.media_cost is not None:
        cost = Decimal(str(spec.media_cost))
        return CostBreakdown(output_cost=cost, total_cost=cost), True
    return None


class GenerationManager:
    """In-process registry + background driver. One module-level instance."""

    def __init__(self, session_factory: Callable = SessionLocal) -> None:
        self._sessions = session_factory
        self._active: dict[uuid.UUID, ActiveGeneration] = {}
        self._conv_locks: dict[uuid.UUID, asyncio.Lock] = {}

    # -- test seam ------------------------------------------------------
    def configure(self, session_factory: Callable) -> "GenerationManager":
        self._sessions = session_factory
        return self

    # -- registry -------------------------------------------------------
    def get(self, generation_id: uuid.UUID) -> ActiveGeneration | None:
        return self._active.get(generation_id)

    def conv_lock(self, conversation_id: uuid.UUID) -> asyncio.Lock:
        lock = self._conv_locks.get(conversation_id)
        if lock is None:
            lock = asyncio.Lock()
            self._conv_locks[conversation_id] = lock
        return lock

    def is_active(self, conversation_id: uuid.UUID) -> uuid.UUID | None:
        for gen_id, active in self._active.items():
            if active.spec.conversation_id == conversation_id and not _task_done(active.task):
                return gen_id
        return None

    # -- Valkey active-state (best-effort) -------------------------------
    async def _cache_write_state(self, spec: GenerationSpec, status: str, content: str) -> None:
        try:
            manager = get_manager()
            await manager.set(
                cache_keys.generation(spec.generation_id),
                {
                    "generation_id": str(spec.generation_id),
                    "conversation_id": str(spec.conversation_id),
                    "message_id": str(spec.generation_id),
                    "user_id": str(spec.user_id) if spec.user_id else None,
                    "status": status,
                    "current_content": content,
                    "started_at": _utcnow().isoformat(),
                },
                ttl=GENERATION_TTL,
            )
            await manager.set(
                cache_keys.generation_by_conversation(spec.conversation_id),
                str(spec.generation_id),
                ttl=GENERATION_TTL,
            )
        except Exception:
            logger.warning("generation %s: active-state write failed", spec.generation_id, exc_info=True)

    async def _cache_clear_state(self, spec: GenerationSpec) -> None:
        try:
            manager = get_manager()
            await manager.delete(
                cache_keys.generation(spec.generation_id),
                cache_keys.generation_by_conversation(spec.conversation_id),
            )
        except Exception:
            logger.warning("generation %s: active-state clear failed", spec.generation_id, exc_info=True)

    async def _cache_cancel_requested(self, generation_id: uuid.UUID) -> bool:
        try:
            state = await get_manager().get(cache_keys.generation(generation_id))
            return isinstance(state, dict) and state.get("cancel_requested") is True
        except Exception:
            logger.warning("generation %s: cancel-flag read failed", generation_id, exc_info=True)
            return False

    async def request_cancel_flag(self, generation_id: uuid.UUID) -> None:
        """Durable cancel signal for whoever drives the stream (any process)."""
        try:
            manager = get_manager()
            key = cache_keys.generation(generation_id)
            state = await manager.get(key)
            if isinstance(state, dict):
                state["cancel_requested"] = True
                await manager.set(key, state, ttl=GENERATION_TTL)
        except Exception:
            logger.warning("generation %s: cancel-flag write failed", generation_id, exc_info=True)

    async def clear_all_cached_state(self) -> None:
        """Startup: active-state cache never survives a restart (tasks are gone)."""
        try:
            await get_manager().invalidate_pattern(cache_keys.section_pattern("generation"))
        except Exception:
            logger.warning("generation active-state sweep failed", exc_info=True)

    # -- subscribers -----------------------------------------------------
    def subscribe(self, generation_id: uuid.UUID) -> asyncio.Queue | None:
        active = self._active.get(generation_id)
        if active is None or _task_done(active.task):
            return None
        queue: asyncio.Queue = asyncio.Queue()
        active.subscribers.add(queue)
        return queue

    def unsubscribe(self, generation_id: uuid.UUID, queue: asyncio.Queue) -> None:
        active = self._active.get(generation_id)
        if active is not None:
            active.subscribers.discard(queue)

    def current_buffer(self, generation_id: uuid.UUID) -> str | None:
        """Exact emitted text, or None when no local driver exists."""
        active = self._active.get(generation_id)
        if active is None or _task_done(active.task):
            return None
        return "".join(active.parts)

    def _emit(self, active: ActiveGeneration, event: SubscriberEvent) -> None:
        for queue in list(active.subscribers):
            try:
                queue.put_nowait(event)
            except Exception:
                logger.warning("generation %s: subscriber emit failed", active.spec.generation_id, exc_info=True)

    # -- lifecycle --------------------------------------------------------
    def spawn(self, spec: GenerationSpec, session_factory: Callable | None = None) -> ActiveGeneration:
        active = ActiveGeneration(spec=spec, session_factory=session_factory)
        active.task = asyncio.create_task(self._run(active), name=f"generation-{spec.generation_id}")
        self._active[spec.generation_id] = active
        return active

    def session_factory(self) -> Callable:
        """Effective session factory for background work (test override or app)."""
        return self._sessions

    def shutdown_tasks(self, reason: str) -> list[asyncio.Task]:
        """Lifespan shutdown: every driver stops and persists FAILED.

        Only tasks owned by the calling loop are returned — entries from dead
        loops (tests) are dropped here; the sweep right after marks their rows.
        """
        try:
            running = asyncio.get_running_loop()
        except RuntimeError:
            running = None
        tasks: list[asyncio.Task] = []
        for active in list(self._active.values()):
            active.fail_reason = active.fail_reason or reason
            active.cancel_event.set()
            if active.task is not None and (running is None or active.task.get_loop() is running):
                tasks.append(active.task)
        return tasks

    async def _run(self, active: ActiveGeneration) -> None:
        spec = active.spec
        db = (active.session_factory or self._sessions)()
        parts: list[str] = active.parts
        result = ChatResult(text="")
        chunks_since_flush = 0
        last_flush = time.monotonic()
        terminal: dict | None = None
        ttfb_ms: float | None = None
        provider_iter = spec.adapter.chat_stream(spec.history)
        run_wall = time.monotonic()
        try:
            try:
                await self._cache_write_state(spec, MessageStatus.RUNNING.value, "")
                async for chunk in _cancellable_stream(provider_iter, active, self, spec.generation_id):
                    if ttfb_ms is None and chunk.delta:
                        ttfb_ms = (time.monotonic() - run_wall) * 1000
                        spec.ttfb_ms = ttfb_ms
                    parts.append(chunk.delta)
                    _accumulate(result, chunk)
                    if chunk.delta:
                        _observe_thinking(spec, chunk.delta)
                        self._emit(active, ("delta", chunk.delta))
                    chunks_since_flush += 1
                    if chunks_since_flush >= FLUSH_EVERY_CHUNKS or (time.monotonic() - last_flush) >= FLUSH_EVERY_SECONDS:
                        await self._flush(db, spec, "".join(parts), active, terminal_status=None)
                        chunks_since_flush = 0
                        last_flush = time.monotonic()
                result.text = "".join(parts)
                terminal = await self._finish_completed(db, spec, result)
            except _GenerationCancelled:
                result.text = "".join(parts)
                terminal = await self._finish_cancelled(db, spec, active, result)
            except asyncio.CancelledError:
                # Host loop going away (shutdown/test end): persist what we
                # have as FAILED, then let cancellation propagate.
                result.text = "".join(parts)
                active.fail_reason = active.fail_reason or "generation interrupted"
                terminal = await self._finish_cancelled(db, spec, active, result, failed=True)
                raise
            except Exception as e:
                logger.exception("generation %s failed", spec.generation_id)
                result.text = "".join(parts)
                terminal = await self._finish_failed(db, spec, result, str(e))
        finally:
            # Registry cleanup + terminal broadcast run even when cancelled:
            # a dead entry would otherwise linger and break a later shutdown.
            await _aclose_quietly(provider_iter)
            db.close()
            if terminal is not None:
                self._emit(active, ("terminal", terminal))
                await self._cache_clear_state(spec)
                total_ms = (time.monotonic() - run_wall) * 1000
                logger.info(
                    "generation %s ended: status=%s chunks=%d chars=%d ttfb=%s total=%.0fms",
                    spec.generation_id, terminal.get("status"), len(parts), len(result.text),
                    f"{ttfb_ms:.0f}ms" if ttfb_ms is not None else "n/a", total_ms,
                )
            self._active.pop(spec.generation_id, None)

    async def _flush(
        self,
        db,
        spec: GenerationSpec,
        content: str,
        active: ActiveGeneration,
        terminal_status: MessageStatus | None,
    ) -> None:
        """Persist progressive content. Never raises (stream must survive)."""
        try:
            row = db.get(Message, spec.generation_id)
            if row is None:
                return
            row.content = content
            if terminal_status is not None:
                row.status = terminal_status
                row.completed_at = _utcnow()
            db.commit()
            await self._cache_write_state(
                spec, terminal_status.value if terminal_status else MessageStatus.RUNNING.value, content
            )
        except Exception:
            db.rollback()
            logger.warning("generation %s: progress flush failed", spec.generation_id, exc_info=True)

    async def _finish_completed(self, db, spec: GenerationSpec, result: ChatResult) -> dict:
        tokens, breakdown, estimated = self._price(db, spec, result, partial=False)
        latency_ms = (datetime.now(timezone.utc) - self._started(db, spec)).total_seconds() * 1000
        self._store_final(db, spec, result.text, tokens, breakdown, latency_ms, MessageStatus.COMPLETED, None, estimated)
        await self._cache_write_state(spec, MessageStatus.COMPLETED.value, result.text)
        self._invalidate_usage(spec)
        return _terminal_payload(spec, result, tokens, breakdown, estimated, MessageStatus.COMPLETED, latency_ms)

    async def _finish_cancelled(
        self, db, spec: GenerationSpec, active: ActiveGeneration, result: ChatResult, failed: bool = False
    ) -> dict:
        """User cancel (or shutdown): persist partial text, estimate usage."""
        reason = active.fail_reason
        status = MessageStatus.FAILED if failed or reason else MessageStatus.CANCELLED
        error = reason if failed else None
        tokens, breakdown, estimated = self._price(db, spec, result, partial=True)
        latency_ms = (datetime.now(timezone.utc) - self._started(db, spec)).total_seconds() * 1000
        self._store_final(db, spec, result.text, tokens, breakdown, latency_ms, status, error, estimated)
        await self._cache_write_state(spec, status.value, result.text)
        self._invalidate_usage(spec)
        return _terminal_payload(spec, result, tokens, breakdown, estimated, status, latency_ms, error)

    async def _finish_failed(self, db, spec: GenerationSpec, result: ChatResult, error: str) -> dict:
        classified = classify_provider_failure(RuntimeError(error))
        spec.error_code = classified.code.value
        tokens, breakdown, estimated = self._price(db, spec, result, partial=True)
        latency_ms = (datetime.now(timezone.utc) - self._started(db, spec)).total_seconds() * 1000
        self._store_final(db, spec, result.text, tokens, breakdown, latency_ms, MessageStatus.FAILED, error, estimated)
        await self._cache_write_state(spec, MessageStatus.FAILED.value, result.text)
        self._invalidate_usage(spec)
        return _terminal_payload(spec, result, tokens, breakdown, estimated, MessageStatus.FAILED, latency_ms, error)

    def _started(self, db, spec: GenerationSpec) -> datetime:
        try:
            row = db.get(Message, spec.generation_id)
            if row is not None and row.started_at is not None:
                return row.started_at
        except Exception:
            logger.warning("generation %s: started_at read failed", spec.generation_id, exc_info=True)
        return _utcnow()

    def _price(self, db, spec: GenerationSpec, result: ChatResult, *, partial: bool):
        """Provider usage wins; otherwise estimate from text (always estimated
        for partial/cancelled/failed content). Media generations use the
        media rate card instead of token pricing."""
        media = _media_breakdown(spec, partial=partial)
        if media is not None:
            breakdown, estimated = media
            return UsageTokens(), breakdown, estimated
        estimated = partial
        prompt, completion = result.prompt_tokens, result.completion_tokens
        if not prompt and not completion:
            prompt, completion = _estimate_tokens(spec.history_text), _estimate_tokens(result.text)
            estimated = True
        total = result.total_tokens or (prompt + completion)
        tokens = UsageTokens(
            prompt=prompt, completion=completion,
            cache_read=result.cache_read_tokens or 0,
            cache_write=result.cache_write_tokens or 0,
            reasoning=result.reasoning_tokens or 0,
        )
        try:
            repo = find_for_model(db, spec.provider_type, spec.model_label)
        except Exception:
            logger.warning("generation %s: repository pricing lookup failed", spec.generation_id, exc_info=True)
            repo = None
        breakdown = calculate(tokens, prices_for_model(_price_holder(spec), repo))
        return tokens, breakdown, estimated

    def _store_final(
        self, db, spec, text, tokens, breakdown, latency_ms, status, error, estimated: bool = False
    ) -> None:
        try:
            row = db.get(Message, spec.generation_id)
            if row is None:
                return
            row.content = text
            row.status = status
            row.completed_at = _utcnow()
            row.error = error
            row.error_code = spec.error_code
            if spec.api_key_id is not None:
                # Re-attribute to the key that authorized this run (regeneration
                # passes a freshly validated key; initial runs stamp once).
                row.api_key_id = spec.api_key_id
            row.usage_estimated = estimated
            row.session_id = spec.session_id
            if spec.ttfb_ms is not None:
                row.ttfb_ms = spec.ttfb_ms
            thinking_ms = _thinking_duration_ms(spec)
            if thinking_ms is not None:
                row.thinking_ms = thinking_ms
            row.prompt_tokens, row.completion_tokens, row.total_tokens = (
                tokens.prompt, tokens.completion, tokens.prompt + tokens.completion,
            )
            row.cache_read_tokens, row.cache_write_tokens, row.reasoning_tokens = (
                tokens.cache_read, tokens.cache_write, tokens.reasoning,
            )
            row.input_cost, row.output_cost, row.total_cost = breakdown.legacy_triplet()
            row.cache_read_cost, row.cache_write_cost, row.reasoning_cost = (
                breakdown.cache_read_cost, breakdown.cache_write_cost, breakdown.reasoning_cost,
            )
            row.latency_ms = latency_ms
            self._store_run(db, spec, text, tokens, breakdown, latency_ms, status, error)
            self._log_request(db, spec, tokens, breakdown, latency_ms, status)
            db.commit()
        except Exception:
            db.rollback()
            logger.warning("generation %s: final store failed", spec.generation_id, exc_info=True)

    def _store_run(
        self, db, spec, text, tokens, breakdown, latency_ms, status, error
    ) -> None:
        """Keep the regeneration history row in lockstep with the message."""
        if spec.run_id is None:
            return
        run = db.get(GenerationRun, spec.run_id)
        if run is None:
            return
        run.content = text
        run.status = status.value
        run.is_active = status == MessageStatus.COMPLETED
        run.prompt_tokens = tokens.prompt
        run.completion_tokens = tokens.completion
        run.total_tokens = tokens.prompt + tokens.completion
        run.total_cost = breakdown.legacy_triplet()[2]
        run.latency_ms = latency_ms
        run.error = error

    def _log_request(self, db, spec, tokens, breakdown, latency_ms, status) -> None:
        """One request_logs row per finished generation (success/cancel/fail)."""
        status_map = {
            MessageStatus.COMPLETED: RequestStatus.SUCCESS,
            MessageStatus.CANCELLED: RequestStatus.CANCELLED,
            MessageStatus.FAILED: RequestStatus.FAILED,
        }
        cost = breakdown.legacy_triplet()
        request_log_engine.record(
            db,
            request_log_engine.RequestLogEntry(
                user_id=spec.user_id,
                org_id=spec.org_id,
                api_key_id=spec.api_key_id,
                conversation_id=spec.conversation_id,
                message_id=spec.generation_id,
                provider_id=spec.provider_id,
                model_id=spec.model_id,
                request_started_at=getattr(spec, "request_started_at", None),
                request_completed_at=_utcnow(),
                latency_ms=latency_ms,
                prompt_tokens=tokens.prompt,
                completion_tokens=tokens.completion,
                total_tokens=tokens.prompt + tokens.completion,
                cache_read_tokens=tokens.cache_read,
                cache_write_tokens=tokens.cache_write,
                reasoning_tokens=tokens.reasoning,
                input_cost=cost[0],
                output_cost=cost[1],
                total_cost=cost[2],
                status=status_map.get(status, RequestStatus.SUCCESS),
                error_code=spec.error_code,
                is_regeneration=spec.is_regeneration,
                is_streaming=True,
            ),
        )

    def _invalidate_usage(self, spec: GenerationSpec) -> None:
        try:
            from tollms.services.cache.manager import cache_delete_sync, cache_invalidate_sync

            cache_delete_sync(cache_keys.usage_totals(spec.conversation_id, spec.user_id))
            # Dashboard caches are short-lived; clear the user's analytics
            # aggregates so the next visit reflects the finished generation.
            if spec.user_id is not None:
                cache_invalidate_sync(cache_keys.analytics_pattern(spec.user_id))
        except Exception:
            logger.warning("generation %s: usage invalidation failed", spec.generation_id, exc_info=True)


class _GenerationCancelled(Exception):
    pass


def _task_done(task: asyncio.Task | None) -> bool:
    return task is None or task.done()


def _accumulate(result: ChatResult, chunk) -> None:
    if chunk.prompt_tokens is not None: result.prompt_tokens = chunk.prompt_tokens
    if chunk.completion_tokens is not None: result.completion_tokens = chunk.completion_tokens
    if chunk.total_tokens is not None: result.total_tokens = chunk.total_tokens
    if chunk.cache_read_tokens is not None: result.cache_read_tokens = chunk.cache_read_tokens
    if chunk.cache_write_tokens is not None: result.cache_write_tokens = chunk.cache_write_tokens
    if chunk.reasoning_tokens is not None: result.reasoning_tokens = chunk.reasoning_tokens


async def _cancellable_stream(
    provider_iter: AsyncIterator,
    active: ActiveGeneration,
    manager: GenerationManager,
    gen_id: uuid.UUID,
):
    """Yield provider chunks; abort promptly on cancel — including mid-fetch.

    A cancel during a hung provider read races the fetch against the cancel
    event, then closes the provider iterator so no further chunks arrive or
    persist. In-flight chunks already emitted may still persist (documented).
    """
    seen = 0
    pending: asyncio.Task | None = None
    while True:
        if active.cancel_event.is_set():
            if pending is not None:
                pending.cancel()
            await _aclose_quietly(provider_iter)
            raise _GenerationCancelled()
        if pending is None:
            pending = asyncio.ensure_future(provider_iter.__anext__())
        fetch: asyncio.Task = pending
        waiter = asyncio.ensure_future(active.cancel_event.wait())
        try:
            done, _ = await asyncio.wait({fetch, waiter}, return_when=asyncio.FIRST_COMPLETED)
        finally:
            if not waiter.done():
                waiter.cancel()
        if waiter in done:
            fetch.cancel()
            try:
                await fetch
            except (asyncio.CancelledError, StopAsyncIteration):
                pass
            except Exception:
                logger.warning("generation %s: cancelled fetch raised", gen_id, exc_info=True)
            pending = None
            await _aclose_quietly(provider_iter)
            raise _GenerationCancelled()
        try:
            chunk = fetch.result()
        except StopAsyncIteration:
            return
        pending = None
        yield chunk
        seen += 1
        if seen % CANCEL_POLL_EVERY_CHUNKS == 0 and await manager._cache_cancel_requested(gen_id):
            await _aclose_quietly(provider_iter)
            raise _GenerationCancelled()


async def _aclose_quietly(provider_iter) -> None:
    aclose = getattr(provider_iter, "aclose", None)
    if aclose is not None:
        try:
            await aclose()
        except Exception:
            logger.warning("provider iterator close failed", exc_info=True)


def _terminal_payload(spec, result, tokens, breakdown, estimated, status, latency_ms, error=None) -> dict:
    cost = breakdown.legacy_triplet()
    payload = {
        "done": True,
        "generation_id": str(spec.generation_id),
        "message_id": str(spec.generation_id),
        "status": status.value,
        "usage": {
            "prompt_tokens": tokens.prompt, "completion_tokens": tokens.completion,
            "total_tokens": tokens.prompt + tokens.completion,
            "cache_read_tokens": tokens.cache_read, "cache_write_tokens": tokens.cache_write,
            "reasoning_tokens": tokens.reasoning,
        },
        "cost": {
            "input_cost": str(cost[0]), "output_cost": str(cost[1]), "total_cost": str(cost[2]),
            "cache_read_cost": str(breakdown.cache_read_cost),
            "cache_write_cost": str(breakdown.cache_write_cost),
            "reasoning_cost": str(breakdown.reasoning_cost),
        },
        "usage_estimated": estimated,
        "latency_ms": latency_ms,
    }
    if error:
        payload["error"] = error
    if getattr(spec, "error_code", None):
        payload["error_code"] = spec.error_code
    return payload


class _PriceHolder:
    """Duck-typed model prices for prices_for_model (ORM rows stay put)."""

    def __init__(self, spec: GenerationSpec) -> None:
        def _dec(value: object) -> Decimal:
            try:
                return Decimal(str(value))
            except Exception:
                return Decimal(0)

        self.input_price = _dec(spec.input_price)
        self.output_price = _dec(spec.output_price)
        self.cache_read_price = _dec(spec.cache_read_price)
        self.cache_write_price = _dec(spec.cache_write_price)


def _price_holder(spec: GenerationSpec) -> _PriceHolder:
    return _PriceHolder(spec)


def sweep_stale_running(db, *, reason: str) -> int:
    """Startup/shutdown: anything left running/queued is dead — mark failed.

    Runs in the request/startup session. Returns rows marked.
    """
    try:
        rows = list(
            db.scalars(
                select(Message).where(
                    Message.is_deleted.is_(False),
                    Message.status.in_([MessageStatus.QUEUED, MessageStatus.RUNNING]),
                )
            )
        )
        for row in rows:
            row.status = MessageStatus.FAILED
            row.completed_at = _utcnow()
            row.error = row.error or reason
        db.commit()
        if rows:
            logger.warning("swept %d stale running generations: %s", len(rows), reason)
        return len(rows)
    except Exception:
        db.rollback()
        logger.warning("stale generation sweep failed", exc_info=True)
        return 0


def touch_conversation(db, conversation_id: uuid.UUID) -> None:
    try:
        conv = db.get(Conversation, conversation_id)
        if conv is not None:
            conv.updated_at = _utcnow()
            db.commit()
    except Exception:
        db.rollback()
        logger.warning("conversation touch failed: %s", conversation_id, exc_info=True)


manager = GenerationManager()
