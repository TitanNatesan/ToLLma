"""ModelRepositorySyncService: fetch, normalize, merge, store, deactivate, report."""

import logging
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from tollms.core.exceptions import NotFoundError, ValidationError
from tollms.modules.model_repository.canonical import canonicalize
from tollms.modules.model_repository.models import RepositoryModel, RepositorySource, SyncRun
from tollms.modules.model_repository.sources import (
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

# Gateway provider_type -> repository provider names (best effort; CUSTOM has no hint).
PROVIDER_HINTS = {
    "OPENAI_CHAT": ("openai",),
    "OPENAI_RESPONSES": ("openai",),
    "ANTHROPIC_MESSAGES": ("anthropic",),
    "GEMINI": ("gemini", "google"),
    "VERTEX_AI": ("vertex_ai", "google"),
    "BEDROCK_CONVERSE": ("bedrock", "bedrock_converse"),
}


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


def find_for_model(
    db: Session, provider_type: str | None, model_id: str
) -> RepositoryModel | None:
    """Best-effort repository match for a provider model. Never raises."""
    try:
        hints = PROVIDER_HINTS.get((provider_type or "").upper(), ())
        wanted = canonicalize(model_id).split("/")[-1]
        candidates = [f"{h}/{wanted}" for h in hints] + [wanted]
        for key in candidates:
            match = db.scalar(
                select(RepositoryModel).where(
                    RepositoryModel.model_key == key,
                    RepositoryModel.is_deleted.is_(False),
                )
            )
            if match is not None:
                return match
        # Fallback: any active entry whose provider model id canonicalizes the same.
        for entry in db.scalars(
            select(RepositoryModel).where(
                RepositoryModel.is_active.is_(True), RepositoryModel.is_deleted.is_(False)
            )
        ):
            if canonicalize(entry.provider_model_id).split("/")[-1] == wanted:
                return entry
        return None
    except Exception:
        logger.exception("model repository: find_for_model failed")
        return None


def lookup(db: Session, query: str, provider_hint: str | None = None) -> RepositoryModel | None:
    """Best match for a user-typed model id (auto-populate). Prefers priced entries."""
    text = query.strip()
    if not text:
        return None
    hint = (provider_hint or "").strip().lower()
    keys = [f"{hint}/{text}"] if hint else []
    keys.append(text)
    tried = set()
    for raw in keys:
        key = canonicalize(raw)
        if key in tried:
            continue
        tried.add(key)
        match = db.scalar(
            select(RepositoryModel).where(
                RepositoryModel.model_key == key, RepositoryModel.is_deleted.is_(False)
            )
        )
        if match is not None:
            return match
    like = f"%{text}%"
    rows = list(
        db.scalars(
            select(RepositoryModel)
            .where(
                RepositoryModel.is_deleted.is_(False),
                RepositoryModel.canonical_name.ilike(like)
                | RepositoryModel.display_name.ilike(like)
                | RepositoryModel.provider_model_id.ilike(like),
            )
            .order_by(
                (RepositoryModel.provider_model_id == text).desc(),
                RepositoryModel.input_cost.is_(None),
                func.length(RepositoryModel.canonical_name),
            )
            .limit(5)
        )
    )
    return rows[0] if rows else None


def suggest_payload(entry: RepositoryModel) -> dict[str, Any]:
    """Map a repository entry to AIModel create fields. Prices converted per-token -> per-1M."""
    from decimal import Decimal as _Decimal

    def per_1m(value: Any) -> str:
        if value is None:
            return "0"
        return str(_Decimal(value) * 1_000_000)

    endpoint = entry.endpoint_type if entry.endpoint_type in ("responses", "chat_completions", "messages", "converse") else "chat_completions"
    return {
        "model_id": entry.provider_model_id,
        "name": entry.display_name or entry.provider_model_id,
        "description": entry.description,
        "endpoint_type": endpoint,
        "repository_model_key": entry.model_key,
        "input_price": per_1m(entry.input_cost),
        "output_price": per_1m(entry.output_cost),
        "cache_read_price": per_1m(entry.cache_read_cost),
        "cache_write_price": per_1m(entry.cache_write_cost),
        "supports_text": entry.supports_text_input and entry.supports_text_output,
        "supports_vision": entry.supports_vision_input,
        "supports_audio_input": entry.supports_audio_input,
        "supports_audio_output": entry.supports_audio_output,
        "supports_image_generation": entry.supports_image_output,
        "supports_tool_calling": entry.supports_tool_calling,
        "supports_reasoning": entry.supports_reasoning,
        "supports_streaming": entry.supports_streaming,
        "context_window": entry.context_window,
        "max_output_tokens": entry.max_output_tokens,
        "release_date": entry.release_date,
    }


def get_entry(db: Session, entry_id: object) -> RepositoryModel:
    model = db.get(RepositoryModel, entry_id)
    if model is None or model.is_deleted:
        raise NotFoundError(f"repository model {entry_id} not found")
    return model


def list_entries(
    db: Session,
    *,
    search: str | None = None,
    provider: str | None = None,
    capability: str | None = None,
    active_only: bool = True,
    page: int = 1,
    page_size: int = 50,
) -> tuple[list[RepositoryModel], int]:
    if capability and capability not in CAPABILITY_FIELDS:
        raise ValidationError(f"unknown capability filter: {capability}")
    stmt = select(RepositoryModel).where(RepositoryModel.is_deleted.is_(False))
    if provider:
        stmt = stmt.where(RepositoryModel.provider == provider.strip().lower())
    if search:
        like = f"%{search}%"
        stmt = stmt.where(
            RepositoryModel.canonical_name.ilike(like)
            | RepositoryModel.display_name.ilike(like)
            | RepositoryModel.provider_model_id.ilike(like)
        )
    if capability:
        stmt = stmt.where(getattr(RepositoryModel, capability).is_(True))
    if active_only:
        stmt = stmt.where(RepositoryModel.is_active.is_(True))
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    page = max(page, 1)
    page_size = min(max(page_size, 1), 200)
    rows = list(db.scalars(stmt.order_by(RepositoryModel.canonical_name).offset((page - 1) * page_size).limit(page_size)))
    return rows, total


def stats(db: Session) -> dict[str, Any]:
    base = select(RepositoryModel).where(RepositoryModel.is_deleted.is_(False))
    total = db.scalar(select(func.count()).select_from(base.subquery())) or 0
    active = db.scalar(select(func.count()).select_from(base.where(RepositoryModel.is_active.is_(True)).subquery())) or 0
    deprecated = db.scalar(
        select(func.count()).select_from(base.where(RepositoryModel.is_deprecated.is_(True)).subquery())
    ) or 0
    providers = db.scalar(select(func.count(func.distinct(RepositoryModel.provider))).where(RepositoryModel.is_deleted.is_(False))) or 0
    by_provider = {
        row[0]: row[1]
        for row in db.execute(
            select(RepositoryModel.provider, func.count())
            .where(RepositoryModel.is_deleted.is_(False), RepositoryModel.is_active.is_(True))
            .group_by(RepositoryModel.provider)
            .order_by(func.count().desc())
            .limit(50)
        )
    }
    last_run = db.scalars(select(SyncRun).order_by(SyncRun.created_at.desc()).limit(1)).first()
    return {
        "total_models": total,
        "active_models": active,
        "deprecated_models": deprecated,
        "providers_count": providers,
        "by_provider": by_provider,
        "last_sync": None
        if last_run is None
        else {
            "id": last_run.id,
            "status": last_run.status,
            "started_at": last_run.started_at,
            "finished_at": last_run.finished_at,
            "models_created": last_run.models_created,
            "models_updated": last_run.models_updated,
            "models_deactivated": last_run.models_deactivated,
            "errors_count": last_run.errors_count,
        },
    }


def sync_history(db: Session, limit: int = 20) -> list[SyncRun]:
    return list(db.scalars(select(SyncRun).order_by(SyncRun.created_at.desc()).limit(min(max(limit, 1), 100))))
