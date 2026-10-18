"""Model Intelligence Repository: sync, dedupe, update, deactivate, search, stats.

Single-source pipeline: models.dev is the only catalog source. ``run_sync``
takes a keyword-only ``modelsdev_data`` payload (real api.json shape:
provider-keyed ``{slug: {id, env, npm, name, doc, models: {...}}}`` with costs
in $/1M tokens); tests stay offline by passing the payload directly.
"""

import uuid
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from tollms.api.repository import service
from tollms.services.model_repository import scheduler


def _model(model_id: str, **overrides):
    """One representative models.dev model entry (real api.json fields)."""
    info = {
        "id": model_id,
        "name": model_id,
        "description": f"{model_id} description",
        "family": "test",
        "attachment": False,
        "reasoning": False,
        "tool_call": False,
        "structured_output": False,
        "temperature": True,
        "knowledge": "2024-01",
        "release_date": "2024-05-13",
        "last_updated": "2024-06-01",
        "modalities": {"input": ["text"], "output": ["text"]},
        "open_weights": False,
        "limit": {"context": 128000, "output": 4096},
        "cost": {"input": 2.5, "output": 10.0},
    }
    info.update(overrides)
    return info


MODELSDEV_SAMPLE = {
    "anthropic": {
        "id": "anthropic",
        "name": "Anthropic",
        "doc": "https://docs.anthropic.com",
        "env": ["ANTHROPIC_API_KEY"],
        "npm": "@ai-sdk/anthropic",
        "models": {
            "claude-sonnet-4": _model(
                "claude-sonnet-4",
                name="Claude Sonnet 4",
                description="Hybrid reasoning model",
                family="claude",
                attachment=True,
                reasoning=True,
                tool_call=True,
                structured_output=True,
                knowledge="2025-01",
                release_date="2025-05-22",
                last_updated="2025-06-01",
                modalities={"input": ["text", "image"], "output": ["text"]},
                limit={"context": 200000, "output": 32000},
                cost={"input": 3.0, "output": 15.0, "cache_read": 0.3},
            ),
            # No cost / modalities / limits: stays NULL, never fabricated.
            "bare-bones": {"id": "bare-bones", "name": "Bare Bones"},
            "broken": "not-a-dict",
        },
    },
    "openai": {
        "id": "openai",
        "name": "OpenAI",
        "doc": "https://platform.openai.com/docs",
        "env": ["OPENAI_API_KEY"],
        "npm": "@ai-sdk/openai",
        "models": {
            "gpt-4o": _model(
                "gpt-4o",
                name="GPT-4o",
                description="Flagship multimodal model",
                family="gpt",
                attachment=True,
                tool_call=True,
                knowledge="2023-10",
                modalities={"input": ["text", "image"], "output": ["text"]},
                limit={"context": 128000, "output": 16384},
                cost={"input": 2.5, "output": 10.0, "cache_read": 1.25},
            ),
        },
    },
    "x-ai": {
        "id": "x-ai",
        "name": "xAI",
        "models": {
            "grok-4": _model(
                "grok-4",
                name="Grok 4",
                modalities={"input": ["text"], "output": ["text"]},
                limit={"context": 256000, "output": 64000},
                cost={"input": 3.0, "output": 15.0},
            ),
        },
    },
    "junk-provider": "not-a-dict",
}


def test_sync_creates_modelsdev_records(db: Session) -> None:
    run = service.run_sync(db, modelsdev_data=MODELSDEV_SAMPLE)
    assert run.status == "done"
    assert run.models_created == 4  # sonnet-4, bare-bones, gpt-4o, grok-4
    assert run.models_updated == 0
    assert run.errors_count == 0

    sonnet = service.list_entries(db, search="sonnet", active_only=False)[0][0]
    assert sonnet.model_key == "anthropic/claude-sonnet-4"
    assert sonnet.sources == ["modelsdev"]
    assert set(sonnet.raw_source_payload) == {"modelsdev"}
    # $3.00/1M input -> per-token.
    assert sonnet.input_cost is not None and float(sonnet.input_cost) == pytest.approx(3e-06)
    assert float(sonnet.output_cost) == pytest.approx(15e-06)
    assert float(sonnet.cache_read_cost) == pytest.approx(0.3e-06)
    assert sonnet.max_output_tokens == 32000
    assert sonnet.context_window == 200000
    assert sonnet.display_name == "Claude Sonnet 4"
    assert sonnet.supports_vision_input is True
    assert sonnet.supports_tool_calling is True
    assert sonnet.supports_reasoning is True
    assert sonnet.supports_prompt_caching is True
    assert sonnet.release_date is not None and sonnet.release_date.year == 2025


def test_missing_optional_fields_stay_null_never_fabricated(db: Session) -> None:
    service.run_sync(db, modelsdev_data=MODELSDEV_SAMPLE)
    bare = service.list_entries(db, search="bare-bones", active_only=False)[0][0]
    assert bare.input_cost is None
    assert bare.output_cost is None
    assert bare.context_window is None
    assert bare.max_output_tokens is None
    assert bare.description is None
    assert bare.display_name == "Bare Bones"


def test_sync_updates_and_deactivates(db: Session) -> None:
    service.run_sync(db, modelsdev_data=MODELSDEV_SAMPLE)
    changed = {
        "anthropic": {
            **MODELSDEV_SAMPLE["anthropic"],
            "models": {
                "claude-sonnet-4": {
                    **MODELSDEV_SAMPLE["anthropic"]["models"]["claude-sonnet-4"],
                    "cost": {"input": 9.0, "output": 15.0, "cache_read": 0.3},
                },
            },
        },
        "openai": MODELSDEV_SAMPLE["openai"],
    }
    run = service.run_sync(db, modelsdev_data=changed)
    assert run.models_updated >= 1
    assert run.models_deactivated == 2  # bare-bones + grok-4 vanished

    sonnet = service.list_entries(db, search="sonnet", active_only=False)[0][0]
    assert float(sonnet.input_cost) == pytest.approx(9e-06)
    assert sonnet.is_active is True  # re-seen stays active
    grok = service.list_entries(db, search="grok-4", active_only=False)[0][0]
    assert grok.is_active is False
    active, total = service.list_entries(db, active_only=True), service.list_entries(db, active_only=False)
    assert len(active[0]) == len(total[0]) - 2


def test_source_failure_never_raises_and_never_wipes(db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    service.run_sync(db, modelsdev_data=MODELSDEV_SAMPLE)
    before = service.list_entries(db, active_only=False)[1]

    monkeypatch.setattr(
        "tollms.services.model_repository.sync.ModelsDevSourceAdapter.fetch",
        lambda self: (_ for _ in ()).throw(RuntimeError("boom")),
    )
    run = service.run_sync(db)
    assert run.status == "done"
    assert run.errors_count == 1
    assert run.models_deactivated == 0
    assert any("modelsdev" in e for e in run.error_details)
    # Rows are preserved (deactivated, never deleted): no wipe.
    assert service.list_entries(db, active_only=False)[1] == before


def test_invalid_payload_rejected_without_rows(db: Session) -> None:
    from tollms.services.model_repository.sources import ModelsDevSourceAdapter

    assert ModelsDevSourceAdapter().normalize("not-a-dict") == []
    assert ModelsDevSourceAdapter().normalize({"p": "not-a-dict", "q": {"models": "nope"}}) == []
    assert ModelsDevSourceAdapter().normalize({}) == []
    run = service.run_sync(db, modelsdev_data={"junk": "not-a-dict"})
    assert run.status == "done"
    assert run.models_created == 0
    assert service.list_entries(db, active_only=False)[1] == 0


def test_canonical_ids_deterministic_and_resync_adds_no_dupes(db: Session) -> None:
    from tollms.services.model_repository.sources import ModelsDevSourceAdapter

    first_keys = [m.model_key for m in ModelsDevSourceAdapter().normalize(MODELSDEV_SAMPLE)]
    second_keys = [m.model_key for m in ModelsDevSourceAdapter().normalize(MODELSDEV_SAMPLE)]
    assert first_keys == second_keys
    assert len(set(first_keys)) == len(first_keys) == 4

    # Provider slug case is unified: "OpenAI" and "openai" land on one key.
    recs = ModelsDevSourceAdapter().normalize(
        {"OpenAI": {"id": "OpenAI", "name": "OpenAI", "models": {"gpt-4o": _model("gpt-4o")}}}
    )
    assert len(recs) == 1 and recs[0].model_key == "openai/gpt-4o" and recs[0].provider == "openai"

    run1 = service.run_sync(db, modelsdev_data=MODELSDEV_SAMPLE)
    assert run1.models_created == 4
    run2 = service.run_sync(db, modelsdev_data=MODELSDEV_SAMPLE)
    assert run2.status == "done" and run2.errors_count == 0
    assert run2.models_created == 0
    assert service.list_entries(db, active_only=False)[1] == 4


def test_search_filter_pagination_and_stats(client: TestClient, db: Session, user_factory) -> None:
    user_factory()
    service.run_sync(db, modelsdev_data=MODELSDEV_SAMPLE)

    r = client.get("/api/v1/model-repository/stats")
    assert r.status_code == 200, r.text
    stats = r.json()
    assert stats["total_models"] == 4 and stats["active_models"] == 4
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
    assert body["total"] == 4 and len(body["items"]) == 2
    r = client.get("/api/v1/model-repository/models", params={"page": 2, "page_size": 2})
    assert len(r.json()["items"]) == 2

    entry_id = client.get("/api/v1/model-repository/models", params={"search": "grok"}).json()["items"][0]["id"]
    r = client.get(f"/api/v1/model-repository/models/{entry_id}")
    assert r.status_code == 200 and r.json()["raw_source_payload"]["modelsdev"]["id"] == "grok-4"
    assert r.json()["sources"] == ["modelsdev"]
    r = client.get(f"/api/v1/model-repository/models/{uuid.uuid4()}")
    assert r.status_code == 404

    r = client.get("/api/v1/model-repository/sync-history")
    assert r.status_code == 200 and len(r.json()) == 1 and r.json()[0]["models_created"] == 4


def test_scheduler_stays_off_under_pytest() -> None:
    assert scheduler._scheduler is None


MODELSDEV_MEDIA_SAMPLE = {
    "openai": {
        "id": "openai",
        "name": "OpenAI",
        "env": ["OPENAI_API_KEY"],
        "npm": "@ai-sdk/openai",
        "models": {
            "gpt-image-1": _model(
                "gpt-image-1",
                name="GPT Image 1",
                modalities={"input": ["text"], "output": ["image"]},
                limit={"context": 4096, "output": 0},
                cost={},
            ),
            "sora-2": _model(
                "sora-2",
                name="Sora 2",
                modalities={"input": ["text"], "output": ["video"]},
                limit={"context": 4096, "output": 0},
                cost={},
            ),
            "gpt-5-chat": _model(
                "gpt-5-chat",
                name="GPT-5 Chat",
                reasoning=True,
                tool_call=True,
                modalities={"input": ["text"], "output": ["text"]},
                limit={"context": 400000, "output": 128000},
                cost={"input": 1.0, "output": 4.0, "cache_read": 0.5},
            ),
        },
    },
}


def test_sync_derives_media_capabilities_and_seeds_rate_card(db: Session) -> None:
    run = service.run_sync(db, modelsdev_data=MODELSDEV_MEDIA_SAMPLE)
    assert run.status == "done" and run.errors_count == 0

    image = service.list_entries(db, search="gpt-image-1", active_only=True)[0][0]
    assert image.supports_image_generation is True
    # Image editing has no models.dev signal: never fabricated.
    assert image.supports_image_editing is False
    assert image.supports_video_generation is False
    # Official OpenAI per-image rate card is seeded by the sync engine.
    assert float(image.image_low_price) == pytest.approx(0.011)
    assert float(image.image_medium_price) == pytest.approx(0.042)
    assert float(image.image_high_price) == pytest.approx(0.167)

    video = service.list_entries(db, search="sora-2", active_only=True)[0][0]
    assert video.supports_video_generation is True
    assert float(video.video_price_per_second) == pytest.approx(0.10)

    chat = service.list_entries(db, search="gpt-5-chat", active_only=True)[0][0]
    assert chat.supports_chat is True
    assert chat.supports_reasoning is True
    assert chat.supports_tool_calling is True
    assert chat.supports_prompt_caching is True


def test_repository_api_exposes_capabilities_and_media_prices(
    client: TestClient, db: Session, user_factory
) -> None:
    user_factory()
    service.run_sync(db, modelsdev_data=MODELSDEV_MEDIA_SAMPLE)
    entry_id = client.get("/api/v1/model-repository/models", params={"search": "gpt-image-1"}).json()[
        "items"
    ][0]["id"]
    body = client.get(f"/api/v1/model-repository/models/{entry_id}").json()
    assert body["supports_image_generation"] is True
    assert body["supports_image_editing"] is False
    assert body["supports_video_generation"] is False
    assert body["supports_responses"] is False
    assert float(body["image_low_price"]) == pytest.approx(0.011)
    assert body["video_price_per_second"] is None


def test_suggest_payload_carries_caching_and_media_rates(db: Session) -> None:
    from tollms.services.model_repository import lookup

    service.run_sync(db, modelsdev_data=MODELSDEV_MEDIA_SAMPLE)
    image_entry = service.list_entries(db, search="gpt-image-1", active_only=True)[0][0]
    suggested = lookup.suggest_payload(image_entry)
    assert suggested["supports_image_generation"] is True
    assert Decimal(suggested["metadata"]["image_low_price"]) == Decimal("0.011")
    assert Decimal(suggested["metadata"]["image_medium_price"]) == Decimal("0.042")
    assert Decimal(suggested["metadata"]["image_high_price"]) == Decimal("0.167")
    assert "video_price_per_second" not in suggested["metadata"]

    chat_entry = service.list_entries(db, search="gpt-5-chat", active_only=True)[0][0]
    chat = lookup.suggest_payload(chat_entry)
    assert chat["metadata"]["supports_prompt_caching"] is True
    assert chat["input_price"] == "1.000000000000"
    assert chat["output_price"] == "4.000000000000"


def test_modelsdev_normalizes_and_converts_per_million_pricing(db: Session) -> None:
    from tollms.services.model_repository.sources import ModelsDevSourceAdapter

    models = ModelsDevSourceAdapter().normalize(MODELSDEV_SAMPLE)
    assert len(models) == 4
    sonnet = next(m for m in models if m.model_key == "anthropic/claude-sonnet-4")
    assert sonnet.provider == "anthropic"
    # $3.00/1M input -> per-token.
    assert sonnet.pricing["input_cost"] == Decimal("3") / Decimal(1_000_000)
    assert sonnet.pricing["output_cost"] == Decimal("15") / Decimal(1_000_000)
    assert sonnet.pricing["cache_read_cost"] == Decimal("0.3") / Decimal(1_000_000)
    assert sonnet.context_window == 200000
    assert sonnet.max_output_tokens == 32000
    assert sonnet.caps["supports_vision_input"] is True
    assert sonnet.caps["supports_tool_calling"] is True
    assert sonnet.caps["supports_reasoning"] is True
    assert sonnet.release_date is not None and sonnet.release_date.year == 2025
    # Full upstream payload survives in raw (description, family, knowledge...).
    assert sonnet.raw["description"] == "Hybrid reasoning model"
    assert sonnet.raw["family"] == "claude"
    # Bare model: no cost/limits/modalities -> NULL pricing, never fabricated.
    bare = next(m for m in models if m.model_key == "anthropic/bare-bones")
    assert all(v is None for v in bare.pricing.values())
    assert bare.context_window is None and bare.max_output_tokens is None


def test_sync_single_source_no_dupes_and_source_rows(db: Session) -> None:
    run = service.run_sync(db, modelsdev_data=MODELSDEV_SAMPLE)
    assert run.status == "done"
    assert run.errors_count == 0
    from tollms.models.model_repository import RepositoryModel, RepositorySource

    rows = db.scalars(select(RepositoryModel)).all()
    keys = [m.model_key for m in rows]
    assert len(keys) == len(set(keys)) == 4
    assert all(m.sources == ["modelsdev"] for m in rows)
    sources = list(db.scalars(select(RepositorySource)).all())
    assert len(sources) == 4
    assert {s.source_name for s in sources} == {"modelsdev"}
    assert all(s.source_url == "https://models.dev/api.json?type=all" for s in sources)

    # Re-sync rewrites source rows (no duplicates) and creates nothing new.
    rerun = service.run_sync(db, modelsdev_data=MODELSDEV_SAMPLE)
    assert rerun.models_created == 0
    assert len(list(db.scalars(select(RepositorySource)).all())) == 4


def test_sources_module_is_modelsdev_only() -> None:
    import tollms.services.model_repository.sources as sources
    import tollms.services.model_repository.sync as sync_engine

    assert not hasattr(sources, "LITELLM_URL")
    assert not hasattr(sources, "OPENROUTER_URL")
    assert not hasattr(sources, "LiteLLMSourceAdapter")
    assert not hasattr(sources, "OpenRouterSourceAdapter")
    assert hasattr(sources, "ModelsDevSourceAdapter")
    assert sync_engine.SOURCE_URLS == {"modelsdev": "https://models.dev/api.json?type=all"}


def test_provider_catalog_synced_from_modelsdev_payload(client: TestClient, db: Session, user_factory) -> None:
    user_factory()
    run = service.run_sync(db, modelsdev_data=MODELSDEV_SAMPLE)
    assert run.status == "done" and run.errors_count == 0

    from tollms.models.provider_catalog import ProviderCatalog

    rows = {r.slug: r for r in db.execute(select(ProviderCatalog)).scalars().all()}
    assert set(rows) == {"anthropic", "openai", "x-ai"}
    assert rows["openai"].logo_url == "https://models.dev/logos/openai.svg"
    assert rows["anthropic"].model_count == 2
    assert rows["openai"].gateway_supported is True  # explicit slug mapping wins
    assert rows["x-ai"].gateway_supported is False  # catalog-only

    stats = client.get("/api/v1/catalog/stats")
    assert stats.status_code == 200, stats.text
    assert stats.json()["sources"] == ["modelsdev"]
    assert stats.json()["total_providers"] == 3


def test_fail_closed_empty_payload_preserves_catalog(db: Session) -> None:
    """Empty merge is fail-closed: nothing changes except SyncRun bookkeeping."""
    from tollms.models.model_repository import RepositorySource
    from tollms.models.provider_catalog import ProviderCatalog

    seed = service.run_sync(db, modelsdev_data=MODELSDEV_SAMPLE)
    assert seed.status == "done" and seed.models_created == 4

    before_active = service.list_entries(db, active_only=True)[1]
    assert before_active >= 2
    before_sources = sorted(
        (s.source_name, s.source_model_id, str(s.model_repository_id))
        for s in db.scalars(select(RepositorySource)).all()
    )
    assert len(before_sources) == 4
    before_catalog = {
        r.slug: (r.is_active, r.model_count)
        for r in db.execute(select(ProviderCatalog)).scalars().all()
    }
    assert before_catalog and all(active for active, _ in before_catalog.values())
    before_links = {m.model_key: m.catalog_slug for m in service.list_entries(db, active_only=False)[0]}

    run = service.run_sync(db, modelsdev_data={})
    assert run.status == "done"
    assert run.models_created == 0
    assert run.models_updated == 0
    assert run.models_deactivated == 0

    assert service.list_entries(db, active_only=True)[1] == before_active
    assert (
        sorted(
            (s.source_name, s.source_model_id, str(s.model_repository_id))
            for s in db.scalars(select(RepositorySource)).all()
        )
        == before_sources
    )
    assert {
        r.slug: (r.is_active, r.model_count)
        for r in db.execute(select(ProviderCatalog)).scalars().all()
    } == before_catalog
    assert {m.model_key: m.catalog_slug for m in service.list_entries(db, active_only=False)[0]} == before_links
    assert len(service.sync_history(db)) == 2  # only SyncRun bookkeeping changed


def test_fail_closed_fetch_error_preserves_attribution(
    db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Fetch failure is fail-closed: error recorded, catalog/attribution intact."""
    from tollms.models.model_repository import RepositorySource
    from tollms.models.provider_catalog import ProviderCatalog

    service.run_sync(db, modelsdev_data=MODELSDEV_SAMPLE)
    before_sources = sorted(
        (s.source_name, s.source_model_id, str(s.model_repository_id))
        for s in db.scalars(select(RepositorySource)).all()
    )
    assert len(before_sources) == 4
    before_catalog = {
        r.slug: (r.is_active, r.model_count)
        for r in db.execute(select(ProviderCatalog)).scalars().all()
    }
    before_active = service.list_entries(db, active_only=True)[1]

    monkeypatch.setattr(
        "tollms.services.model_repository.sync.ModelsDevSourceAdapter.fetch",
        lambda self: (_ for _ in ()).throw(RuntimeError("boom")),
    )
    run = service.run_sync(db)
    assert run.status == "done"
    assert run.errors_count == 1
    assert any("modelsdev" in e for e in run.error_details)
    assert run.models_created == 0
    assert run.models_updated == 0
    assert run.models_deactivated == 0

    assert (
        sorted(
            (s.source_name, s.source_model_id, str(s.model_repository_id))
            for s in db.scalars(select(RepositorySource)).all()
        )
        == before_sources
    )
    after_catalog = {
        r.slug: (r.is_active, r.model_count)
        for r in db.execute(select(ProviderCatalog)).scalars().all()
    }
    assert after_catalog == before_catalog
    assert all(active for active, _ in after_catalog.values())
    assert service.list_entries(db, active_only=True)[1] == before_active


def test_read_model_field_parity() -> None:
    """read_model preserves every public ModelRead field (no silent drops)."""
    from datetime import date, datetime, timezone

    from tollms.api.models.schemas import read_model
    from tollms.models.registered_model import AIModel, EndpointType

    now = datetime.now(timezone.utc)
    row = AIModel(
        id=uuid.uuid4(),
        provider_id=uuid.uuid4(),
        model_id="paragon-1",
        name="Paragon One",
        description="Distinctive description",
        endpoint_type=EndpointType.RESPONSES,
        primary_endpoint="responses",
        supported_endpoints=["responses", "chat_completions"],
        input_price=Decimal("1.5"),
        output_price=Decimal("7.25"),
        cache_read_price=Decimal("0.125"),
        cache_write_price=Decimal("0.5"),
        supports_text=True,
        supports_vision=True,
        supports_audio_input=True,
        supports_audio_output=False,
        supports_image_generation=False,
        supports_video_generation=True,
        supports_tool_calling=True,
        supports_reasoning=True,
        supports_embeddings=True,
        supports_streaming=False,
        context_window=200000,
        max_output_tokens=32000,
        release_date=date(2025, 5, 22),
        repository_model_key="openai/paragon-1",
        metadata_={"owner": "qa", "tier": "paragon"},
        is_active=False,
        created_at=now,
        updated_at=now,
    )
    got = read_model(row)
    assert got.id == row.id
    assert got.provider_id == row.provider_id
    assert got.model_id == "paragon-1"
    assert got.name == "Paragon One"
    assert got.description == "Distinctive description"
    assert got.endpoint_type == EndpointType.RESPONSES
    assert got.primary_endpoint == "responses"
    assert got.supported_endpoints == ["responses", "chat_completions"]
    assert got.input_price == Decimal("1.5")
    assert got.output_price == Decimal("7.25")
    assert got.cache_read_price == Decimal("0.125")
    assert got.cache_write_price == Decimal("0.5")
    assert got.supports_text is True
    assert got.supports_vision is True
    assert got.supports_audio_input is True
    assert got.supports_audio_output is False
    assert got.supports_image_generation is False
    assert got.supports_video_generation is True
    assert got.supports_tool_calling is True
    assert got.supports_reasoning is True
    assert got.supports_embeddings is True
    assert got.supports_streaming is False
    assert got.context_window == 200000
    assert got.max_output_tokens == 32000
    assert got.release_date == date(2025, 5, 22)
    assert got.repository_model_key == "openai/paragon-1"
    assert got.metadata_ == {"owner": "qa", "tier": "paragon"}
    assert got.model_dump(by_alias=True)["metadata"] == {"owner": "qa", "tier": "paragon"}
    assert got.is_active is False
    assert got.created_at == now
    assert got.updated_at == now
