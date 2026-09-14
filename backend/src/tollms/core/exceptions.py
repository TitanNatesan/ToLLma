"""Domain exceptions + FastAPI handlers. Every external call logs, never swallows."""

import logging

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

logger = logging.getLogger(__name__)


class NotFoundError(Exception):
    pass


class AuthenticationError(Exception):
    pass


class ValidationError(Exception):
    pass


class ProviderError(Exception):
    pass


def register_handlers(app: FastAPI) -> None:
    @app.exception_handler(NotFoundError)
    async def _not_found(_: Request, e: NotFoundError) -> JSONResponse:
        logger.warning("not found: %s", e)
        return JSONResponse(status_code=404, content={"detail": str(e)})

    @app.exception_handler(AuthenticationError)
    async def _unauthorized(_: Request, e: AuthenticationError) -> JSONResponse:
        return JSONResponse(status_code=401, content={"detail": str(e)})

    @app.exception_handler(ValidationError)
    async def _bad_request(_: Request, e: ValidationError) -> JSONResponse:
        logger.warning("validation error: %s", e)
        return JSONResponse(status_code=422, content={"detail": str(e)})

    @app.exception_handler(ProviderError)
    async def _provider_error(_: Request, e: ProviderError) -> JSONResponse:
        logger.exception("provider error: %s", e)
        return JSONResponse(status_code=502, content={"detail": str(e)})
