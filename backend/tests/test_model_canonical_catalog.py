"""Normalized Models.dev catalog: canonical_model + association links + 3-endpoint sync.

Covers the canonical-first sync contract:
- canonical upsert + idempotency, NULL link when unresolvable,
  disappearance never deletes associations;
- catalog.json is consistency-check only (mismatch warns, data still used);
- catalog fetch failure still syncs api+models;
- reasoning_options / extra_cost / limit.input / structured_output /
  attachment+temperature land on the association row; suggest carries them;
- alembic upgrade head on a fresh DB;
- canonical list/detail + offerings pricing + filters + reasoning_options reads;
- no-duplicate canonicals; provider-first vs model-first navigation consistent.
"""

import logging
import os
import subprocess
import uuid
from decimal import Decimal
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import inspect, select, text
from sqlalchemy.orm import Session

from tollms.api.repository import service
from tollms.models.canonical_model import CanonicalModel
from tollms.models.model_repository import RepositoryModel


def _api_model(model_id: str, **overrides):
    info = {
        "id": model_id,
        "name": model_id,
        "modalities": {"input": ["text"], "output": ["text"]},
        "limit": {"context": 128000, "output": 4096},
        "cost": {"input": 2.5, "output": 10.0},
    }
    info.update(overrides)
    return info


API_CANONICAL = {
    "openai": {
        "id": "openai",
        "name": "OpenAI",
        "models": {
            "gpt-4o": _api_model(
                "gpt-4o",
                name="GPT-4o",
                family="gpt",
                reasoning=True,
                tool_call=True,
                modalities={"input": ["text", "image"], "output": ["text"]},
                limit={"context": 128000, "output": 16384},
                cost={"input": 2.5, "output": 10.0},
                canonical_model_id="openai/gpt-4o",
            ),
            # No canonical_model_id: link stays NULL, never fabricated.
            "orphan-lite": {"id": "orphan-lite", "name": "Orphan Lite"},
        },
    },
    "anthropic": {
        "id": "anthropic",
        "name": "Anthropic",
        "models": {
            "claude-x": _api_model(
                "claude-x",
                name="Claude X",
                modalities={"input": ["text"], "output": ["text"]},
                limit={"context": 200000, "output": 8000},
                cost={"input": 3.0, "output": 15.0},
                canonical_model_id="anthropic/claude-x",
            ),
        },
    },
}

MODELS_CANONICAL = {
    "openai/gpt-4o": {
        "id": "openai/gpt-4o",
        "name": "GPT-4o",
        "family": "gpt",
        "description": "Flagship",
        "open_weights": False,
        "knowledge": "2024-01",
        "release_date": "2024-05-13",
        "last_updated": "2024-06-01",
    },
    "anthropic/claude-x": {
        "id": "anthropic/claude-x",
        "name": "Claude X",
        "family": "claude",
        "open_weights": True,
        "knowledge": "2024-02",
    },
}


def _catalog_match(api=API_CANONICAL, models=MODELS_CANONICAL):
    return {"providers": api, "models": models}


# 1: canonical upsert + idempotency + NULL link -------------------------------

def test_canonical_upsert_links_when_resolvable_else_null(db: Session) -> None:
    run = service.run_sync(
        db,
        modelsdev_data=API_CANONICAL,
        modelsdev_models_data=MODELS_CANONICAL,
        modelsdev_catalog_data=_catalog_match(),
    )
    assert run.status == "done" and run.errors_count == 0

    canonicals = {c.canonical_id: c for c in db.scalars(select(CanonicalModel))}
    assert set(canonicals) == {"openai/gpt-4o", "anthropic/claude-x"}
    assert canonicals["openai/gpt-4o"].name == "GPT-4o"
    assert canonicals["openai/gpt-4o"].family == "gpt"
    assert canonicals["openai/gpt-4o"].open_weights is False
    assert canonicals["anthropic/claude-x"].open_weights is True

    rows = {r.model_key: r for r in service.list_entries(db, active_only=False)[0]}
    assert rows["openai/gpt-4o"].canonical_id == "openai/gpt-4o"
    assert rows["anthropic/claude-x"].canonical_id == "anthropic/claude-x"
    # Entry without canonical_model_id: NULL, never fabricated.
    assert rows["openai/orphan-lite"].canonical_id is None


def test_canonical_resync_adds_no_dupes(db: Session) -> None:
    service.run_sync(
        db,
        modelsdev_data=API_CANONICAL,
        modelsdev_models_data=MODELS_CANONICAL,
        modelsdev_catalog_data=_catalog_match(),
    )
    run2 = service.run_sync(
        db,
        modelsdev_data=API_CANONICAL,
        modelsdev_models_data=MODELS_CANONICAL,
        modelsdev_catalog_data=_catalog_match(),
    )
    assert run2.status == "done" and run2.errors_count == 0
    assert run2.models_created == 0
    assert service.list_entries(db, active_only=False)[1] == 3
    assert len(list(db.scalars(select(CanonicalModel)))) == 2
    # Canonical ids stable across re-sync.
    assert sorted(c.canonical_id for c in db.scalars(select(CanonicalModel))) == [
        "anthropic/claude-x",
        "openai/gpt-4o",
    ]


def test_canonical_disappearance_nulllink_but_never_deletes(db: Session) -> None:
    service.run_sync(
        db,
        modelsdev_data=API_CANONICAL,
        modelsdev_models_data=MODELS_CANONICAL,
        modelsdev_catalog_data=_catalog_match(),
    )
    # True disappearance: models.json drops gpt-4o AND no persisted row
    # exists (fallback has nothing to preserve). api.json unchanged.
    db.delete(
        db.scalars(
            select(CanonicalModel).where(CanonicalModel.canonical_id == "openai/gpt-4o")
        ).one()
    )
    db.commit()
    subset = {"other/x": {"id": "other/x", "name": "X"}}
    run = service.run_sync(
        db,
        modelsdev_data=API_CANONICAL,
        modelsdev_models_data=subset,
        modelsdev_catalog_data={"providers": API_CANONICAL, "models": subset},
    )
    assert run.status == "done"
    rows = {r.model_key: r for r in service.list_entries(db, active_only=False)[0]}
    # Associations preserved (never deleted, still active since api still serves them).
    assert set(rows) == {"openai/gpt-4o", "openai/orphan-lite", "anthropic/claude-x"}
    assert all(r.is_active for r in rows.values())
    # Dropped canonical resolves nowhere (not in run set, not in DB) -> NULL.
    assert rows["openai/gpt-4o"].canonical_id is None
    # Id persisted in DB from the seed run -> fallback preserves the link.
    assert rows["anthropic/claude-x"].canonical_id == "anthropic/claude-x"
    # Canonical rows themselves are never deleted by sync.
    assert "anthropic/claude-x" in {c.canonical_id for c in db.scalars(select(CanonicalModel))}
    assert "other/x" in {c.canonical_id for c in db.scalars(select(CanonicalModel))}


def test_canonical_absent_this_run_preserves_links(db: Session) -> None:
    service.run_sync(
        db,
        modelsdev_data=API_CANONICAL,
        modelsdev_models_data=MODELS_CANONICAL,
        modelsdev_catalog_data=_catalog_match(),
    )
    # Legacy single-payload run: no canonical data -> preserve existing links.
    run = service.run_sync(db, modelsdev_data=API_CANONICAL)
    assert run.status == "done"
    rows = {r.model_key: r for r in service.list_entries(db, active_only=False)[0]}
    assert rows["openai/gpt-4o"].canonical_id == "openai/gpt-4o"
    assert rows["anthropic/claude-x"].canonical_id == "anthropic/claude-x"
    assert rows["openai/orphan-lite"].canonical_id is None
    assert service.list_entries(db, active_only=False)[1] == 3


# 2: three-endpoint sync -------------------------------------------------------

def test_catalog_count_mismatch_warns_but_uses_api_models(
    db: Session, caplog: pytest.LogCaptureFixture
) -> None:
    mismatched = {
        "providers": {"only-one": {"id": "only-one"}},
        "models": dict(MODELS_CANONICAL, **{"extra/a": {}, "extra/b": {}}),
    }
    with caplog.at_level(logging.WARNING):
        run = service.run_sync(
            db,
            modelsdev_data=API_CANONICAL,
            modelsdev_models_data=MODELS_CANONICAL,
            modelsdev_catalog_data=mismatched,
        )
    assert run.status == "done"
    # api+models data still syncs despite the mismatch.
    assert service.list_entries(db, active_only=False)[1] == 3
    assert len(list(db.scalars(select(CanonicalModel)))) == 2
    assert run.errors_count == 0  # consistency check warns, it never fails the run
    assert "catalog.json" in caplog.text


def test_catalog_fetch_failure_still_syncs_api_models(
    db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    from tollms.services.model_repository import sources as src

    monkeypatch.setattr(src.ModelsDevSourceAdapter, "fetch", lambda self: API_CANONICAL)
    monkeypatch.setattr(src.ModelsDevSourceAdapter, "fetch_models", lambda self: MODELS_CANONICAL)
    monkeypatch.setattr(
        src.ModelsDevSourceAdapter,
        "fetch_catalog",
        lambda self: (_ for _ in ()).throw(RuntimeError("catalog boom")),
    )
    # Under pytest the engine skips live models/catalog fetches; drop the
    # guard so this test exercises the production three-fetch path.
    monkeypatch.delenv("PYTEST_CURRENT_TEST", raising=False)
    run = service.run_sync(db)
    assert run.status == "done"
    assert service.list_entries(db, active_only=False)[1] == 3
    assert len(list(db.scalars(select(CanonicalModel)))) == 2
    assert run.errors_count == 1
    assert any("catalog.json" in e for e in run.error_details)


# 3: field mapping + suggest ---------------------------------------------------

def test_reasoning_extra_limit_structured_attachment_temperature(db: Session) -> None:
    from tollms.services.model_repository.lookup import suggest_payload

    api = {
        "openai": {
            "id": "openai",
            "name": "OpenAI",
            "models": {
                "gpt-4o": _api_model(
                    "gpt-4o",
                    name="GPT-4o",
                    reasoning=True,
                    tool_call=True,
                    structured_output=True,
                    attachment=True,
                    temperature=0.7,
                    modalities={"input": ["text", "image"], "output": ["text"]},
                    limit={"context": 128000, "input": 90000, "output": 16384},
                    cost={
                        "input": 2.5,
                        "output": 10.0,
                        "tiers": [{"up_to": 100}],
                        "context_over_200k": 1.5,
                    },
                    reasoning_options=[
                        {"type": "effort", "values": ["low", "high"], "default": "low"}
                    ],
                    canonical_model_id="openai/gpt-4o",
                ),
            },
        },
    }
    models = {"openai/gpt-4o": {"id": "openai/gpt-4o", "name": "GPT-4o"}}
    service.run_sync(
        db, modelsdev_data=api, modelsdev_models_data=models,
        modelsdev_catalog_data={"providers": api, "models": models},
    )
    row = service.list_entries(db, search="gpt-4o", active_only=False)[0][0]
    assert row.reasoning_options == [{"type": "effort", "values": ["low", "high"], "default": "low"}]
    assert row.extra_cost == {"tiers": [{"up_to": 100}], "context_over_200k": 1.5}
    # limit.input wins over limit.context for max_input_tokens.
    assert row.max_input_tokens == 90000
    assert row.context_window == 128000
    assert row.max_output_tokens == 16384
    assert row.supports_structured_output is True
    assert row.supports_reasoning is True
    assert row.supports_tool_calling is True
    assert row.metadata_["attachment"] is True
    assert row.metadata_["temperature"] == 0.7

    suggested = suggest_payload(row)
    assert suggested["reasoning_options"] == [
        {"type": "effort", "values": ["low", "high"], "default": "low"}
    ]


# 4: migration -----------------------------------------------------------------

def test_alembic_upgrade_head_on_fresh_db() -> None:
    from tollms.core.config import get_settings

    settings = get_settings()
    admin_url = (
        f"postgresql+psycopg://{settings.postgres_user}:{settings.postgres_password}"
        f"@{settings.postgres_host}:{settings.postgres_port}/postgres"
    )
    from sqlalchemy import create_engine

    dbname = "tollms_migcheck"
    admin = create_engine(admin_url, isolation_level="AUTOCOMMIT")
    with admin.connect() as conn:
        conn.execute(text(f"DROP DATABASE IF EXISTS {dbname} WITH (FORCE)"))
        conn.execute(text(f"CREATE DATABASE {dbname}"))
    admin.dispose()
    try:
        backend_root = Path(__file__).resolve().parents[1]
        env = dict(os.environ, POSTGRES_DB=dbname)
        proc = subprocess.run(
            ["python", "-m", "alembic", "upgrade", "head"],
            cwd=str(backend_root),
            env=env,
            capture_output=True,
            text=True,
            timeout=180,
        )
        assert proc.returncode == 0, proc.stdout + proc.stderr

        check_url = (
            f"postgresql+psycopg://{settings.postgres_user}:{settings.postgres_password}"
            f"@{settings.postgres_host}:{settings.postgres_port}/{dbname}"
        )
        eng = create_engine(check_url)
        insp = inspect(eng)
        try:
            assert "canonical_model" in insp.get_table_names()
            repo_cols = {c["name"] for c in insp.get_columns("model_repository")}
            assert {"canonical_id", "reasoning_options", "extra_cost"} <= repo_cols
            uqs = insp.get_unique_constraints("canonical_model")
            assert any(
                "canonical_id" in (u.get("column_names") or []) for u in uqs
            ), f"missing unique canonical_id: {uqs}"
            fks = insp.get_foreign_keys("model_repository")
            canon_fks = [f for f in fks if f.get("constrained_columns") == ["canonical_id"]]
            assert canon_fks, f"missing canonical_id FK: {fks}"
            assert canon_fks[0].get("referred_table") == "canonical_model"
            assert canon_fks[0].get("referred_columns") == ["canonical_id"]
            assert (canon_fks[0].get("options") or {}).get("ondelete") == "SET NULL"
        finally:
            eng.dispose()
    finally:
        admin = create_engine(admin_url, isolation_level="AUTOCOMMIT")
        with admin.connect() as conn:
            conn.execute(text(f"DROP DATABASE IF EXISTS {dbname} WITH (FORCE)"))
        admin.dispose()


# 5: API ------------------------------------------------------------------------

OFFER_API = {
    "openai": {
        "id": "openai",
        "name": "OpenAI",
        "models": {
            "shared-x": _api_model(
                "shared-x",
                name="Shared X (OpenAI)",
                reasoning=True,
                tool_call=True,
                modalities={"input": ["text", "image"], "output": ["text"]},
                limit={"context": 128000, "output": 4096},
                cost={"input": 2.5, "output": 10.0},
                reasoning_options=[{"type": "toggle", "default": "on"}],
                canonical_model_id="family/shared-x",
            ),
        },
    },
    "custom-lab": {
        "id": "custom-lab",
        "name": "Custom Lab",
        "models": {
            "shared-x": _api_model(
                "shared-x",
                name="Shared X (Custom)",
                modalities={"input": ["text"], "output": ["text"]},
                limit={"context": 32000, "output": 2048},
                cost={"input": 7.5, "output": 20.0},
                canonical_model_id="family/shared-x",
            ),
        },
    },
}
OFFER_MODELS = {
    "family/shared-x": {
        "id": "family/shared-x",
        "name": "Shared X",
        "family": "shared",
        "open_weights": True,
    },
}


def test_canonical_api_list_detail_offerings_pricing(
    client: TestClient, db: Session, user_factory
) -> None:
    user_factory()
    service.run_sync(
        db,
        modelsdev_data=OFFER_API,
        modelsdev_models_data=OFFER_MODELS,
        modelsdev_catalog_data={"providers": OFFER_API, "models": OFFER_MODELS},
    )
    r = client.get("/api/v1/model-repository/canonical")
    assert r.status_code == 200, r.text
    assert r.json()["total"] == 1
    assert r.json()["items"][0]["canonical_id"] == "family/shared-x"

    # Family + open-weights filters on the canonical endpoint.
    assert client.get("/api/v1/model-repository/canonical", params={"family": "shared"}).json()["total"] == 1
    assert client.get("/api/v1/model-repository/canonical", params={"family": "nope"}).json()["total"] == 0
    assert client.get("/api/v1/model-repository/canonical", params={"open_weights": True}).json()["total"] == 1
    assert client.get("/api/v1/model-repository/canonical", params={"open_weights": False}).json()["total"] == 0

    r = client.get("/api/v1/model-repository/canonical/family/shared-x")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["canonical"]["canonical_id"] == "family/shared-x"
    assert len(body["offerings"]) == 2
    prices = sorted(float(o["input_cost"]) for o in body["offerings"])
    assert prices == pytest.approx([2.5e-06, 7.5e-06])
    # Separator/case variant resolves to the same record.
    alt = client.get("/api/v1/model-repository/canonical/FAMILY.SHARED-X")
    assert alt.status_code == 200 and alt.json()["canonical"]["canonical_id"] == "family/shared-x"
    assert client.get("/api/v1/model-repository/canonical/nope/missing").status_code == 404

    # reasoning_options present on repository model reads.
    for offering in body["offerings"]:
        if offering["model_key"] == "openai/shared-x":
            assert offering["reasoning_options"] == [{"type": "toggle", "default": "on"}]
            assert offering["canonical_id"] == "family/shared-x"


def test_repository_api_filters(client: TestClient, db: Session, user_factory) -> None:
    user_factory()
    service.run_sync(
        db,
        modelsdev_data=API_CANONICAL,
        modelsdev_models_data=MODELS_CANONICAL,
        modelsdev_catalog_data=_catalog_match(),
    )
    # Modality / tool_call / reasoning filters.
    assert client.get("/api/v1/model-repository/models", params={"modality": "vision"}).json()["total"] == 1
    assert client.get("/api/v1/model-repository/models", params={"tool_call": True}).json()["total"] == 1
    assert client.get("/api/v1/model-repository/models", params={"tool_call": False}).json()["total"] == 2
    assert client.get("/api/v1/model-repository/models", params={"reasoning": True}).json()["total"] == 1
    assert client.get("/api/v1/model-repository/models", params={"reasoning": False}).json()["total"] == 2
    assert client.get("/api/v1/model-repository/models", params={"min_context": 150000}).json()["total"] == 1
    # open_weights joins the canonical row; unlinked rows are excluded.
    assert client.get("/api/v1/model-repository/models", params={"open_weights": False}).json()["total"] == 1
    assert client.get("/api/v1/model-repository/models", params={"open_weights": True}).json()["total"] == 1
    # Unknown modality is a 422, not an empty page.
    assert client.get("/api/v1/model-repository/models", params={"modality": "nope"}).status_code == 422


def test_repository_family_filter_matches_upstream_family(
    client: TestClient, db: Session, user_factory
) -> None:
    """Association rows carry the upstream family so ?family= filters them.

    NormalizedModel.family is populated from the api.json ``family`` field
    (sources.py:_normalize_one) and merged onto RepositoryModel.family,
    so ?family=gpt matches the seeded gpt-4o row.
    """
    user_factory()
    service.run_sync(
        db,
        modelsdev_data=API_CANONICAL,
        modelsdev_models_data=MODELS_CANONICAL,
        modelsdev_catalog_data=_catalog_match(),
    )
    assert client.get("/api/v1/model-repository/models", params={"family": "gpt"}).json()["total"] == 1


def test_registry_and_suggest_carry_reasoning_options(
    client: TestClient, db: Session, user_factory, provider_factory
) -> None:
    user_factory()
    api = {
        "openai": {
            "id": "openai",
            "name": "OpenAI",
            "models": {
                "gpt-4o": _api_model(
                    "gpt-4o",
                    name="GPT-4o",
                    modalities={"input": ["text"], "output": ["text"]},
                    limit={"context": 128000, "output": 4096},
                    cost={"input": 2.5, "output": 10.0},
                    reasoning_options=[{"type": "effort", "values": ["low"], "default": "low"}],
                    canonical_model_id="openai/gpt-4o",
                ),
            },
        },
    }
    models = {"openai/gpt-4o": {"id": "openai/gpt-4o", "name": "GPT-4o"}}
    service.run_sync(
        db, modelsdev_data=api, modelsdev_models_data=models,
        modelsdev_catalog_data={"providers": api, "models": models},
    )
    # Repository read + suggest payload.
    entry_id = client.get(
        "/api/v1/model-repository/models", params={"search": "gpt-4o"}
    ).json()["items"][0]["id"]
    assert client.get(f"/api/v1/model-repository/models/{entry_id}").json()["reasoning_options"] == [
        {"type": "effort", "values": ["low"], "default": "low"}
    ]
    assert client.get("/api/v1/model-repository/lookup", params={"query": "gpt-4o"}).json()[
        "suggested"
    ]["reasoning_options"] == [{"type": "effort", "values": ["low"], "default": "low"}]

    # Registry ModelRead / chat picker share read_model: reasoning_options
    # rides in metadata and surfaces on reads.
    p = provider_factory("R")
    created = client.post(
        "/api/v1/models",
        json={
            "provider_id": p["id"],
            "model_id": "gpt-4o",
            "name": "GPT-4o",
            "endpoint_type": "chat_completions",
            "input_price": "2.5",
            "output_price": "10",
            "metadata": {"reasoning_options": [{"type": "effort", "values": ["low"], "default": "low"}]},
        },
    )
    assert created.status_code == 201, created.text
    assert created.json()["reasoning_options"] == [{"type": "effort", "values": ["low"], "default": "low"}]
    fetched = client.get(f"/api/v1/models/{created.json()['id']}")
    assert fetched.status_code == 200
    assert fetched.json()["reasoning_options"] == [{"type": "effort", "values": ["low"], "default": "low"}]


# 6: no-duplicate canonicals + navigation consistency ---------------------------

def test_no_duplicate_canonicals_and_navigation_consistent(db: Session) -> None:
    service.run_sync(
        db,
        modelsdev_data=OFFER_API,
        modelsdev_models_data=OFFER_MODELS,
        modelsdev_catalog_data={"providers": OFFER_API, "models": OFFER_MODELS},
    )
    service.run_sync(
        db,
        modelsdev_data=OFFER_API,
        modelsdev_models_data=OFFER_MODELS,
        modelsdev_catalog_data={"providers": OFFER_API, "models": OFFER_MODELS},
    )
    assert len(list(db.scalars(select(CanonicalModel)))) == 1

    # Provider-first: canonical list -> detail -> offerings.
    canonicals, total = service.list_canonicals(db)
    assert total == 1
    detail = service.get_canonical(db, canonicals[0].canonical_id)
    via_provider = service.get_canonical_offerings(db, detail.canonical_id)

    # Model-first: repository row -> canonical_id -> canonical detail.
    rows, _ = service.list_entries(db, active_only=False)
    assert len(rows) == 2
    for row in rows:
        assert row.canonical_id == detail.canonical_id
        assert service.get_canonical(db, row.canonical_id).canonical_id == detail.canonical_id
    via_model_keys = sorted(r.model_key for r in rows)
    assert sorted(r.model_key for r in via_provider) == via_model_keys
    # Provider-specific pricing preserved per offering.
    by_key = {r.model_key: r for r in via_provider}
    assert by_key["openai/shared-x"].input_cost == Decimal("2.5") / Decimal(1_000_000)
    assert by_key["custom-lab/shared-x"].input_cost == Decimal("7.5") / Decimal(1_000_000)


def test_unknown_canonical_id_raises_not_found(db: Session) -> None:
    from tollms.core.exceptions import NotFoundError

    service.run_sync(
        db,
        modelsdev_data=API_CANONICAL,
        modelsdev_models_data=MODELS_CANONICAL,
        modelsdev_catalog_data=_catalog_match(),
    )
    with pytest.raises(NotFoundError):
        service.get_canonical(db, "nope/missing")
    with pytest.raises(NotFoundError):
        service.get_canonical(db, "")
    assert service.get_canonical(db, "openai.gpt-4o").canonical_id == "openai/gpt-4o"


def test_suggest_payload_without_reasoning_is_null(db: Session) -> None:
    from tollms.services.model_repository.lookup import suggest_payload

    service.run_sync(db, modelsdev_data=API_CANONICAL)
    orphan = service.list_entries(db, search="orphan-lite", active_only=False)[0][0]
    assert orphan.reasoning_options is None
    assert suggest_payload(orphan)["reasoning_options"] is None


# 7: fail-closed hardening ----------------------------------------------------

def test_fetch_failure_with_partial_data_fail_closed(
    db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Partial api snapshot + models.json fetch failure stays fail-closed.

    The merged subset still upserts, but rows outside the subset are never
    deactivated and the missing models.json is recorded on the run.
    """
    service.run_sync(
        db,
        modelsdev_data=API_CANONICAL,
        modelsdev_models_data=MODELS_CANONICAL,
        modelsdev_catalog_data=_catalog_match(),
    )
    assert service.list_entries(db, active_only=True)[1] == 3

    subset_api = {
        "openai": {
            "id": "openai",
            "name": "OpenAI",
            "models": {"gpt-4o": API_CANONICAL["openai"]["models"]["gpt-4o"]},
        },
    }
    from tollms.services.model_repository import sources as src

    monkeypatch.setattr(src.ModelsDevSourceAdapter, "fetch", lambda self: subset_api)

    def _boom(self):
        raise RuntimeError("models boom")

    monkeypatch.setattr(src.ModelsDevSourceAdapter, "fetch_models", _boom)
    monkeypatch.setattr(
        src.ModelsDevSourceAdapter,
        "fetch_catalog",
        lambda self: {"providers": subset_api, "models": {}},
    )
    # Exercise the production three-fetch path (offline by default under pytest).
    monkeypatch.delenv("PYTEST_CURRENT_TEST", raising=False)
    run = service.run_sync(db)
    assert run.status == "done"
    assert run.errors_count >= 1
    assert any("models.json" in e for e in run.error_details)
    # Fail-closed: nothing outside the subset is deactivated.
    assert run.models_deactivated == 0
    rows = {r.model_key: r for r in service.list_entries(db, active_only=False)[0]}
    assert rows["anthropic/claude-x"].is_active is True
    assert rows["openai/orphan-lite"].is_active is True
    # The merged subset still upserts.
    assert rows["openai/gpt-4o"].is_active is True
    assert service.list_entries(db, active_only=True)[1] == 3


def test_canonical_fallback_preserves_link_when_run_set_lacks_id(db: Session) -> None:
    """A truncated models.json snapshot falls back to DB-persisted canonicals.

    The api payload still references openai/gpt-4o but this run's models
    payload lacks it (fetch succeeded, so no fail-closed): the link is
    preserved via the already-persisted canonical row instead of NULL.
    """
    service.run_sync(
        db,
        modelsdev_data=API_CANONICAL,
        modelsdev_models_data=MODELS_CANONICAL,
        modelsdev_catalog_data=_catalog_match(),
    )
    rows = {r.model_key: r for r in service.list_entries(db, active_only=False)[0]}
    assert rows["openai/gpt-4o"].canonical_id == "openai/gpt-4o"

    subset_models = {"other/x": {"id": "other/x", "name": "X"}}
    run = service.run_sync(
        db,
        modelsdev_data=API_CANONICAL,
        modelsdev_models_data=subset_models,
        modelsdev_catalog_data={"providers": API_CANONICAL, "models": subset_models},
    )
    assert run.status == "done"
    assert run.errors_count == 0
    rows = {r.model_key: r for r in service.list_entries(db, active_only=False)[0]}
    assert rows["openai/gpt-4o"].canonical_id == "openai/gpt-4o"
    assert rows["anthropic/claude-x"].canonical_id == "anthropic/claude-x"


def test_validated_reasoning_level_constrains_to_catalog_options() -> None:
    """validated_reasoning_level mirrors the frontend capabilities gate."""
    import uuid as _uuid

    from tollms.api.gateway.service import validated_reasoning_level
    from tollms.models.registered_model import AIModel, EndpointType

    def _model(options):
        return AIModel(
            provider_id=_uuid.uuid4(),
            model_id="m",
            name="M",
            endpoint_type=EndpointType.CHAT_COMPLETIONS,
            metadata_={} if options is None else {"reasoning_options": options},
        )

    effort = [{"type": "effort", "values": ["low", "high"], "default": "low"}]
    assert validated_reasoning_level(_model(effort), "low") == "low"
    assert validated_reasoning_level(_model(effort), "high") == "high"
    assert validated_reasoning_level(_model(effort), "ultra") is None
    assert validated_reasoning_level(_model(effort), "none") == "none"
    assert validated_reasoning_level(_model(effort), "default") == "default"

    budget = [{"type": "budget_tokens", "min": 1024, "max": 8192}]
    assert validated_reasoning_level(_model(budget), "2048") == "2048"
    assert validated_reasoning_level(_model(budget), "abc") is None
    assert validated_reasoning_level(_model(budget), "512") is None

    toggle = [{"type": "toggle", "default": "on"}]
    assert validated_reasoning_level(_model(toggle), "on") == "on"
    assert validated_reasoning_level(_model(toggle), "off") is None

    assert validated_reasoning_level(_model(None), "high") == "high"
    assert validated_reasoning_level(_model([]), "high") == "high"
    assert validated_reasoning_level(_model(effort), None) is None
