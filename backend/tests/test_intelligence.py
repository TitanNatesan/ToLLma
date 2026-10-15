"""Phase 2: canonicalization, source tracking, cost engine, repo-priced chat."""

import asyncio
from decimal import Decimal

import httpx
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from tollms.api.conversations.service import list_messages, usage_totals
from tollms.services.gateway.costing import PriceSet, UsageTokens, calculate, prices_for_model
from tollms.api.gateway.schemas import ChatRequest
from tollms.api.gateway.service import run_chat
from tollms.services.model_repository.canonical import canonicalize
from tollms.models.model_repository import RepositorySource
from tollms.api.repository.service import list_entries, run_sync
from tollms.services.model_repository.lookup import lookup
from tollms.api.models.service import get_model
import uuid


def test_canonicalize_unifies_separators() -> None:
    variants = ["anthropic/claude-sonnet-4", "anthropic.claude-sonnet-4", "anthropic:claude-sonnet-4"]
    assert len({canonicalize(v) for v in variants}) == 1


def test_separator_variants_merge_into_one_record(db: Session) -> None:
    run_sync(
        db,
        litellm_data={"anthropic.claude-x": {"litellm_provider": "anthropic", "mode": "chat"}},
        openrouter_data={"data": [{"id": "anthropic/claude-x", "name": "Claude X"}]},
        modelsdev_data={},
    )
    rows, total = list_entries(db, active_only=False)
    assert total == 1
    assert sorted(rows[0].sources) == ["litellm", "openrouter"]


def test_source_rows_rebuilt_with_payloads(db: Session) -> None:
    run_sync(
        db,
        litellm_data={"openai/gpt-4o": {"litellm_provider": "openai", "mode": "chat"}},
        openrouter_data={"data": []},
        modelsdev_data={},
    )
    entry = list_entries(db, active_only=False)[0][0]
    rows = list(db.scalars(select(RepositorySource)))
    assert len(rows) == 1
    assert rows[0].model_repository_id == entry.id
    assert rows[0].source_name == "litellm"
    assert rows[0].source_url is not None
    run_sync(db, litellm_data={"openai/gpt-4o": {"litellm_provider": "openai", "mode": "chat"}}, openrouter_data={"data": []}, modelsdev_data={})
    assert len(list(db.scalars(select(RepositorySource)))) == 1  # rewritten, not duplicated


def test_lookup_and_suggest(client: TestClient, db: Session, user_factory) -> None:
    user_factory("lookup@tollma.ai")
    run_sync(
        db,
        litellm_data={
            "openai/gpt-4o": {
                "max_input_tokens": 128000,
                "input_cost_per_token": 2.5e-06,
                "output_cost_per_token": 1e-05,
                "litellm_provider": "openai",
                "mode": "chat",
                "supports_vision": True,
            }
        },
        openrouter_data={"data": []},
        modelsdev_data={},
    )
    assert lookup(db, "openai/gpt-4o") is not None
    assert lookup(db, "openai.gpt-4o") is not None  # canonical variant
    assert lookup(db, "does-not-exist-anywhere") is None

    r = client.get("/api/v1/model-repository/lookup", params={"query": "gpt-4o"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["suggested"]["model_id"] == "gpt-4o"
    assert body["suggested"]["input_price"] == "2.500000000000"  # per-token -> per-1M
    assert body["suggested"]["output_price"] == "10.000000000000"
    assert body["suggested"]["supports_vision"] is True
    assert body["suggested"]["context_window"] == 128000
    assert client.get("/api/v1/model-repository/lookup", params={"query": "nope-nope"}).status_code == 404


def test_calculate_covers_cache_and_reasoning() -> None:
    prices = PriceSet(input=Decimal(2), output=Decimal(10), cache_read=Decimal(1), reasoning=Decimal(0))
    out = calculate(UsageTokens(prompt=1_000_000, completion=1_000_000, cache_read=1_000_000, reasoning=500_000), prices)
    # prompt total is inclusive of cached tokens: input bills the uncached
    # remainder (0 here), cache line bills its own discounted rate.
    assert out.input_cost == Decimal(0)
    assert out.cache_read_cost == Decimal(1)
    # reasoning has no explicit price -> billed at output rate, excluded from plain output
    assert out.reasoning_cost == Decimal(5)
    assert out.output_cost == Decimal(5)
    assert out.total_cost == out.input_cost + out.output_cost + out.cache_read_cost + out.reasoning_cost


def _repo_priced_chat(db: Session, provider_factory, model_factory):
    run_sync(
        db,
        litellm_data={
            "openai/mock-model": {
                "input_cost_per_token": 100e-06,  # repo: $100/1M in, nothing else
                "litellm_provider": "openai",
                "mode": "chat",
            }
        },
        openrouter_data={"data": []},
        modelsdev_data={},
    )
    p = provider_factory("MockRepo", ptype="OPENAI", creds={"api_key": "k"})
    m = model_factory(p["id"], model_id="mock-model", input_price="0", output_price="0")

    body = (
        'data: {"choices": [{"delta": {"content": "Hi"}}]}\n\n'
        'data: {"choices": [{"delta": {}}], "usage": {"prompt_tokens": 10, "completion_tokens": 5,'
        ' "total_tokens": 15, "prompt_tokens_details": {"cached_tokens": 4},'
        ' "completion_tokens_details": {"reasoning_tokens": 2}}}\n\n'
        "data: [DONE]\n\n"
    )

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=body.encode(), headers={"content-type": "text/event-stream"})

    result = asyncio.run(
        run_chat(
            db,
            ChatRequest(provider_id=uuid.UUID(p["id"]), model_id=uuid.UUID(m["id"]), message="hi"),
            httpx.MockTransport(handler),
        )
    )
    return result


def test_chat_uses_repository_pricing_and_cache_tokens(db: Session, provider_factory, model_factory) -> None:
    result = _repo_priced_chat(db, provider_factory, model_factory)
    # repo $100/1M input x 10 tokens with 4 cached: input bills the 6
    # uncached tokens (cache price is 0, so any cost proves repo pricing).
    assert abs(float(result.input_cost) - 0.0006) < 1e-9
    assert result.cache_read_tokens == 4
    assert result.reasoning_tokens == 2

    stored = [m for m in list_messages(db, result.conversation_id) if m.role.value == "assistant"][0]
    assert stored.cache_read_tokens == 4
    assert stored.reasoning_tokens == 2

    totals = usage_totals(db, result.conversation_id)
    assert totals.cache_read_tokens == 4 and totals.reasoning_tokens == 2
    assert len(totals.by_model) == 1 and totals.by_model[0].total_tokens == 15
    assert len(totals.by_provider) == 1 and totals.by_provider[0].provider_name == "MockRepo"


def test_model_create_snapshots_repository(client: TestClient, db: Session, provider_factory) -> None:
    run_sync(
        db,
        litellm_data={"openai/gpt-4o": {"input_cost_per_token": 2.5e-06, "litellm_provider": "openai", "mode": "chat"}},
        openrouter_data={"data": []},
        modelsdev_data={},
    )
    p = provider_factory("Snap")
    r = client.post(
        "/api/v1/models",
        json={
            "provider_id": p["id"], "model_id": "gpt-4o", "name": "GPT-4o custom",
            "endpoint_type": "chat_completions", "repository_model_key": "openai/gpt-4o",
            "input_price": "99",
        },
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["repository_model_key"] == "openai/gpt-4o"
    assert body["metadata"]["repository_snapshot"]["input_price"] == "0.000002500000"
    model = get_model(db, uuid.UUID(body["id"]))
    assert model.input_price == Decimal(99)  # override wins; snapshot preserved


def test_prices_for_model_falls_back_without_repo(provider_factory, model_factory, db: Session) -> None:
    p = provider_factory("Fallback")
    m = model_factory(p["id"])
    from tollms.api.models.service import get_model as _get

    prices = prices_for_model(_get(db, uuid.UUID(m["id"])), None)
    assert prices.input == Decimal("2.5") and prices.output == Decimal("10")
