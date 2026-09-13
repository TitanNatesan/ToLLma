"""Model Intelligence Repository: sync, dedupe, update, deactivate, search, stats."""

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tollms.api.repository import service
from tollms.services.model_repository import scheduler
from tollms.services.model_repository.sources import LiteLLMSourceAdapter


LITELLM_SAMPLE = {
    "anthropic/claude-sonnet-4": {
        "max_input_tokens": 200000,
        "max_output_tokens": 32000,
        "input_cost_per_token": 3e-06,
        "output_cost_per_token": 1.5e-05,
        "cache_read_input_token_cost": 3e-07,
        "litellm_provider": "anthropic",
        "mode": "chat",
        "supports_vision": True,
        "supports_function_calling": True,
        "supports_response_schema": True,
        "supports_prompt_caching": True,
    },
    "openai/gpt-4o": {
        "max_input_tokens": 128000,
        "max_output_tokens": 16384,
        "input_cost_per_token": 2.5e-06,
        "output_cost_per_token": 1e-05,
        "litellm_provider": "openai",
        "mode": "chat",
        "supports_vision": True,
    },
    "junk-entry": "not-a-dict",
}

OPENROUTER_SAMPLE = {
    "data": [
        {
            "id": "anthropic/claude-sonnet-4",
            "name": "Claude Sonnet 4",
            "description": "Hybrid reasoning model",
            "context_length": 200000,
            "architecture": {"input_modalities": ["text", "image"], "output_modalities": ["text"]},
            "pricing": {"prompt": "0.000003", "completion": "0.000015", "image": "0.004"},
            "supported_parameters": ["tools", "response_format"],
            "top_provider": {"max_completion_tokens": 64000},
            "created": 1746057600,
        },
        {
            "id": "x-ai/grok-4",
            "name": "Grok 4",
            "context_length": 256000,
            "architecture": {"input_modalities": ["text"], "output_modalities": ["text"]},
            "pricing": {"prompt": "0.000003", "completion": "0.000015"},
            "supported_parameters": [],
            "top_provider": {},
        },
        {"id": ""},
    ]
}


def test_sync_creates_and_dedupes(db: Session) -> None:
    run = service.run_sync(db, litellm_data=LITELLM_SAMPLE, openrouter_data=OPENROUTER_SAMPLE)
    assert run.status == "done"
    assert run.models_created == 3  # sonnet-4 merged, gpt-4o, grok-4
    assert run.models_updated == 0
    assert run.errors_count == 0

    sonnet = service.list_entries(db, search="sonnet", active_only=False)[0][0]
    assert sonnet.model_key == "anthropic/claude-sonnet-4"
    assert sorted(sonnet.sources) == ["litellm", "openrouter"]
    assert set(sonnet.raw_source_payload) == {"litellm", "openrouter"}
    # LiteLLM wins ties; OpenRouter fills gaps.
    assert sonnet.input_cost is not None and float(sonnet.input_cost) == pytest.approx(3e-06)
    assert sonnet.max_output_tokens == 32000  # litellm first
    assert sonnet.image_input_cost is not None  # openrouter-only field
    assert sonnet.display_name == "Claude Sonnet 4"  # openrouter-only field
    assert sonnet.supports_vision_input is True
    assert sonnet.supports_tool_calling is True
    assert sonnet.release_date is not None


def test_sync_updates_and_deactivates(db: Session) -> None:
    service.run_sync(db, litellm_data=LITELLM_SAMPLE, openrouter_data=OPENROUTER_SAMPLE)
    changed = dict(LITELLM_SAMPLE)
    changed["anthropic/claude-sonnet-4"] = {**changed["anthropic/claude-sonnet-4"], "input_cost_per_token": 9e-06}
    del changed["openai/gpt-4o"]
    run = service.run_sync(db, litellm_data=changed, openrouter_data={"data": []})
    assert run.models_updated >= 1
    assert run.models_deactivated == 2  # gpt-4o + grok-4 vanished

    sonnet = service.list_entries(db, search="sonnet", active_only=False)[0][0]
    assert float(sonnet.input_cost) == pytest.approx(9e-06)
    assert sonnet.is_active is True  # re-seen stays active
    gpt = service.list_entries(db, search="gpt-4o", active_only=False)[0][0]
    assert gpt.is_active is False
    active, total = service.list_entries(db, active_only=True), service.list_entries(db, active_only=False)
    assert len(active[0]) == len(total[0]) - 2


def test_source_failure_never_raises(db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "tollms.services.model_repository.sync.LiteLLMSourceAdapter.fetch",
        lambda self: (_ for _ in ()).throw(RuntimeError("boom")),
    )
    run = service.run_sync(db, openrouter_data={"data": []})
    assert run.status == "done"
    assert run.errors_count == 1
    assert any("litellm" in e for e in run.error_details)


def test_search_filter_pagination_and_stats(client: TestClient, db: Session) -> None:
    service.run_sync(db, litellm_data=LITELLM_SAMPLE, openrouter_data=OPENROUTER_SAMPLE)

    r = client.get("/api/v1/model-repository/stats")
    assert r.status_code == 200, r.text
    stats = r.json()
    assert stats["total_models"] == 3 and stats["active_models"] == 3
    assert stats["providers_count"] == 3
    assert stats["last_sync"]["status"] == "done"

    r = client.get("/api/v1/model-repository/models", params={"search": "claude"})
    assert r.status_code == 200 and r.json()["total"] == 1

    r = client.get("/api/v1/model-repository/models", params={"provider": "openai"})
    assert r.json()["total"] == 1 and r.json()["items"][0]["model_key"] == "openai/gpt-4o"

    r = client.get("/api/v1/model-repository/models", params={"capability": "supports_vision_input"})
    assert r.json()["total"] == 2

    r = client.get("/api/v1/model-repository/models", params={"capability": "nope"})
    assert r.status_code == 422

    r = client.get("/api/v1/model-repository/models", params={"page": 1, "page_size": 2})
    body = r.json()
    assert body["total"] == 3 and len(body["items"]) == 2
    r = client.get("/api/v1/model-repository/models", params={"page": 2, "page_size": 2})
    assert len(r.json()["items"]) == 1

    entry_id = client.get("/api/v1/model-repository/models", params={"search": "grok"}).json()["items"][0]["id"]
    r = client.get(f"/api/v1/model-repository/models/{entry_id}")
    assert r.status_code == 200 and r.json()["raw_source_payload"]["openrouter"]["id"] == "x-ai/grok-4"
    r = client.get(f"/api/v1/model-repository/models/{uuid.uuid4()}")
    assert r.status_code == 404

    r = client.get("/api/v1/model-repository/sync-history")
    assert r.status_code == 200 and len(r.json()) == 1 and r.json()[0]["models_created"] == 3


def test_scheduler_stays_off_under_pytest() -> None:
    assert scheduler._scheduler is None


def test_openrouter_prefixed_keys_canonicalize() -> None:
    records = LiteLLMSourceAdapter().normalize(
        {"openrouter/anthropic/claude-x": {"litellm_provider": "openrouter", "mode": "chat"}}
    )
    assert len(records) == 1
    assert records[0].model_key == "anthropic/claude-x"
    assert records[0].provider == "anthropic"
