"""Diagnostic: exact Bedrock Converse payload shape for prompt-cache checkpoints.

Read-only w.r.t. product code — captures the serialized payload that
BedrockAdapter.chat_stream hands to converse_stream and asserts cachePoint
placement for: message-only prefixes, system+message prefixes, and the
inference-profile retry path. Mocks only (no AWS calls).

Context: live bench-haiku traffic shows cw=0 AND cr=0 despite stable
byte-identical prefixes. This file pins the wire shape so the remaining
suspects (min-token eligibility, TTL, provider-side routing) can be
distinguished from a payload-construction defect.
"""

import asyncio

import pytest

from tollms.services.gateway import caching
from tollms.services.gateway.adapters.base import ChatMessage
from tollms.services.gateway.adapters import bedrock as bedrock_mod
from tollms.services.gateway.adapters.bedrock import BedrockAdapter

MODEL = "anthropic.claude-haiku-4-5-20251001-v1:0"
RESOLVED = "us.anthropic.claude-haiku-4-5-20251001-v1:0"
CACHE_POINT = {"cachePoint": {"type": "default"}}

TEXT_EVENTS = [
    {"contentBlockDelta": {"delta": {"text": "ok"}}},
    {
        "metadata": {
            "usage": {
                "inputTokens": 10,
                "outputTokens": 5,
                "totalTokens": 15,
                "cacheReadInputTokens": 0,
                "cacheWriteInputTokens": 0,
            }
        }
    },
]


def _adapter() -> BedrockAdapter:
    adapter = BedrockAdapter(
        credentials={"access_key": "k", "secret_key": "s", "region": "us-east-1"},
        model_id=MODEL,
    )
    adapter.prompt_cache = caching.plan(
        "BEDROCK_CONVERSE", supported=True, conversation_id="conv-1", model_id=MODEL
    )
    assert adapter.prompt_cache.strategy == "bedrock"
    return adapter


def _capture(adapter: BedrockAdapter) -> tuple[list[dict], list]:
    """Swap _stream_events for a recorder returning canned text events."""
    seen: list[dict] = []

    def fake(payload: dict) -> list:
        seen.append(payload)
        return TEXT_EVENTS

    adapter._stream_events = fake  # type: ignore[method-assign]
    return seen, TEXT_EVENTS


def test_message_only_prefix_ends_with_cache_point() -> None:
    adapter = _adapter()
    seen, _ = _capture(adapter)
    asyncio.run(adapter.chat([ChatMessage(role="user", content="hello")]))

    assert len(seen) == 1
    payload = seen[0]
    assert payload == {
        "modelId": RESOLVED,
        "messages": [
            {"role": "user", "content": [{"text": "hello"}, CACHE_POINT]},
        ],
    }
    assert "system" not in payload  # no system key on message-only turns
    content = payload["messages"][0]["content"]
    assert content[-1] == CACHE_POINT  # checkpoint is the final block


def test_system_and_message_prefix_checkpoints() -> None:
    adapter = _adapter()
    seen, _ = _capture(adapter)
    asyncio.run(
        adapter.chat(
            [
                ChatMessage(role="system", content="stable instructions"),
                ChatMessage(role="user", content="first"),
                ChatMessage(role="assistant", content="answer"),
                ChatMessage(role="user", content="follow up"),
            ]
        )
    )

    assert len(seen) == 1
    payload = seen[0]
    assert payload["modelId"] == RESOLVED
    assert payload["system"] == [{"text": "stable instructions"}, CACHE_POINT]
    assert payload["messages"] == [
        {"role": "user", "content": [{"text": "first"}]},  # stable history: untouched
        {"role": "assistant", "content": [{"text": "answer"}]},
        {"role": "user", "content": [{"text": "follow up"}, CACHE_POINT]},
    ]


def test_retry_path_preserves_cache_points(monkeypatch: pytest.MonkeyPatch) -> None:
    """Inference-profile retry must forward system/messages blocks untouched."""
    import boto3
    from botocore.exceptions import ClientError

    calls: list[dict] = []

    class _FakeClient:
        def converse_stream(self, **kwargs: object) -> dict:
            calls.append(dict(kwargs))
            if len(calls) == 1:
                raise ClientError(
                    {
                        "Error": {
                            "Message": "on-demand throughput isn't supported for this model, use an inference profile"
                        }
                    },
                    "ConverseStream",
                )
            return {"stream": list(TEXT_EVENTS)}

    monkeypatch.setattr(boto3, "client", lambda *a, **k: _FakeClient())
    # Force the unprefixed id through so the retry branch is exercised.
    monkeypatch.setattr(bedrock_mod, "resolve_bedrock_model_id", lambda mid, region: mid)

    adapter = _adapter()
    asyncio.run(
        adapter.chat(
            [
                ChatMessage(role="system", content="stable instructions"),
                ChatMessage(role="user", content="hello"),
            ]
        )
    )

    assert len(calls) == 2
    first, second = calls
    assert second["modelId"] == f"us.{MODEL}"  # regional prefix added on retry
    assert first["modelId"] == MODEL
    # System/messages blocks — including both checkpoints — survive verbatim.
    assert second["system"] == first["system"] == [
        {"text": "stable instructions"},
        CACHE_POINT,
    ]
    assert second["messages"] == first["messages"] == [
        {"role": "user", "content": [{"text": "hello"}, CACHE_POINT]}
    ]


def test_no_plan_sends_bare_body() -> None:
    """Without a plan the payload stays byte-identical to the no-cache shape."""
    adapter = BedrockAdapter(
        credentials={"access_key": "k", "secret_key": "s", "region": "us-east-1"},
        model_id=MODEL,
    )
    seen, _ = _capture(adapter)
    asyncio.run(
        adapter.chat(
            [
                ChatMessage(role="system", content="stable instructions"),
                ChatMessage(role="user", content="hello"),
            ]
        )
    )
    assert seen[0] == {
        "modelId": RESOLVED,
        "messages": [{"role": "user", "content": [{"text": "hello"}]}],
        "system": [{"text": "stable instructions"}],
    }
