"""Phase 11 gateway hardening tests (test-only; no src changes).

Covers: overbudget Valkey flag lifecycle, per-request reservations,
chat capability gates, media allow-lists, streaming terminal rows.
"""

import asyncio
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from tollms.api.public_gateway import service as gateway_service
from tollms.core.exceptions import ValidationError
from tollms.models.api_key import ApiRequestLog
from tollms.models.provider import ProviderType
from tollms.services.api_keys.keys import KeyContext, KeyPolicy
from tollms.services.cache import client as cache_client
from tollms.services.cache.manager import call_sync, get_manager
from tollms.services.gateway import limits, translators
from tollms.services.gateway.adapters.base import ChatMessage, StreamChunk
from tollms.services.gateway.factory import build_adapter as real_build_adapter

NOW = datetime(2026, 9, 25, 12, 0, 0, tzinfo=timezone.utc)
DATA_URL = "data:image/png;base64,aGVsbG8="


def _run(coro):
    return asyncio.run(coro)


def _require_valkey() -> None:
    assert _run(cache_client.connect()) is True, "Valkey must be reachable"


def _ctx(policy=None) -> KeyContext:
    return KeyContext(
        key_id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        name="hardening-test",
        key_prefix="tma_sk_live_test",
        enabled=True,
        expires_at=None,
        policy=policy or KeyPolicy(),
        model_permissions=(),
    )


def _freeze(monkeypatch, now: datetime) -> None:
    monkeypatch.setattr(limits, "_now", lambda: now)


# --- overbudget flag lifecycle -------------------------------------------------


def test_overbudget_flag_lifecycle_daily(monkeypatch: pytest.MonkeyPatch) -> None:
    """Force over-spend via actuals -> 403 budget -> expiry allows again."""
    _require_valkey()
    _freeze(monkeypatch, NOW)
    ctx = _ctx(KeyPolicy(daily_spend_limit=Decimal("0.05")))
    pid, mid = uuid.uuid4(), uuid.uuid4()

    assert limits.check_request(
        ctx, provider_id=pid, model_id=mid, estimated_tokens=5,
        estimated_cost=Decimal("0.01"), request_id="req-ob-1",
    ).allowed is True

    # Actuals land over the daily cap: reservation reconciles up, flag trips.
    limits.record_usage(
        ctx, tokens=5, cost=Decimal("0.10"),
        provider_id=pid, model_id=mid, request_id="req-ob-1",
    )

    flag_key = limits._overbudget_key(ctx)  # noqa: SLF001
    assert call_sync(get_manager().get(flag_key)) is not None

    ttl = call_sync(get_manager().ttl(flag_key))
    assert ttl is not None and 1 <= int(ttl) <= 86400

    denied = limits.check_request(
        ctx, provider_id=pid, model_id=mid, estimated_tokens=1,
        estimated_cost=Decimal("0.001"), request_id="req-ob-2",
    )
    assert denied.allowed is False
    assert denied.reason == "budget" and denied.status_code == 403

    # Simulate expiry + next UTC day: daily counter resets, flag gone.
    from tollms.services.cache.manager import cache_delete_sync

    assert cache_delete_sync(flag_key) >= 0
    _freeze(monkeypatch, NOW + timedelta(days=1, seconds=5))
    allowed = limits.check_request(
        ctx, provider_id=pid, model_id=mid, estimated_tokens=1,
        estimated_cost=Decimal("0.001"), request_id="req-ob-3",
    )
    assert allowed.allowed is True


def test_overbudget_lifetime_hard_cap_persists_without_flag(monkeypatch: pytest.MonkeyPatch) -> None:
    """Deleting the flag alone does not bypass a lifetime budget still over cap."""
    _require_valkey()
    _freeze(monkeypatch, NOW)
    ctx = _ctx(KeyPolicy(max_budget_usd=Decimal("0.05")))
    pid, mid = uuid.uuid4(), uuid.uuid4()

    assert limits.check_request(
        ctx, provider_id=pid, model_id=mid, estimated_tokens=5,
        estimated_cost=Decimal("0.01"), request_id="req-life-1",
    ).allowed is True
    limits.record_usage(
        ctx, tokens=5, cost=Decimal("0.10"),
        provider_id=pid, model_id=mid, request_id="req-life-1",
    )
    flag_key = limits._overbudget_key(ctx)  # noqa: SLF001
    assert call_sync(get_manager().get(flag_key)) is not None

    from tollms.services.cache.manager import cache_delete_sync

    cache_delete_sync(flag_key)
    # Spend still $0.10 > $0.05 cap: hard budget denies even with flag cleared.
    denied = limits.check_request(
        ctx, provider_id=pid, model_id=mid, estimated_tokens=0,
        estimated_cost=Decimal("0.001"),
    )
    assert denied.allowed is False and denied.reason == "budget"
    assert denied.status_code == 403


# --- concurrent same-scope reservations ---------------------------------------


def test_concurrent_same_scope_reservations_reconcile_independently(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Two request_ids on one scope hold distinct reservations."""
    _require_valkey()
    _freeze(monkeypatch, NOW)
    ctx = _ctx(KeyPolicy(tpm=100))
    pid, mid = uuid.uuid4(), uuid.uuid4()

    d1 = limits.check_request(
        ctx, provider_id=pid, model_id=mid, estimated_tokens=60,
        estimated_cost=Decimal("0"), request_id="req-a",
    )
    d2 = limits.check_request(
        ctx, provider_id=pid, model_id=mid, estimated_tokens=30,
        estimated_cost=Decimal("0"), request_id="req-b",
    )
    assert d1.allowed is True and d2.allowed is True

    from tollms.services.cache.manager import cache_get_sync

    ra = cache_get_sync(limits._reservation_key(ctx, pid, mid, "req-a"))  # noqa: SLF001
    rb = cache_get_sync(limits._reservation_key(ctx, pid, mid, "req-b"))  # noqa: SLF001
    assert isinstance(ra, dict) and isinstance(rb, dict)
    assert ra["tokens"] == 60 and rb["tokens"] == 30

    # Reconcile independently: a bills what it reserved, b refunds 20.
    limits.record_usage(ctx, tokens=60, cost=Decimal("0"), provider_id=pid, model_id=mid, request_id="req-a")
    limits.record_usage(ctx, tokens=10, cost=Decimal("0"), provider_id=pid, model_id=mid, request_id="req-b")

    # Counter is now 70: +30 fits exactly, +31 does not.
    assert limits.check_request(
        ctx, provider_id=pid, model_id=mid, estimated_tokens=30,
        estimated_cost=Decimal("0"),
    ).allowed is True
    # Refund the 30 just reserved so the next probe sees 70 again.
    limits.record_usage(ctx, tokens=0, cost=Decimal("0"), provider_id=pid, model_id=mid)
    denied = limits.check_request(
        ctx, provider_id=pid, model_id=mid, estimated_tokens=31,
        estimated_cost=Decimal("0"),
    )
    assert denied.allowed is False and denied.reason == "tpm"


def test_legacy_slot_without_request_id_still_works(monkeypatch: pytest.MonkeyPatch) -> None:
    _require_valkey()
    _freeze(monkeypatch, NOW)
    ctx = _ctx(KeyPolicy(tpm=100))
    pid, mid = uuid.uuid4(), uuid.uuid4()
    assert limits.check_request(
        ctx, provider_id=pid, model_id=mid, estimated_tokens=90,
        estimated_cost=Decimal("0"),
    ).allowed is True
    limits.record_usage(ctx, tokens=40, cost=Decimal("0"), provider_id=pid, model_id=mid)
    assert limits.check_request(
        ctx, provider_id=pid, model_id=mid, estimated_tokens=60,
        estimated_cost=Decimal("0"),
    ).allowed is True


# --- chat capability gates -----------------------------------------------------


SSE_BODY = (
    'data: {"choices": [{"delta": {"content": "Hello"}}]}\n\n'
    'data: {"choices": [{"delta": {"content": " world"}}]}\n\n'
    'data: {"choices": [{"delta": {}}], "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15}}\n\n'
    "data: [DONE]\n\n"
)


def _mock_transport() -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/chat/completions":
            return httpx.Response(200, content=SSE_BODY.encode(), headers={"content-type": "text/event-stream"})
        return httpx.Response(404, json={"error": "unexpected path"})

    return httpx.MockTransport(handler)


def _bind_mock(monkeypatch) -> None:
    transport = _mock_transport()

    def fake_build_adapter(provider, model, credentials):
        return real_build_adapter(provider, model, credentials, transport)

    monkeypatch.setattr(gateway_service, "build_adapter", fake_build_adapter)


def _make_key(client: TestClient) -> str:
    r = client.post("/api/v1/keys", json={"name": "hardening key"})
    assert r.status_code == 201, r.text
    return r.json()["raw_key"]


def _auth(raw: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {raw}"}


def _chat(client: TestClient, raw: str, model_ref: str, payload_extra: dict) -> httpx.Response:
    body = {"model": model_ref, "messages": [{"role": "user", "content": "hi"}], **payload_extra}
    return client.post("/v1/chat/completions", json=body, headers=_auth(raw))


def test_tool_gate_denied_then_allowed_via_patch(
    client: TestClient, provider_factory, model_factory, monkeypatch
) -> None:
    provider = provider_factory("GateTool")
    created = model_factory(provider["id"], model_id="tool-model")  # supports_tool_calling False
    _bind_mock(monkeypatch)
    raw = _make_key(client)
    ref = f"{provider['name']}/tool-model"
    tools = {"tools": [{"type": "function", "function": {"name": "f"}}]}

    denied = _chat(client, raw, ref, tools)
    assert denied.status_code == 403, denied.text
    assert "model_not_allowed" in denied.text
    assert "supports_tool_calling" in denied.text

    patched = client.patch(f"/api/v1/models/{created['id']}", json={"supports_tool_calling": True})
    assert patched.status_code == 200, patched.text

    ok = _chat(client, raw, ref, tools)
    assert ok.status_code == 200, ok.text
    assert ok.json()["choices"][0]["message"]["content"] == "Hello world"


def test_vision_gate(client: TestClient, provider_factory, model_factory, monkeypatch) -> None:
    provider = provider_factory("GateVision")
    model_factory(provider["id"], model_id="blind-model")  # supports_vision False
    model_factory(provider["id"], model_id="seeing-model", supports_vision=True)
    _bind_mock(monkeypatch)
    raw = _make_key(client)
    image_msg = {
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "describe"},
                    {"type": "image_url", "image_url": {"url": DATA_URL}},
                ],
            }
        ]
    }
    denied = _chat(client, raw, f"{provider['name']}/blind-model", image_msg)
    assert denied.status_code == 403, denied.text
    assert "supports_vision" in denied.text

    ok = _chat(client, raw, f"{provider['name']}/seeing-model", image_msg)
    assert ok.status_code == 200, ok.text


def test_reasoning_gate(client: TestClient, provider_factory, model_factory, monkeypatch) -> None:
    provider = provider_factory("GateReason")
    model_factory(provider["id"], model_id="plain-model")  # supports_reasoning False
    model_factory(provider["id"], model_id="think-model", supports_reasoning=True)
    _bind_mock(monkeypatch)
    raw = _make_key(client)
    extra = {"reasoning_effort": "medium"}

    denied = _chat(client, raw, f"{provider['name']}/plain-model", extra)
    assert denied.status_code == 403, denied.text
    assert "supports_reasoning" in denied.text

    ok = _chat(client, raw, f"{provider['name']}/think-model", extra)
    assert ok.status_code == 200, ok.text

    # "none"/"default" mean thinking off: must not trip the gate.
    off = _chat(client, raw, f"{provider['name']}/plain-model", {"reasoning_effort": None})
    assert off.status_code == 200, off.text


def test_stream_gate(client: TestClient, provider_factory, model_factory, monkeypatch) -> None:
    provider = provider_factory("GateStream")
    model_factory(provider["id"], model_id="nostream-model", supports_streaming=False)
    model_factory(provider["id"], model_id="stream-model", supports_streaming=True)
    _bind_mock(monkeypatch)
    raw = _make_key(client)

    denied = _chat(client, raw, f"{provider['name']}/nostream-model", {"stream": True})
    assert denied.status_code == 403, denied.text
    assert "supports_streaming" in denied.text

    with client.stream(
        "POST", "/v1/chat/completions",
        json={"model": f"{provider['name']}/stream-model",
              "messages": [{"role": "user", "content": "hi"}], "stream": True},
        headers=_auth(raw),
    ) as response:
        assert response.status_code == 200, response.text
        text = response.read().decode()
    assert "chat.completion.chunk" in text
    assert "data: [DONE]" in text


# --- media allow-lists ---------------------------------------------------------


def test_media_allow_lists_reject_bad_values() -> None:
    with pytest.raises(ValidationError, match="size"):
        translators.from_images({"model": "m", "prompt": "p", "size": "999x999"}, edits=False)
    with pytest.raises(ValidationError, match="quality"):
        translators.from_images({"model": "m", "prompt": "p", "quality": "ultra"}, edits=False)
    for bad_n in (0, 11):
        with pytest.raises(ValidationError, match="n"):
            translators.from_images({"model": "m", "prompt": "p", "n": bad_n}, edits=False)
    with pytest.raises(ValidationError, match="seconds"):
        translators.from_videos({"model": "m", "prompt": "p", "seconds": 5})
    with pytest.raises(ValidationError, match="seconds"):
        translators.from_videos({"model": "m", "prompt": "p", "seconds": "foo"})
    with pytest.raises(ValidationError, match="size"):
        translators.from_videos({"model": "m", "prompt": "p", "size": "1x1"})


def test_media_duration_alias_accepted() -> None:
    via_duration = translators.from_videos({"model": "m", "prompt": "p", "duration": 8})
    assert via_duration.media_options["seconds"] == "8"
    via_seconds = translators.from_videos({"model": "m", "prompt": "p", "seconds": 8})
    assert via_seconds.media_options == via_duration.media_options
    # Every allow-listed video length works through the alias too.
    for seconds in (4, 8, 12):
        assert translators.from_videos({"model": "m", "prompt": "p", "duration": seconds}).media_options["seconds"] == str(seconds)


def test_media_http_422s(client: TestClient, provider_factory, model_factory) -> None:
    provider = provider_factory("GateMedia")
    model_factory(provider["id"], model_id="media-model", supports_image_generation=True)
    raw = _make_key(client)
    ref = f"{provider['name']}/media-model"

    bad_size = client.post(
        "/v1/images/generations", json={"model": ref, "prompt": "p", "size": "999x999"},
        headers=_auth(raw),
    )
    assert bad_size.status_code == 422, bad_size.text

    bad_quality = client.post(
        "/v1/images/generations", json={"model": ref, "prompt": "p", "quality": "ultra"},
        headers=_auth(raw),
    )
    assert bad_quality.status_code == 422, bad_quality.text

    bad_seconds = client.post(
        "/v1/videos/generations", json={"model": ref, "prompt": "p", "seconds": 5},
        headers=_auth(raw),
    )
    assert bad_seconds.status_code == 422, bad_seconds.text
    assert "seconds" in bad_seconds.text


# --- streaming terminal rows ---------------------------------------------------


def _stream_prepared(response_format: str, chunks_or_adapter, **kw):
    from tollms.services.gateway.adapters.base import StreamChunk  # noqa: F401

    provider = SimpleNamespace(
        id=uuid.uuid4(), name="Mock", provider_type=ProviderType.OPENAI, user_id=uuid.uuid4()
    )
    model = SimpleNamespace(
        id=uuid.uuid4(), model_id="mock-model", provider_id=provider.id,
        input_price=Decimal("1"), output_price=Decimal("2"),
        cache_read_price=Decimal("0"), cache_write_price=Decimal("0"),
    )
    ctx = SimpleNamespace(key_id=uuid.uuid4(), user_id=provider.user_id, key_prefix="tma_sk_live_x")
    unified = translators.from_openai_chat(
        {"model": "mock", "messages": [{"role": "user", "content": "hi"}], "stream": True}
    )
    unified.response_format = response_format

    class _ListAdapter:
        def __init__(self, chunks):
            self._chunks = chunks

        async def chat_stream(self, messages):
            for chunk in self._chunks:
                yield chunk

    adapter = chunks_or_adapter if hasattr(chunks_or_adapter, "chat_stream") else _ListAdapter(chunks_or_adapter)
    return gateway_service._Prepared(  # noqa: SLF001
        ctx=ctx, meta=gateway_service.ClientMeta(request_id=f"req-{uuid.uuid4().hex[:8]}"),
        unified=unified, provider=provider, model=model, adapter=adapter,
        messages=[], history_text="hi", started=0.0,
    )


async def _collect(iterator):
    frames = []
    async for frame in iterator:
        frames.append(frame)
    return frames


def test_streaming_success_logs_exactly_one_row() -> None:
    prepared = _stream_prepared("openai", [StreamChunk(delta="hi", prompt_tokens=3, completion_tokens=2, total_tokens=5)])
    logged: list = []
    with (
        patch.object(gateway_service, "find_for_model", return_value=None),
        patch.object(gateway_service, "record_usage", lambda *a, **k: None),
        patch.object(gateway_service, "log_request", lambda db, entry: logged.append(entry)),
    ):
        frames = asyncio.run(_collect(gateway_service._stream_chat(prepared, db=None)))  # noqa: SLF001
    assert len(logged) == 1
    assert logged[0].status == "success" and logged[0].is_streaming is True
    assert frames[-1] == "data: [DONE]\n\n"


def test_streaming_midstream_failure_logs_failed_once() -> None:
    class _Failing:
        async def chat_stream(self, messages):
            yield StreamChunk(delta="partial")
            raise RuntimeError("provider error 500: boom")

    prepared = _stream_prepared("openai", _Failing())
    logged: list = []
    with (
        patch.object(gateway_service, "find_for_model", return_value=None),
        patch.object(gateway_service, "record_usage", lambda *a, **k: None),
        patch.object(gateway_service, "log_request", lambda db, entry: logged.append(entry)),
    ):
        frames = asyncio.run(_collect(gateway_service._stream_chat(prepared, db=None)))  # noqa: SLF001
    assert len(logged) == 1
    assert logged[0].status == "failed"
    assert logged[0].error_code == "PROVIDER_ERROR"
    assert frames[-1] == "data: [DONE]\n\n"
    assert '"error"' in frames[-2]


def test_streaming_timeout_maps_to_TIMEOUT_code() -> None:
    import httpx as _httpx

    class _TimeoutMidStream:
        async def chat_stream(self, messages):
            yield StreamChunk(delta="partial")
            raise _httpx.TimeoutException("timed out", request=None)

    prepared = _stream_prepared("openai", _TimeoutMidStream())
    logged: list = []
    with (
        patch.object(gateway_service, "find_for_model", return_value=None),
        patch.object(gateway_service, "record_usage", lambda *a, **k: None),
        patch.object(gateway_service, "log_request", lambda db, entry: logged.append(entry)),
    ):
        frames = asyncio.run(_collect(gateway_service._stream_chat(prepared, db=None)))  # noqa: SLF001
    assert len(logged) == 1
    assert logged[0].status == "failed"
    assert logged[0].error_code == "TIMEOUT"
    assert "TIMEOUT" in "".join(frames)


def test_streaming_cancelled_error_logs_cancelled_once() -> None:
    class _Cancelled:
        async def chat_stream(self, messages):
            yield StreamChunk(delta="partial")
            raise asyncio.CancelledError()

    prepared = _stream_prepared("openai", _Cancelled())
    logged: list = []
    with (
        patch.object(gateway_service, "find_for_model", return_value=None),
        patch.object(gateway_service, "record_usage", lambda *a, **k: None),
        patch.object(gateway_service, "log_request", lambda db, entry: logged.append(entry)),
    ):
        with pytest.raises(asyncio.CancelledError):
            asyncio.run(_collect(gateway_service._stream_chat(prepared, db=None)))  # noqa: SLF001
    assert len(logged) == 1
    assert logged[0].status == "cancelled"


def test_streaming_generator_exit_logs_cancelled_once() -> None:
    prepared = _stream_prepared("openai", [StreamChunk(delta="a"), StreamChunk(delta="b")])
    logged: list = []
    recorded: list = []
    with (
        patch.object(gateway_service, "find_for_model", return_value=None),
        patch.object(gateway_service, "record_usage", lambda *a, **k: recorded.append(k)),
        patch.object(gateway_service, "log_request", lambda db, entry: logged.append(entry)),
    ):
        async def _abandon():
            gen = gateway_service._stream_chat(prepared, db=None)  # noqa: SLF001
            first = await gen.__anext__()
            assert first is not None
            await gen.aclose()

        asyncio.run(_abandon())
    assert len(logged) == 1
    assert logged[0].status == "cancelled"


def test_streaming_http_failure_persists_single_failed_row(
    client: TestClient, db, provider_factory, model_factory, monkeypatch
) -> None:
    """End-to-end: a transport raising mid-stream leaves exactly one failed row."""
    import httpx as _httpx

    provider = provider_factory("GateStreamFail")
    model_factory(provider["id"], model_id="fail-model")
    raw = _make_key(client)

    class _BoomAdapter:
        def __init__(self, *a, **k):
            pass

        async def chat_stream(self, messages):
            yield StreamChunk(delta="partial")
            raise _httpx.TimeoutException("timed out", request=None)

    monkeypatch.setattr(gateway_service, "build_adapter", lambda *a, **k: _BoomAdapter())

    with client.stream(
        "POST", "/v1/chat/completions",
        json={"model": f"{provider['name']}/fail-model",
              "messages": [{"role": "user", "content": "hi"}], "stream": True},
        headers=_auth(raw),
    ) as response:
        assert response.status_code == 200, response.text
        text = response.read().decode()
    assert "TIMEOUT" in text

    rows = db.execute(select(ApiRequestLog).where(ApiRequestLog.status == "failed")).scalars().all()
    assert len(rows) == 1
    assert rows[0].error_code == "TIMEOUT"
    assert rows[0].is_streaming is True
