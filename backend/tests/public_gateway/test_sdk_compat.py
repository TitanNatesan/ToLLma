"""SDK-compatibility tests for the public gateway (`/v1/*`).

Wire-shape contracts that third-party SDKs depend on, exercised end to end
through TestClient with a mocked provider transport: OpenAI chat shape,
Anthropic messages shape, model listing, key identity, alias ambiguity,
capability gating and SSE streaming. No network, no paid calls.
"""

import base64

import httpx
from fastapi.testclient import TestClient

from tollms.api.public_gateway import service as gateway_service
from tollms.services.gateway.factory import build_adapter as real_build_adapter

SSE_BODY = (
    'data: {"choices": [{"delta": {"content": "Hello"}}]}\n\n'
    'data: {"choices": [{"delta": {"content": " world"}}]}\n\n'
    'data: {"choices": [{"delta": {}}], "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15}}\n\n'
    "data: [DONE]\n\n"
)

PNG_BYTES = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\x0f\x00"
    b"\x00\x01\x01\x00\x05\x18\xd8N\x00\x00\x00\x00IEND\xaeB`\x82"
)


def _mock_transport() -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/chat/completions":
            return httpx.Response(
                200, content=SSE_BODY.encode(), headers={"content-type": "text/event-stream"}
            )
        if request.url.path == "/images/generations":
            return httpx.Response(
                200, json={"data": [{"b64_json": base64.b64encode(PNG_BYTES).decode()}]},
            )
        return httpx.Response(404, json={"error": "unexpected path"})

    return httpx.MockTransport(handler)


def _bind_mock(monkeypatch) -> None:
    transport = _mock_transport()

    def fake_build_adapter(provider, model, credentials):
        return real_build_adapter(provider, model, credentials, transport)

    monkeypatch.setattr(gateway_service, "build_adapter", fake_build_adapter)


def _make_key(client: TestClient) -> str:
    response = client.post("/api/v1/keys", json={"name": "SDK compat key"})
    assert response.status_code == 201, response.text
    return response.json()["raw_key"]


def _auth(raw_key: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {raw_key}"}


def test_openai_chat_completions_shape(
    client: TestClient, provider_factory, model_factory, monkeypatch
) -> None:
    provider = provider_factory("MockSDK")
    model_factory(provider["id"])
    _bind_mock(monkeypatch)
    raw_key = _make_key(client)

    response = client.post(
        "/v1/chat/completions",
        json={"model": "MockSDK/mock-model", "messages": [{"role": "user", "content": "hi"}]},
        headers=_auth(raw_key),
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["object"] == "chat.completion"
    assert body["choices"][0]["message"]["content"] == "Hello world"
    assert body["choices"][0]["finish_reason"] == "stop"
    assert body["usage"]["total_tokens"] == 15


def test_anthropic_messages_shape(
    client: TestClient, provider_factory, model_factory, monkeypatch
) -> None:
    provider = provider_factory("MockSDK")
    model_factory(provider["id"])
    _bind_mock(monkeypatch)
    raw_key = _make_key(client)

    response = client.post(
        "/v1/messages",
        json={
            "model": "MockSDK/mock-model",
            "max_tokens": 64,
            "messages": [{"role": "user", "content": "hi"}],
        },
        headers={**_auth(raw_key), "anthropic-version": "2023-06-01"},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["type"] == "message"
    assert body["role"] == "assistant"
    assert body["content"][0]["text"] == "Hello world"
    assert body["usage"]["input_tokens"] == 10
    assert body["usage"]["output_tokens"] == 5


def test_models_lists_allowed_models(
    client: TestClient, provider_factory, model_factory
) -> None:
    provider = provider_factory("MockSDK")
    model_factory(provider["id"])
    raw_key = _make_key(client)

    response = client.get("/v1/models", headers=_auth(raw_key))
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["object"] == "list"
    assert "MockSDK/mock-model" in [item["id"] for item in body["data"]]


def test_me_returns_key_identity(
    client: TestClient, provider_factory, model_factory
) -> None:
    provider = provider_factory("MockSDK")
    model_factory(provider["id"])
    raw_key = _make_key(client)

    response = client.get("/v1/me", headers=_auth(raw_key))
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["object"] == "api_key"
    assert body["model_count"] == 1
    assert "MockSDK/mock-model" in body["models"]


def test_ambiguous_model_alias_rejected(
    client: TestClient, provider_factory, model_factory, monkeypatch
) -> None:
    first = provider_factory("MockA")
    model_factory(first["id"])
    second = provider_factory("MockB")
    model_factory(second["id"])
    _bind_mock(monkeypatch)
    raw_key = _make_key(client)

    response = client.post(
        "/v1/chat/completions",
        json={"model": "mock-model", "messages": [{"role": "user", "content": "hi"}]},
        headers=_auth(raw_key),
    )
    assert response.status_code == 422, response.text
    assert "ambiguous_model" in response.text


def test_image_capability_denied_for_chat_model(
    client: TestClient, provider_factory, model_factory
) -> None:
    provider = provider_factory("MockSDK")
    model_factory(provider["id"])  # supports_image_generation defaults False
    raw_key = _make_key(client)

    response = client.post(
        "/v1/images/generations",
        json={"model": "MockSDK/mock-model", "prompt": "a circle"},
        headers=_auth(raw_key),
    )
    assert response.status_code == 403, response.text
    assert "model_not_allowed" in response.text


def test_image_generation_allowed_for_capable_model(
    client: TestClient, provider_factory, model_factory, monkeypatch
) -> None:
    provider = provider_factory("MockSDK")
    model_factory(
        provider["id"],
        supports_image_generation=True,
        endpoint_type="images_generations",
        primary_endpoint="images/generations",
    )
    _bind_mock(monkeypatch)
    raw_key = _make_key(client)

    response = client.post(
        "/v1/images/generations",
        json={"model": "MockSDK/mock-model", "prompt": "a circle"},
        headers=_auth(raw_key),
    )
    assert response.status_code == 200, response.text
    assert response.json()["data"][0]["b64_json"] == base64.b64encode(PNG_BYTES).decode()


def test_openai_sse_stream_shape(
    client: TestClient, provider_factory, model_factory, monkeypatch
) -> None:
    provider = provider_factory("MockSDK")
    model_factory(provider["id"])
    _bind_mock(monkeypatch)
    raw_key = _make_key(client)

    with client.stream(
        "POST",
        "/v1/chat/completions",
        json={
            "model": "MockSDK/mock-model",
            "messages": [{"role": "user", "content": "hi"}],
            "stream": True,
        },
        headers=_auth(raw_key),
    ) as response:
        assert response.status_code == 200, response.text
        assert "text/event-stream" in response.headers["content-type"]
        text = response.read().decode()
    assert "chat.completion.chunk" in text
    assert "data: [DONE]" in text


def test_missing_key_is_unauthenticated(client: TestClient) -> None:
    response = client.post(
        "/v1/chat/completions",
        json={"model": "x/y", "messages": [{"role": "user", "content": "hi"}]},
    )
    assert response.status_code == 401, response.text


CACHED_SSE_BODY = (
    'data: {"choices": [{"delta": {"content": "Hello"}}]}\n\n'
    'data: {"choices": [{"delta": {}}], "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15, "prompt_tokens_details": {"cached_tokens": 8}}}\n\n'
    "data: [DONE]\n\n"
)


def _bind_cached_mock(monkeypatch) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/chat/completions":
            return httpx.Response(
                200, content=CACHED_SSE_BODY.encode(), headers={"content-type": "text/event-stream"}
            )
        return httpx.Response(404, json={"error": "unexpected path"})

    transport = httpx.MockTransport(handler)

    def fake_build_adapter(provider, model, credentials):
        return real_build_adapter(provider, model, credentials, transport)

    monkeypatch.setattr(gateway_service, "build_adapter", fake_build_adapter)


def test_openai_chat_usage_surfaces_cached_tokens(
    client: TestClient, provider_factory, model_factory, monkeypatch
) -> None:
    provider = provider_factory("MockCache")
    model_factory(provider["id"])
    _bind_cached_mock(monkeypatch)
    raw_key = _make_key(client)

    response = client.post(
        "/v1/chat/completions",
        json={"model": "MockCache/mock-model", "messages": [{"role": "user", "content": "hi"}]},
        headers=_auth(raw_key),
    )
    assert response.status_code == 200, response.text
    usage = response.json()["usage"]
    assert usage["prompt_tokens"] == 10
    assert usage["prompt_tokens_details"] == {"cached_tokens": 8}


def test_openai_chat_usage_omits_cache_details_without_hits(
    client: TestClient, provider_factory, model_factory, monkeypatch
) -> None:
    provider = provider_factory("MockNoCache")
    model_factory(provider["id"])
    _bind_mock(monkeypatch)
    raw_key = _make_key(client)

    response = client.post(
        "/v1/chat/completions",
        json={"model": "MockNoCache/mock-model", "messages": [{"role": "user", "content": "hi"}]},
        headers=_auth(raw_key),
    )
    assert response.status_code == 200, response.text
    assert "prompt_tokens_details" not in response.json()["usage"]
