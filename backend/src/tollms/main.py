"""FastAPI application factory."""

import logging
import sys
import time
import uuid

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from tollms.api.health import router as health_router
from tollms.core.config import get_settings
from tollms.core.exceptions import register_handlers
from tollms.modules.conversations.router import router as conversations_router
from tollms.modules.gateway.router import router as gateway_router
from tollms.modules.models.router import router as models_router
from tollms.modules.providers.router import router as providers_router


def create_app() -> FastAPI:
    settings = get_settings()
    logging.basicConfig(
        level=settings.log_level,
        format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
        stream=sys.stdout,
    )
    logger = logging.getLogger(__name__)
    app = FastAPI(title=settings.project_name, debug=settings.debug)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
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
    app.include_router(providers_router)
    app.include_router(models_router)
    app.include_router(conversations_router)
    app.include_router(gateway_router)
    logger.info("%s starting (env=%s)", settings.project_name, settings.environment)
    return app


app = create_app()
