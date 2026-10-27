"""FastAPI application factory."""

import logging
import sys
import time
import uuid
from contextlib import asynccontextmanager
from collections.abc import AsyncIterator

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from tollms.api.analytics.router import router as analytics_router
from tollms.api.analytics_api.router import router as analytics_api_router
from tollms.api.benchmarks.router import router as benchmarks_router
from tollms.api.attachments.router import router as attachments_router
from tollms.api.auth.router import router as auth_router
from tollms.api.catalog.router import router as catalog_router
from tollms.api.conversations.router import router as conversations_router
from tollms.api.guardrails.router import router as guardrails_router
from tollms.api.gateway.router import chat_router as chat_router
from tollms.api.gateway.router import router as gateway_router
from tollms.api.admin.router import router as admin_router
from tollms.api.keys.router import router as keys_router
from tollms.api.public_gateway.router import router as public_gateway_router
from tollms.services.admin import activity as admin_activity
from tollms.api.health.router import router as health_router
from tollms.api.models.router import router as models_router
from tollms.api.notifications.router import router as notifications_router
from tollms.api.orgs.router import router as orgs_router
from tollms.api.prompt_logging.router import router as prompt_logging_router
from tollms.api.providers.router import router as providers_router
from tollms.api.repository.router import router as repository_router
from tollms.api.settings.router import router as settings_router
from tollms.api.exports.router import router as exports_router
from tollms.api.messages.router import router as messages_router
from tollms.api.request_logs.router import router as request_logs_router
from tollms.api.search.router import router as search_router
from tollms.api.shares.router import router as shares_router
from tollms.core.config import get_settings
from tollms.core.exceptions import register_handlers
from tollms.core.security import ACCESS_COOKIE, decode_token
from tollms.services import cache as cache_service
from tollms.services import generation as generation_engine
from tollms.services.jobs import scheduler as jobs_scheduler
from tollms.services.prompt_logging import queue as promptlog_queue
from tollms.services.model_repository import scheduler as repository_scheduler
from tollms.services.observability.events import emit as emit_event


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    await cache_service.connect()
    _sweep_stale_generations("backend restarted")
    await generation_engine.manager.clear_all_cached_state()
    repository_scheduler.start()
    jobs_scheduler.start()
    promptlog_queue.start()
    yield
    promptlog_queue.stop()
    await _shutdown_generations()
    jobs_scheduler.shutdown()
    repository_scheduler.shutdown()
    await cache_service.disconnect()


def _sweep_stale_generations(reason: str) -> None:
    """Startup: tasks are gone, so any RUNNING row is dead — mark FAILED."""
    from tollms.db.session import SessionLocal
    from tollms.services.generation import sweep_stale_running

    db = SessionLocal()
    try:
        sweep_stale_running(db, reason=reason)
    finally:
        db.close()


async def _shutdown_generations() -> None:
    """Shutdown: stop drivers, persist partial text as FAILED."""
    import asyncio

    from tollms.db.session import SessionLocal
    from tollms.services.generation import sweep_stale_running

    tasks = generation_engine.manager.shutdown_tasks("backend shutting down")
    if tasks:
        await asyncio.wait(tasks, timeout=10.0)
    db = SessionLocal()
    try:
        sweep_stale_running(db, reason="backend shutting down")
    finally:
        db.close()


def _admin_actor(request: Request) -> str:
    """User id behind an admin read, best-effort. Never raises (audit only)."""
    try:
        token: str | None = None
        auth = request.headers.get("authorization", "")
        if auth.lower().startswith("bearer "):
            token = auth[7:].strip() or None
        if token is None:
            token = request.cookies.get(ACCESS_COOKIE)
        payload = decode_token(token) if token else None
        if payload is not None and payload.get("type") == "access":
            return str(payload.get("sub") or "anonymous")
    except Exception:
        logging.getLogger(__name__).warning("admin actor decode failed", exc_info=True)
    return "anonymous"


def create_app() -> FastAPI:
    settings = get_settings()
    logging.basicConfig(
        level=settings.log_level,
        format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
        stream=sys.stdout,
    )
    app = FastAPI(
        title=settings.project_name,
        description=settings.project_description,
        debug=settings.debug,
        lifespan=lifespan,
    )
    logger = logging.getLogger(__name__)
    cors_origins = list(settings.cors_origins)
    if settings.environment == "local":
        for o in ("http://127.0.0.1:3000", "http://172.17.0.1:3000"):
            if o not in cors_origins:
                cors_origins.append(o)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        # Export downloads read Content-Disposition to name the file; paged
        # lists expose X-Next-Cursor so browser fetch can read the cursor.
        expose_headers=["Content-Disposition", "X-Export-Total-Count", "X-Export-Truncated", "X-Next-Cursor"],
        max_age=86400,
    )
    register_handlers(app)

    @app.middleware("http")
    async def access_log(request: Request, call_next):
        request_id = uuid.uuid4().hex[:8]
        start = time.monotonic()
        admin_activity.request_started()
        try:
            response = await call_next(request)
            logger.info(
                "%s %s %s -> %s %.0fms ua=%s",
                request_id, request.method, request.url.path,
                response.status_code, (time.monotonic() - start) * 1000,
                request.headers.get("user-agent", "?")[:80],
            )
            if request.url.path.startswith("/api/admin"):
                emit_event(
                    "admin.read",
                    user_id=_admin_actor(request),
                    method=request.method,
                    path=request.url.path,
                    status=response.status_code,
                )
            return response
        except Exception:
            logger.exception("%s %s %s failed", request_id, request.method, request.url.path)
            raise
        finally:
            admin_activity.request_finished()

    app.include_router(health_router)
    app.include_router(auth_router)
    app.include_router(catalog_router)
    app.include_router(prompt_logging_router)
    app.include_router(providers_router)
    app.include_router(models_router)
    app.include_router(repository_router)
    app.include_router(conversations_router)
    app.include_router(attachments_router)
    app.include_router(guardrails_router)
    app.include_router(gateway_router)
    app.include_router(chat_router)
    app.include_router(analytics_router)
    app.include_router(analytics_api_router)
    app.include_router(benchmarks_router)
    app.include_router(settings_router)
    app.include_router(search_router)
    app.include_router(exports_router)
    app.include_router(shares_router)
    app.include_router(messages_router)
    app.include_router(request_logs_router)
    app.include_router(admin_router)
    app.include_router(keys_router)
    app.include_router(orgs_router)
    app.include_router(notifications_router)
    app.include_router(public_gateway_router)
    logger.info("%s starting (env=%s)", settings.project_name, settings.environment)
    return app


app = create_app()
