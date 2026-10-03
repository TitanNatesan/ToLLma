"""Provider catalog: discovery, idempotent sync, gateway distinction, logo URLs."""

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from tollms.api.repository import service as repo_service
from tollms.models.provider_catalog import ProviderCatalog
from tollms.services.model_repository import sync as sync_engine
from tollms.services.model_repository.sources import (
    MODELSDEV_LOGO_URL,
    normalize_modelsdev_providers,
)


PROVIDERS_SAMPLE = {
    "anthropic": {
        "id": "anthropic", "name": "Anthropic", "doc": "https://docs.anthropic.com",
        "env": ["ANTHROPIC_API_KEY"], "npm": "@ai-sdk/anthropic",
        "models": {"claude-haiku-4-5": {"name": "Haiku", "cost": {}, "limit": {}}},
    },
    "some-new-lab": {
        "id": "Some-New-LAB", "name": "Some New Lab",
        "models": {"m1": {"name": "M1", "cost": {}, "limit": {}}},
    },
    "broken": "not-a-dict",
}

GROUPS_SAMPLE = {
    "anthropic/claude-haiku-4-5": [],
    "some-new-lab/m1": [],
}


def _groups_with_caps():
    from tollms.services.model_repository.sources import NormalizedModel

    def rec(provider: str, chat: bool) -> "NormalizedModel":
        return NormalizedModel(
            source="modelsdev", model_key=f"{provider}/m", canonical_name="m",
            provider=provider, provider_model_id="m",
            caps={"supports_chat": chat, "supports_streaming": True},
        )

    return {
        "anthropic/m": [rec("anthropic", True)],
        "some-new-lab/m1": [rec("some-new-lab", False)],
    }


def test_provider_normalization_slug_logo_and_alias(db: Session) -> None:
    rows = {r["slug"]: r for r in normalize_modelsdev_providers(PROVIDERS_SAMPLE)}
    assert set(rows) == {"anthropic", "some-new-lab"}
    assert rows["some-new-lab"]["name"] == "Some New Lab"  # slug lowercased, name kept
    assert rows["anthropic"]["doc_url"] == "https://docs.anthropic.com"
    assert rows["anthropic"]["env_vars"] == ["ANTHROPIC_API_KEY"]
    assert rows["anthropic"]["model_count"] == 1
    assert MODELSDEV_LOGO_URL.format(slug="anthropic") == "https://models.dev/logos/anthropic.svg"


def test_catalog_upsert_is_idempotent(db: Session) -> None:
    first = sync_engine.sync_provider_catalog(db, normalize_modelsdev_providers(PROVIDERS_SAMPLE), _groups_with_caps())
    db.commit()
    assert first["created"] == 2
    second = sync_engine.sync_provider_catalog(db, normalize_modelsdev_providers(PROVIDERS_SAMPLE), _groups_with_caps())
    db.commit()
    assert second == {"created": 0, "updated": 0, "deactivated": 0}
    rows = db.execute(select(ProviderCatalog).where(ProviderCatalog.is_deleted.is_(False))).scalars().all()
    assert len(rows) == 2


def test_catalog_gateway_mapping_and_capabilities(db: Session) -> None:
    sync_engine.sync_provider_catalog(db, normalize_modelsdev_providers(PROVIDERS_SAMPLE), _groups_with_caps())
    db.commit()
    anthropic = db.execute(
        select(ProviderCatalog).where(ProviderCatalog.slug == "anthropic")).scalars().one()
    assert anthropic.gateway_supported is True
    assert anthropic.gateway_family == "ANTHROPIC_MESSAGES"
    assert anthropic.logo_url == "https://models.dev/logos/anthropic.svg"
    assert anthropic.capabilities["chat_supported"] is True
    assert anthropic.capabilities["credentials_supported"] is True
    lab = db.execute(select(ProviderCatalog).where(ProviderCatalog.slug == "some-new-lab")).scalars().one()
    assert lab.gateway_supported is False
    assert lab.gateway_family is None
    assert lab.capabilities["chat_supported"] is False


def test_catalog_deactivates_vanished_providers(db: Session) -> None:
    sync_engine.sync_provider_catalog(db, normalize_modelsdev_providers(PROVIDERS_SAMPLE), _groups_with_caps())
    db.commit()
    res = sync_engine.sync_provider_catalog(db, normalize_modelsdev_providers({
        "anthropic": PROVIDERS_SAMPLE["anthropic"],
    }), _groups_with_caps())
    db.commit()
    assert res["deactivated"] == 1
    lab = db.execute(select(ProviderCatalog).where(ProviderCatalog.slug == "some-new-lab")).scalars().one()
    assert lab.is_active is False
    # Never deleted.
    assert lab.is_deleted is False


def test_catalog_rows_hold_no_credentials(db: Session) -> None:
    sync_engine.sync_provider_catalog(db, normalize_modelsdev_providers(PROVIDERS_SAMPLE), _groups_with_caps())
    db.commit()
    import json

    for row in db.execute(select(ProviderCatalog)).scalars().all():
        blob = json.dumps([row.name, row.doc_url, row.api_base_url, row.capabilities, row.extra]).lower()
        assert "api_key" not in blob or "api_key" in str(row.env_vars).lower()
        assert "secret" not in blob
        assert "token" not in blob or "budget_tokens" not in blob


def test_catalog_api_endpoints(client: TestClient, db: Session, user_factory) -> None:
    user_factory()
    sync_engine.sync_provider_catalog(db, normalize_modelsdev_providers(PROVIDERS_SAMPLE), _groups_with_caps())
    db.commit()
    page = client.get("/api/v1/catalog/providers", params={"page_size": 50})
    assert page.status_code == 200, page.text
    assert page.json()["total"] == 2
    search = client.get("/api/v1/catalog/providers", params={"search": "anthr"})
    assert search.json()["total"] == 1
    supported = client.get("/api/v1/catalog/providers", params={"gateway_supported": True})
    assert {i["slug"] for i in supported.json()["items"]} == {"anthropic"}
    detail = client.get("/api/v1/catalog/providers/anthropic")
    assert detail.status_code == 200
    assert detail.json()["logo_url"] == "https://models.dev/logos/anthropic.svg"
    assert client.get("/api/v1/catalog/providers/nope").status_code == 404
    stats = client.get("/api/v1/catalog/stats")
    assert stats.status_code == 200
    assert stats.json()["total_providers"] == 2
    assert stats.json()["gateway_supported_providers"] == 1
