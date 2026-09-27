"""Structured error architecture: ErrorCode + ApplicationException + handlers.

Wire contract (never leaks stack traces):

    {"success": false,
     "error": {"code": "MODEL_TIMEOUT", "message": "...",
               "retryable": true, "timestamp": "..."}}
"""

import enum
import logging
from datetime import datetime, timezone

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger(__name__)


class ErrorCode(str, enum.Enum):
    # Provider errors
    INVALID_CREDENTIALS = "INVALID_CREDENTIALS"
    MODEL_NOT_FOUND = "MODEL_NOT_FOUND"
    MODEL_UNAVAILABLE = "MODEL_UNAVAILABLE"
    RATE_LIMITED = "RATE_LIMITED"
    TIMEOUT = "TIMEOUT"
    PROVIDER_ERROR = "PROVIDER_ERROR"
    # Gateway errors
    STREAM_INTERRUPTED = "STREAM_INTERRUPTED"
    GENERATION_CANCELLED = "GENERATION_CANCELLED"
    INVALID_CONFIGURATION = "INVALID_CONFIGURATION"
    # User errors
    MESSAGE_TOO_LONG = "MESSAGE_TOO_LONG"
    FILE_NOT_SUPPORTED = "FILE_NOT_SUPPORTED"
    MODEL_NOT_CAPABLE = "MODEL_NOT_CAPABLE"
    VALIDATION_ERROR = "VALIDATION_ERROR"
    # System errors
    DATABASE_ERROR = "DATABASE_ERROR"
    CACHE_ERROR = "CACHE_ERROR"
    UNKNOWN_ERROR = "UNKNOWN_ERROR"
    # Generic request errors
    NOT_FOUND = "NOT_FOUND"
    UNAUTHENTICATED = "UNAUTHENTICATED"
    FORBIDDEN = "FORBIDDEN"
    EMAIL_VERIFICATION_REQUIRED = "EMAIL_VERIFICATION_REQUIRED"
    ACCOUNT_PENDING_DELETION = "ACCOUNT_PENDING_DELETION"
    CONFLICT = "CONFLICT"


RETRYABLE_CODES = {
    ErrorCode.TIMEOUT,
    ErrorCode.RATE_LIMITED,
    ErrorCode.MODEL_UNAVAILABLE,
    ErrorCode.STREAM_INTERRUPTED,
    ErrorCode.DATABASE_ERROR,
    ErrorCode.CACHE_ERROR,
    ErrorCode.UNKNOWN_ERROR,
}


class ApplicationException(Exception):
    """Base class for every expected failure. Subclasses set code + status."""

    code: ErrorCode = ErrorCode.UNKNOWN_ERROR
    status_code: int = 500
    retryable: bool = False

    def __init__(self, message: str, *, code: ErrorCode | None = None, retryable: bool | None = None,
                 retry_after: int | None = None):
        super().__init__(message)
        self.message = message
        if code is not None:
            self.code = code
        if retryable is not None:
            self.retryable = retryable
        elif self.code in RETRYABLE_CODES:
            self.retryable = True
        # 429/503 responses surface this as a `Retry-After` header.
        self.retry_after = retry_after

    def to_payload(self) -> dict:
        return {
            "success": False,
            "error": {
                "code": self.code.value,
                "message": self.message,
                "retryable": self.retryable,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            },
        }


# --- domain errors (kept as the public names used across the codebase) --------


class NotFoundError(ApplicationException):
    code = ErrorCode.NOT_FOUND
    status_code = 404


class AuthenticationError(ApplicationException):
    code = ErrorCode.UNAUTHENTICATED
    status_code = 401


class ForbiddenError(ApplicationException):
    code = ErrorCode.FORBIDDEN
    status_code = 403


class EmailVerificationRequiredError(ForbiddenError):
    """Unverified account gated from feature access. 403, not retryable."""

    code = ErrorCode.EMAIL_VERIFICATION_REQUIRED
    status_code = 403


class AccountPendingDeletionError(ForbiddenError):
    """Account scheduled for deletion: feature access denied until the
    grace period ends (purge) or the user restores the account. 403, not
    retryable."""

    code = ErrorCode.ACCOUNT_PENDING_DELETION
    status_code = 403


class ValidationError(ApplicationException):
    code = ErrorCode.VALIDATION_ERROR
    status_code = 422


class ConflictError(ApplicationException):
    code = ErrorCode.CONFLICT
    status_code = 409


class ProviderError(ApplicationException):
    code = ErrorCode.PROVIDER_ERROR
    status_code = 502
    retryable = True


class InvalidCredentialsError(ProviderError):
    code = ErrorCode.INVALID_CREDENTIALS
    retryable = False


class ModelNotFoundError(ProviderError):
    code = ErrorCode.MODEL_NOT_FOUND
    retryable = False


class ModelUnavailableError(ProviderError):
    code = ErrorCode.MODEL_UNAVAILABLE


class RateLimitedError(ProviderError):
    code = ErrorCode.RATE_LIMITED


class TooManyRequestsError(ApplicationException):
    """Local rate-limit denial (auth flood guard, login lockout). 429 + Retry-After."""

    code = ErrorCode.RATE_LIMITED
    status_code = 429


class ServiceUnavailableError(ApplicationException):
    """Fail-closed denial: Valkey-backed auth protection cannot be evaluated."""

    code = ErrorCode.CACHE_ERROR
    status_code = 503


class ProviderTimeoutError(ProviderError):
    code = ErrorCode.TIMEOUT


class StreamInterruptedError(ProviderError):
    code = ErrorCode.STREAM_INTERRUPTED


class InvalidConfigurationError(ApplicationException):
    code = ErrorCode.INVALID_CONFIGURATION
    status_code = 422


class ModelNotCapableError(ValidationError):
    code = ErrorCode.MODEL_NOT_CAPABLE


class FileNotSupportedError(ValidationError):
    code = ErrorCode.FILE_NOT_SUPPORTED


def classify_provider_failure(exc: BaseException) -> ApplicationException:
    """Map an adapter/transport failure onto the provider error taxonomy."""
    if isinstance(exc, ApplicationException):
        return exc  # already classified

    text = str(exc).lower()
    status = getattr(getattr(exc, "response", None), "status_code", None)

    if status in (401, 403) or "invalid api key" in text or "unauthorized" in text or "authentication" in text:
        return InvalidCredentialsError(str(exc))
    if status == 404 or "model not found" in text or "does not exist" in text:
        return ModelNotFoundError(str(exc))
    if status == 429 or "rate limit" in text or "too many requests" in text:
        return RateLimitedError(str(exc))
    if isinstance(exc, TimeoutError) or "timeout" in text or "timed out" in text:
        return ProviderTimeoutError(str(exc))
    if status is not None and 500 <= int(status) < 600:
        return ModelUnavailableError(str(exc))
    return ProviderError(str(exc))


def register_handlers(app: FastAPI) -> None:
    def _payload(exc: ApplicationException) -> JSONResponse:
        return JSONResponse(status_code=exc.status_code, content=exc.to_payload())

    @app.exception_handler(ApplicationException)
    async def _application_error(_: Request, exc: ApplicationException) -> JSONResponse:
        if exc.status_code >= 500:
            logger.exception("application error [%s]: %s", exc.code.value, exc.message)
        else:
            logger.warning("%s [%s]: %s", exc.status_code, exc.code.value, exc.message)
        response = _payload(exc)
        if getattr(exc, "retry_after", None):
            response.headers["Retry-After"] = str(exc.retry_after)
        return response

    @app.exception_handler(RequestValidationError)
    async def _request_validation(_: Request, exc: RequestValidationError) -> JSONResponse:
        first = exc.errors()[0] if exc.errors() else {}
        field = ".".join(str(part) for part in first.get("loc", ()) if part != "body")
        message = first.get("msg", "Invalid request")
        detail = f"{field}: {message}" if field else message
        logger.warning("request validation: %s", detail)
        return _payload(ValidationError(detail))

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        code_by_status = {
            401: ErrorCode.UNAUTHENTICATED,
            403: ErrorCode.FORBIDDEN,
            404: ErrorCode.NOT_FOUND,
            409: ErrorCode.CONFLICT,
            422: ErrorCode.VALIDATION_ERROR,
            429: ErrorCode.RATE_LIMITED,
        }
        error = ApplicationException(str(exc.detail), code=code_by_status.get(exc.status_code, ErrorCode.UNKNOWN_ERROR))
        error.status_code = exc.status_code
        return _payload(error)

    @app.exception_handler(Exception)
    async def _unhandled(_: Request, exc: Exception) -> JSONResponse:
        # Never expose internals; the request id ties this to the access log.
        logger.exception("unhandled error: %s", exc)
        return _payload(ApplicationException("An unexpected error occurred. Please try again."))
