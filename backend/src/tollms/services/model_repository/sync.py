"""Model repository sync engine: fetch, normalize, merge, store, deactivate, report.

Reusable backend engine (services layer). Query/match helpers live in
lookup.py; the feature-level API service lives in api/repository/service.py.
"""

import logging
import os
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from tollms.models.canonical_model import CanonicalModel
from tollms.models.model_repository import RepositoryModel, RepositorySource, SyncRun
from tollms.models.provider import ProviderType
from tollms.models.provider_catalog import ProviderCatalog
from tollms.services.cache import keys as cache_keys
from tollms.services.cache.manager import cache_invalidate_sync
from tollms.services.cost_estimator import official_media_prices
from tollms.services.model_repository.canonical import canonicalize
from tollms.services.model_repository.sources import (
    MODELS_DEV_URL,
    MODELSDEV_LOGO_URL,
    ModelsDevSourceAdapter,
    NormalizedCanonical,
    NormalizedModel,
    normalize_modelsdev_providers,
)

logger = logging.getLogger(__name__)

CAPABILITY_FIELDS = (
    "supports_text_input",
    "supports_text_output",
    "supports_chat",
    "supports_vision_input",
    "supports_image_output",
    "supports_audio_input",
    "supports_audio_output",
    "supports_video_input",
    "supports_video_output",
    "supports_reasoning",
    "supports_tool_calling",
    "supports_structured_output",
    "supports_streaming",
    "supports_embeddings",
    "supports_prompt_caching",
    "supports_responses",
    "supports_image_generation",
    "supports_image_editing",
    "supports_video_generation",
)

CHAT_WIRE_ENDPOINTS = frozenset({"chat_completions", "responses", "messages", "converse"})

PRICE_FIELDS = (
    "input_cost",
    "output_cost",
    "cache_read_cost",
    "cache_write_cost",
    "image_input_cost",
    "image_output_cost",
    "audio_input_cost",
    "audio_output_cost",
    "video_input_cost",
    "video_output_cost",
    "reasoning_cost",
    "image_low_price",
    "image_medium_price",
    "image_high_price",
    "video_price_per_second",
)

LIMIT_FIELDS = (
    "context_window",
    "max_input_tokens",
    "max_output_tokens",
    "max_images",
    "max_audio_length",
    "max_video_length",
)

_ERROR_DETAILS_CAP = 20


def merge_records(groups: dict[str, list[NormalizedModel]]) -> dict[str, dict[str, Any]]:
    """Merge normalized records into one dict per canonical key.

    Single source (models.dev): scalars take the first non-null value;
    capabilities OR-merge; raw payloads are kept per source. ToLLma
    operational metadata (gateway support, adapter choice, credentials)
    lives outside these rows and is never overwritten.
    """
    merged: dict[str, dict[str, Any]] = {}
    for key, records in groups.items():
        ordered = records
        first = ordered[0]
        row: dict[str, Any] = {
            "model_key": key,
            "canonical_name": first.canonical_name,
            "provider": first.provider,
            "provider_model_id": first.provider_model_id,
            "sources": list(dict.fromkeys(r.source for r in ordered)),
            "raw_source_payload": {r.source: r.raw for r in ordered},
        }
        for attr in ("display_name", "family", "vendor", "endpoint_type", "primary_endpoint", "description", "documentation_url", "release_date"):
            row[attr] = next((getattr(r, attr) for r in ordered if getattr(r, attr) is not None), None)
        for attr in ("canonical_id", "reasoning_options", "extra_cost"):
            row[attr] = next((getattr(r, attr) for r in ordered if getattr(r, attr) is not None), None)
        merged_meta: dict[str, Any] = {}
        for record in ordered:
            for meta_key, meta_value in (record.metadata_ or {}).items():
                merged_meta.setdefault(meta_key, meta_value)
        row["metadata_"] = merged_meta
        for cap in CAPABILITY_FIELDS:
            row[cap] = any(r.caps.get(cap, False) for r in ordered)
        # Endpoints union in record order; primary falls back to the
        # first supported endpoint and finally to the legacy endpoint_type.
        supported: list[str] = []
        for record in ordered:
            for endpoint in record.supported_endpoints:
                if endpoint not in supported:
                    supported.append(endpoint)
        if not supported and row["primary_endpoint"]:
            supported = [row["primary_endpoint"]]
        row["supported_endpoints"] = supported
        row["primary_endpoint"] = row["primary_endpoint"] or (supported[0] if supported else row["endpoint_type"])
        row["supports_chat"] = bool(row["supports_chat"] or (CHAT_WIRE_ENDPOINTS & set(supported)))
        for limit in LIMIT_FIELDS:
            row[limit] = next((getattr(r, limit) for r in ordered if getattr(r, limit) is not None), None)
        for price in PRICE_FIELDS:
            row[price] = next((r.pricing.get(price) for r in ordered if r.pricing.get(price) is not None), None)
        # Media rate card: upstream sources publish no per-image/per-second
        # prices, so seed the official OpenAI rate card for capable models.
        if row.get("supports_image_generation") or row.get("supports_video_generation"):
            official = official_media_prices(row.get("provider_model_id") or row["model_key"])
            for field, value in official.items():
                if value is not None:
                    row[field] = row.get(field) if row.get(field) is not None else value
        merged[key] = row
    return merged


def _apply_row(model: RepositoryModel, row: dict[str, Any], now: datetime) -> bool:
    """Copy merged values onto a row. Returns True if anything changed."""
    changed = False
    for field, value in row.items():
        if field in ("sources", "raw_source_payload"):
            if getattr(model, field) != value:
                setattr(model, field, value)
                changed = True
            continue
        if getattr(model, field) != value:
            setattr(model, field, value)
            changed = True
    if not model.is_active:
        model.is_active = True
        changed = True
    if model.last_seen_at != now:
        model.last_seen_at = now
        changed = True
    return changed


def _verify_catalog_consistency(
    catalog_payload: dict[str, Any] | None,
    api_payload: dict[str, Any] | None,
    models_payload: dict[str, Any] | None,
) -> str | None:
    """Warn when catalog.json drifts from api.json/models.json. Never raises.

    catalog.json is byte-identical to {providers: api.json, models:
    models.json} upstream; it is fetched only as a consistency check and its
    data is never used. Returns a warning message or None.
    """
    try:
        if not isinstance(catalog_payload, dict):
            return "catalog.json is not a JSON object"
        providers = catalog_payload.get("providers")
        models = catalog_payload.get("models")
        if api_payload is not None and isinstance(providers, dict) and isinstance(api_payload, dict):
            if len(providers) != len(api_payload):
                return (
                    f"catalog.json provider count {len(providers)} != "
                    f"api.json provider count {len(api_payload)}"
                )
        if models_payload is not None and isinstance(models, dict) and isinstance(models_payload, dict):
            if len(models) != len(models_payload):
                return (
                    f"catalog.json model count {len(models)} != "
                    f"models.json model count {len(models_payload)}"
                )
        return None
    except Exception as e:
        return f"catalog.json consistency check failed: {e}"


def _upsert_canonicals(
    db: Session, records: list[NormalizedCanonical], errors: list[str]
) -> dict[str, CanonicalModel]:
    """Upsert canonical rows FIRST from models.json. Never raises per-row.

    Keyed by canonical key = entry id. Missing entries are never deactivated
    (stable identity for live FK links). Returns {canonical_id: row}.
    """
    existing = {
        c.canonical_id: c
        for c in db.scalars(
            select(CanonicalModel).where(CanonicalModel.is_deleted.is_(False))
        )
    }
    stored: dict[str, CanonicalModel] = {}
    for record in records:
        try:
            row = existing.get(record.canonical_id)
            values = {
                "name": record.name,
                "description": record.description,
                "family": record.family,
                "release_date": record.release_date,
                "last_updated": record.last_updated,
                "open_weights": record.open_weights,
                "knowledge": record.knowledge,
                "metadata_": dict(record.metadata_ or {}),
            }
            if row is None:
                row = CanonicalModel(canonical_id=record.canonical_id, **values)
                db.add(row)
                existing[record.canonical_id] = row
            else:
                for field, value in values.items():
                    if getattr(row, field) != value:
                        setattr(row, field, value)
            stored[record.canonical_id] = row
        except Exception:
            logger.exception("model repository: failed to store canonical %s", record.canonical_id)
            errors.append(f"canonical {record.canonical_id}")
    db.flush()
    return stored


def run_sync(
    db: Session,
    *,
    modelsdev_data: dict[str, Any] | None = None,
    modelsdev_models_data: dict[str, Any] | None = None,
    modelsdev_catalog_data: dict[str, Any] | None = None,
) -> SyncRun:
    """Execute one sync. Pass payloads directly in tests to stay offline.

    Fetches api.json + models.json + catalog.json live when the corresponding
    payload is None (production). Under pytest, missing models/catalog
    payloads are skipped silently (no live fetch) so legacy single-payload
    tests stay offline; the api payload still fetches live when None.
    catalog.json is parsed only as a consistency check — its data is never
    used. Fail-closed when all merges are empty. Never raises: per-endpoint
    fetch/normalize failures are recorded on the SyncRun.
    Rows orphaned in 'running' by a crash/restart are marked 'interrupted'
    first, so last_sync never reports a zombie run.
    """
    db.query(SyncRun).filter(SyncRun.status == "running").update(
        {"status": "interrupted", "finished_at": datetime.now(timezone.utc)},
        synchronize_session=False,
    )
    run = SyncRun(status="running")
    db.add(run)
    db.commit()
    db.refresh(run)

    groups: dict[str, list[NormalizedModel]] = {}
    errors: list[str] = []
    fetch_failed = False
    modelsdev = ModelsDevSourceAdapter()
    try:
        modelsdev_payload = modelsdev_data if modelsdev_data is not None else modelsdev.fetch()
        for record in modelsdev.normalize(modelsdev_payload):
            groups.setdefault(canonicalize(record.model_key), []).append(record)
    except Exception as e:
        logger.exception("model repository: modelsdev sync failed")
        errors.append(f"modelsdev: {e}")
        modelsdev_payload = None
        fetch_failed = True

    # models.json: canonical records (no cost). Skipped silently when the
    # caller passed an api payload but no models payload (legacy offline
    # tests) or under pytest without an explicit payload.
    canonical_records: list[NormalizedCanonical] = []
    models_payload: dict[str, Any] | None = None
    if modelsdev_models_data is not None:
        models_payload = modelsdev_models_data
    elif modelsdev_data is None and not os.getenv("PYTEST_CURRENT_TEST"):
        try:
            models_payload = modelsdev.fetch_models()
        except Exception as e:
            logger.exception("model repository: models.json sync failed")
            errors.append(f"models.json: {e}")
            models_payload = None
            fetch_failed = True
    if models_payload is not None:
        try:
            canonical_records = modelsdev.normalize_canonical(models_payload)
        except Exception as e:
            logger.exception("model repository: models.json normalize failed")
            errors.append(f"models.json: {e}")
            canonical_records = []
            fetch_failed = True

    # catalog.json: consistency check only, never used as data. Same
    # skip rule as models.json so offline tests never hit the network.
    catalog_payload: dict[str, Any] | None = None
    if modelsdev_catalog_data is not None:
        catalog_payload = modelsdev_catalog_data
    elif modelsdev_data is None and modelsdev_models_data is None and not os.getenv("PYTEST_CURRENT_TEST"):
        try:
            catalog_payload = modelsdev.fetch_catalog()
        except Exception as e:
            logger.exception("model repository: catalog.json sync failed")
            errors.append(f"catalog.json: {e}")
            catalog_payload = None
    if catalog_payload is not None:
        warning = _verify_catalog_consistency(catalog_payload, modelsdev_payload, models_payload)
        if warning:
            logger.warning("model repository: %s", warning)

    now = datetime.now(timezone.utc)
    created = updated = deactivated = 0
    try:
        # Canonicals FIRST so association FK links resolve in the same run.
        canonical_stored: dict[str, CanonicalModel] = {}
        if canonical_records:
            canonical_stored = _upsert_canonicals(db, canonical_records, errors)
            logger.info("canonical model sync: %s upserted", len(canonical_stored))
        canonical_lookup = {canonicalize(k): k for k in canonical_stored}
        merged = merge_records(groups)
        if canonical_stored:
            # Link canonical_id when the record exists in this run's
            # canonical set, else NULL (never fabricate). Fall back to
            # already-persisted canonical rows so a truncated models.json
            # snapshot churns links to NULL instead of dropping them;
            # genuinely removed canonicals still resolve to NULL.
            db_canonicals: dict[str, str] = {}
            if any(
                isinstance(r.get("canonical_id"), str) and r.get("canonical_id").strip()
                and canonicalize(str(r.get("canonical_id"))) not in canonical_lookup
                for r in merged.values()
            ):
                db_canonicals = {
                    canonicalize(c): c
                    for c in db.scalars(
                        select(CanonicalModel.canonical_id).where(
                            CanonicalModel.is_deleted.is_(False)
                        )
                    )
                }
            for row in merged.values():
                raw = row.get("canonical_id")
                if isinstance(raw, str) and raw.strip():
                    want = canonical_lookup.get(canonicalize(raw.strip()))
                    if want is None:
                        want = db_canonicals.get(canonicalize(raw.strip()))
                    row["canonical_id"] = want
                else:
                    row["canonical_id"] = None
        else:
            # No canonical data this run: preserve existing links.
            for row in merged.values():
                row.pop("canonical_id", None)
        # Match on canonical form so separator variants never churn rows.
        existing = {
            canonicalize(m.model_key): m
            for m in db.scalars(select(RepositoryModel).where(RepositoryModel.is_deleted.is_(False)))
        }
        stored: dict[str, RepositoryModel] = {}
        for key, row in merged.items():
            try:
                model = existing.get(key)
                if model is None:
                    model = RepositoryModel(**row, last_seen_at=now)
                    db.add(model)
                    created += 1
                elif _apply_row(model, row, now):
                    updated += 1
                stored[key] = model
            except Exception as e:
                logger.exception("model repository: failed to store %s", key)
                errors.append(f"{key}: {e}")
        seen = set(merged)
        # Fail closed: an empty merge means the fetch failed or the payload
        # was unexpectedly empty (models.dev never legitimately serves zero
        # models). Likewise any fetch/normalize failure means this snapshot
        # is not authoritative for removals. Change nothing except
        # bookkeeping in those cases: no deactivation, no attribution
        # rewrite, no catalog sync — the last-known-good catalog stays
        # servable. Successful upserts of merged rows still proceed.
        # Extended to cover all-empty (api + models).
        fail_closed = (not merged and not canonical_stored) or fetch_failed
        has_api = bool(merged)
        for key, model in existing.items():
            if key not in seen and model.is_active and has_api and not fail_closed:
                model.is_active = False
                deactivated += 1
        db.flush()  # ids for source rows below
        if has_api and not fail_closed:
            _rewrite_source_rows(db, groups, stored)
        # Provider catalog: link repository rows to their catalog provider,
        # then upsert catalog definitions (credential-free, global scope).
        # Skipped when fail-closed (nothing merged): never zero model_count
        # or deactivate catalog rows on a bad upstream run.
        try:
            if has_api and not fail_closed:
                for key, records in groups.items():
                    model = stored.get(key)
                    if model is None:
                        continue
                    slugs = sorted({r.provider for r in records if r.provider})
                    want = slugs[0] if slugs else None
                    if model.catalog_slug != want:
                        model.catalog_slug = want
                db.flush()
            if modelsdev_payload is not None and has_api and not fail_closed:
                catalog = sync_provider_catalog(
                    db, normalize_modelsdev_providers(modelsdev_payload), groups
                )
                logger.info("provider catalog sync: %s", catalog)
        except Exception as e:
            logger.exception("model repository: provider catalog sync failed")
            errors.append(f"catalog: {e}")
        run.status = "done"
    except Exception as e:
        logger.exception("model repository: sync store phase failed")
        errors.append(f"store: {e}")
        run.status = "error"
    run.models_created = created
    run.models_updated = updated
    run.models_deactivated = deactivated
    run.errors_count = len(errors)
    run.error_details = errors[:_ERROR_DETAILS_CAP]
    run.finished_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(run)
    # Repository rows changed (or were re-seen): cached matches/searches rebuild lazily.
    cache_invalidate_sync(cache_keys.section_pattern("repository"))
    logger.info(
        "model repository sync %s: +%s ~%s -%s errors=%s", run.id, created, updated, deactivated, len(errors)
    )
    return run


SOURCE_URLS = {"modelsdev": MODELS_DEV_URL}

# npm package -> ToLLma gateway family, for providers whose SDK speaks a wire
# protocol one of OUR adapters implements verbatim. Anything else stays
# catalog-only and can never be configured as a gateway connection.
NPM_GATEWAY_FAMILIES: dict[str, str] = {
    "@ai-sdk/anthropic": ProviderType.ANTHROPIC_MESSAGES.value,
    "@ai-sdk/openai-compatible": ProviderType.CUSTOM.value,
}
# models.dev provider slug -> ToLLma gateway family (explicit, wins over npm).
# This maps OUR adapter implementations, not their catalog.
GATEWAY_FAMILIES: dict[str, str] = {
    "openai": ProviderType.OPENAI.value,
    "anthropic": ProviderType.ANTHROPIC_MESSAGES.value,
    "google": ProviderType.GEMINI.value,
    "google-vertex": ProviderType.VERTEX_AI.value,
    "amazon-bedrock": ProviderType.BEDROCK_CONVERSE.value,
}

def sync_provider_catalog(
    db: Session, providers: list[dict[str, Any]], groups: dict[str, list[NormalizedModel]]
) -> dict[str, int]:
    """Upsert models.dev provider catalog rows. Idempotent; never deletes:
    providers absent from the source are marked inactive. Never touches user
    Provider connections, credentials, or ToLLma operational metadata."""
    seen: set[str] = set()
    created = updated = 0
    for entry in providers:
        slug = str(entry.get("slug") or "").strip()
        if not slug:
            continue
        seen.add(slug)
        family = GATEWAY_FAMILIES.get(slug) or NPM_GATEWAY_FAMILIES.get(
            str(entry.get("npm_package") or "")
        )
        row = db.execute(
            select(ProviderCatalog).where(
                ProviderCatalog.source == "modelsdev",
                ProviderCatalog.source_id == slug,
                ProviderCatalog.is_deleted.is_(False),
            )
        ).scalars().first()
        # Aggregate capability signals from this provider's normalized models.
        chat = streaming = False
        for records in groups.values():
            for record in records:
                if record.provider == slug:
                    chat = chat or bool(record.caps.get("supports_chat"))
                    streaming = streaming or bool(record.caps.get("supports_streaming"))
        values = {
            "name": str(entry.get("name") or slug)[:120],
            "display_name": str(entry.get("name") or slug)[:120],
            "logo_url": MODELSDEV_LOGO_URL.format(slug=slug),
            "doc_url": entry.get("doc_url"),
            "api_base_url": entry.get("api_base_url"),
            "npm_package": entry.get("npm_package"),
            "env_vars": entry.get("env_vars") or [],
            "gateway_family": family,
            "gateway_supported": family is not None,
            "capabilities": {
                "catalog_available": True,
                "gateway_supported": family is not None,
                "credentials_supported": family is not None,
                "model_discovery_supported": family is not None,
                "chat_supported": chat,
                "streaming_supported": streaming,
            },
            "is_active": True,
        }
        if row is None:
            db.add(ProviderCatalog(slug=slug, source="modelsdev", source_id=slug, **values))
            created += 1
        else:
            changed = False
            for field, value in values.items():
                if getattr(row, field) != value:
                    setattr(row, field, value)
                    changed = True
            updated += int(changed)
    deactivated = 0
    for row in db.execute(
        select(ProviderCatalog).where(
            ProviderCatalog.source == "modelsdev",
            ProviderCatalog.is_deleted.is_(False),
            ProviderCatalog.is_active.is_(True),
        )
    ).scalars().all():
        if row.slug not in seen:
            row.is_active = False
            deactivated += 1
    # Refresh per-provider model counts from the just-merged repository rows.
    # Explicit flush: this session runs with autoflush=False, so the counts
    # query below would otherwise miss the catalog_slug linkages above.
    db.flush()
    counts: dict[str, int] = {}
    for model in db.execute(
        select(RepositoryModel).where(
            RepositoryModel.is_deleted.is_(False), RepositoryModel.catalog_slug.is_not(None)
        )
    ).scalars().all():
        counts[model.catalog_slug or ""] = counts.get(model.catalog_slug or "", 0) + 1
    for row in db.execute(select(ProviderCatalog).where(ProviderCatalog.is_deleted.is_(False))).scalars().all():
        want = counts.get(row.slug, 0)
        if row.model_count != want:
            row.model_count = want
    return {"created": created, "updated": updated, "deactivated": deactivated}


def _rewrite_source_rows(
    db: Session, groups: dict[str, list[NormalizedModel]], stored: dict[str, RepositoryModel]
) -> None:
    """Rebuild per-source attribution rows. The table is sync-owned: full rewrite."""
    db.execute(delete(RepositorySource))
    rows = 0
    for key, records in groups.items():
        model = stored.get(key)
        if model is None:
            continue
        for record in records:
            db.add(
                RepositorySource(
                    source_name=record.source,
                    source_url=SOURCE_URLS.get(record.source),
                    source_model_id=record.canonical_name,
                    model_repository_id=model.id,
                    source_payload=record.raw,
                )
            )
            rows += 1
        logger.info("model repository: rewrote %s source rows", rows)

