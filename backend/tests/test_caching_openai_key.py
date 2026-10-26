"""OpenAI prompt_cache_key regression: stable per (provider, model)."""

import re
import uuid

from tollms.services.gateway import caching

_KEY_RE = re.compile(r"^tollma:oai:[0-9a-fA-F-]{36}:[0-9a-fA-F-]{36}$")


def _ids():
    return uuid.uuid4(), uuid.uuid4()


def test_key_stable_across_conversations() -> None:
    provider_id, model_row_id = _ids()
    first = caching.plan(
        "OPENAI",
        supported=True,
        conversation_id="conv-a",
        provider_id=provider_id,
        model_row_id=model_row_id,
    )
    second = caching.plan(
        "OPENAI",
        supported=True,
        conversation_id="conv-b",
        provider_id=provider_id,
        model_row_id=model_row_id,
    )
    assert first.enabled and first.strategy == "openai"
    assert first.cache_key is not None
    assert first.cache_key == second.cache_key


def test_key_differs_across_providers_and_models() -> None:
    provider_a, model_a = _ids()
    provider_b, model_b = _ids()
    base = caching.plan(
        "OPENAI", supported=True, provider_id=provider_a, model_row_id=model_a
    ).cache_key
    other_provider = caching.plan(
        "OPENAI", supported=True, provider_id=provider_b, model_row_id=model_a
    ).cache_key
    other_model = caching.plan(
        "OPENAI", supported=True, provider_id=provider_a, model_row_id=model_b
    ).cache_key
    assert base != other_provider
    assert base != other_model


def test_openai_params_emits_key_only_when_enabled() -> None:
    provider_id, model_row_id = _ids()
    enabled = caching.plan(
        "OPENAI", supported=True, provider_id=provider_id, model_row_id=model_row_id
    )
    assert caching.openai_params(enabled) == {"prompt_cache_key": enabled.cache_key}
    assert caching.openai_params(caching.plan("OPENAI", supported=False)) == {}
    assert caching.openai_params(None) == {}
    implicit = caching.plan("CUSTOM", supported=True)
    assert caching.openai_params(implicit) == {}


def test_key_contains_no_tenant_pii() -> None:
    provider_id, model_row_id = _ids()
    conv_id = f"conv-{uuid.uuid4()}"
    plan = caching.plan(
        "OPENAI",
        supported=True,
        conversation_id=conv_id,
        provider_id=provider_id,
        model_row_id=model_row_id,
    )
    assert plan.cache_key is not None
    assert _KEY_RE.match(plan.cache_key), plan.cache_key
    assert conv_id not in plan.cache_key
    assert "conv" not in plan.cache_key
