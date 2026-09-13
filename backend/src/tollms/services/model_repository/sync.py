"""Model repository sync engine: fetch, normalize, merge, store, deactivate, report.

Reusable backend engine (services layer). Query/match helpers live in
lookup.py; the feature-level API service lives in api/repository/service.py.
"""

import logging
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from tollms.models.model_repository import RepositoryModel, RepositorySource, SyncRun
from tollms.services.model_repository.canonical import canonicalize
from tollms.services.model_repository.sources import (
    LITELLM_URL,
    OPENROUTER_URL,
    LiteLLMSourceAdapter,
    NormalizedModel,
    OpenRouterSourceAdapter,
)

logger = logging.getLogger(__name__)

CAPABILITY_FIELDS = (
    "supports_text_input",
    "supports_text_output",
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
)

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
    """Merge per-source records into one dict per canonical key.

    Source priority: LiteLLM first, then OpenRouter. Scalars take the first
    non-null value; capabilities OR-merge; raw payloads are kept per source.
    """
    merged: dict[str, dict[str, Any]] = {}
    for key, records in groups.items():
        ordered = sorted(records, key=lambda r: 0 if r.source == "litellm" else 1)
        first = ordered[0]
        row: dict[str, Any] = {
            "model_key": key,
            "canonical_name": first.canonical_name,
            "provider": first.provider,
            "provider_model_id": first.provider_model_id,
            "sources": [r.source for r in ordered],
            "raw_source_payload": {r.source: r.raw for r in ordered},
        }
        for attr in ("display_name", "family", "vendor", "endpoint_type", "description", "documentation_url", "release_date"):
            row[attr] = next((getattr(r, attr) for r in ordered if getattr(r, attr) is not None), None)
        for cap in CAPABILITY_FIELDS:
            row[cap] = any(r.caps.get(cap, False) for r in ordered)
        for limit in LIMIT_FIELDS:
            row[limit] = next((getattr(r, limit) for r in ordered if getattr(r, limit) is not None), None)
        for price in PRICE_FIELDS:
            row[price] = next((r.pricing.get(price) for r in ordered if r.pricing.get(price) is not None), None)
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


def run_sync(
    db: Session,
    *,
    litellm_data: dict[str, Any] | None = None,
    openrouter_data: dict[str, Any] | None = None,
) -> SyncRun:
    """Execute one sync. Pass payloads directly in tests to stay offline.

    When a payload is None the corresponding source is fetched live.
    Never raises: fetch/normalize failures are recorded on the SyncRun.
    """
    run = SyncRun(status="running")
    db.add(run)
    db.commit()
    db.refresh(run)

    groups: dict[str, list[NormalizedModel]] = {}
    errors: list[str] = []
    litellm = LiteLLMSourceAdapter()
    openrouter = OpenRouterSourceAdapter()
    try:
        payload = litellm_data if litellm_data is not None else litellm.fetch()
        for record in litellm.normalize(payload):
            groups.setdefault(canonicalize(record.model_key), []).append(record)
    except Exception as e:
        logger.exception("model repository: litellm sync failed")
        errors.append(f"litellm: {e}")
    try:
        payload = openrouter_data if openrouter_data is not None else openrouter.fetch()
        for record in openrouter.normalize(payload):
            groups.setdefault(canonicalize(record.model_key), []).append(record)
    except Exception as e:
        logger.exception("model repository: openrouter sync failed")
        errors.append(f"openrouter: {e}")

    now = datetime.now(timezone.utc)
    created = updated = deactivated = 0
    try:
        merged = merge_records(groups)
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
        for key, model in existing.items():
            if key not in seen and model.is_active:
                model.is_active = False
                deactivated += 1
        db.flush()  # ids for source rows below
        _rewrite_source_rows(db, groups, stored)
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
    logger.info(
        "model repository sync %s: +%s ~%s -%s errors=%s", run.id, created, updated, deactivated, len(errors)
    )
    return run


SOURCE_URLS = {"litellm": LITELLM_URL, "openrouter": OPENROUTER_URL}


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

