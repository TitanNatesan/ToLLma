"""Structured error architecture: envelope shape, codes, classification."""

import httpx

from tollms.core.exceptions import (
    ErrorCode,
    InvalidCredentialsError,
    ProviderTimeoutError,
    RateLimitedError,
    classify_provider_failure,
)


def _error(body: dict) -> dict:
    assert body["success"] is False
    error = body["error"]
    assert {"code", "message", "retryable", "timestamp"} <= set(error)
    return error


def test_not_found_envelope(client, user_factory):
    user_factory()
    r = client.get("/api/v1/conversations/00000000-0000-0000-0000-000000000000")
    assert r.status_code == 404
    error = _error(r.json())
    assert error["code"] == ErrorCode.NOT_FOUND.value
    assert error["retryable"] is False


def test_unauthenticated_envelope(client):
    client.cookies.clear()
    r = client.get("/api/v1/conversations")
    assert r.status_code == 401
    assert _error(r.json())["code"] == ErrorCode.UNAUTHENTICATED.value


def test_request_validation_envelope(client, user_factory):
    user_factory()
    r = client.post("/api/v1/providers", json={"name": ""})
    assert r.status_code == 422
    error = _error(r.json())
    assert error["code"] == ErrorCode.VALIDATION_ERROR.value
    assert "name" in error["message"]


def test_domain_validation_envelope(client, user_factory, provider_factory, model_factory):
    user_factory()
    provider = provider_factory()
    model = model_factory(provider["id"])
    # Attachments list too long trips pydantic validation, not the domain path.
    r = client.post(
        "/api/v1/gateway/chat",
        json={
            "provider_id": provider["id"],
            "model_id": model["id"],
            "message": "",
        },
    )
    assert r.status_code == 422
    assert _error(r.json())["code"] == ErrorCode.VALIDATION_ERROR.value


def test_provider_error_classification():
    request = httpx.Request("POST", "https://api.example.com")
    unauthorized = httpx.HTTPStatusError(
        "unauthorized", request=request, response=httpx.Response(401, request=request)
    )
    assert isinstance(classify_provider_failure(unauthorized), InvalidCredentialsError)

    limited = httpx.HTTPStatusError(
        "rate limited", request=request, response=httpx.Response(429, request=request)
    )
    assert isinstance(classify_provider_failure(limited), RateLimitedError)

    assert isinstance(classify_provider_failure(TimeoutError("read timed out")), ProviderTimeoutError)
    assert classify_provider_failure(TimeoutError("x")).retryable is True
    assert classify_provider_failure(unauthorized).retryable is False
    assert classify_provider_failure(RuntimeError("boom")).code == ErrorCode.PROVIDER_ERROR


def test_application_exception_payload():
    error = ProviderTimeoutError("Provider request timed out.")
    payload = error.to_payload()
    assert payload["success"] is False
    assert payload["error"]["code"] == "TIMEOUT"
    assert payload["error"]["retryable"] is True
    assert payload["error"]["timestamp"]
