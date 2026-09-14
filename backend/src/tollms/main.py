"""FastAPI application factory."""

import logging
import sys
import time
import uuid
from contextlib import asynccontextmanager
from collections.abc import AsyncIterator

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from tollms.api.attachments.router import router as attachments_router
from tollms.api.auth.router import router as auth_router
from tollms.api.conversations.router import router as conversations_router
from tollms.api.gateway.router import router as gateway_router
from tollms.api.health.router import router as health_router
from tollms.api.models.router import router as models_router
from tollms.api.providers.router import router as providers_router
from tollms.api.repository.router import router as repository_router
from tollms.core.config import get_settings
from tollms.core.exceptions import register_handlers
from tollms.services import cache as cache_service
from tollms.services.model_repository import scheduler as repository_scheduler


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    await cache_service.connect()
    repository_scheduler.start()
    yield
    repository_scheduler.shutdown()
    await cache_service.disconnect()


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
    logger.info("%s starting (env=%s)", settings.project_name, settings.environment)
    return app


app = create_app()
