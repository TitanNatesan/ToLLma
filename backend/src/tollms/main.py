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
from tollms.api.attachments.router import router as attachments_router
from tollms.api.auth.router import router as auth_router
from tollms.api.conversations.router import router as conversations_router
from tollms.api.gateway.router import router as gateway_router
from tollms.api.health.router import router as health_router
from tollms.api.models.router import router as models_router
from tollms.api.providers.router import router as providers_router
from tollms.api.repository.router import router as repository_router
from tollms.api.settings.router import router as settings_router
from tollms.api.exports.router import router as exports_router
from tollms.api.messages.router import router as messages_router
from tollms.api.media.router import router as media_router
from tollms.api.request_logs.router import router as request_logs_router
from tollms.api.search.router import router as search_router
from tollms.api.shares.router import router as shares_router
from tollms.core.config import get_settings
from tollms.core.exceptions import register_handlers
from tollms.services import cache as cache_service
from tollms.services import generation as generation_engine
from tollms.services.model_repository import scheduler as repository_scheduler


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    await cache_service.connect()
    _sweep_stale_generations("backend restarted")
    await generation_engine.manager.clear_all_cached_state()
    repository_scheduler.start()
    yield
    await _shutdown_generations()
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
        # Export downloads read Content-Disposition to name the file.
        expose_headers=["Content-Disposition"],
        max_age=86400,
    )
    register_handlers(app)

    @app.middleware("http")
    async def access_log(request: Request, call_next):
        request_id = uuid.uuid4().hex[:8]
        start = time.monotonic()
        try:
            response = await call_next(request)
            logger.info(
                "%s %s %s -> %s %.0fms",
                request_id, request.method, request.url.path,
                response.status_code, (time.monotonic() - start) * 1000,
            )
            return response
        except Exception:
            logger.exception("%s %s %s failed", request_id, request.method, request.url.path)
            raise

    app.include_router(health_router)
    app.include_router(auth_router)
    app.include_router(providers_router)
    app.include_router(models_router)
    app.include_router(repository_router)
    app.include_router(conversations_router)
    app.include_router(attachments_router)
    app.include_router(gateway_router)
    app.include_router(analytics_router)
    app.include_router(settings_router)
    app.include_router(search_router)
    app.include_router(exports_router)
    app.include_router(shares_router)
    app.include_router(messages_router)
    app.include_router(media_router)
    app.include_router(request_logs_router)
    logger.info("%s starting (env=%s)", settings.project_name, settings.environment)
    return app


app = create_app()
