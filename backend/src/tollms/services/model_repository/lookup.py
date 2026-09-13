"""Repository match/lookup engine: find, lookup, suggest, stats.

Reusable backend engine (services layer): pure queries over the repository
tables, consumed by the gateway cost engine, model registration, the mapping
engine, and the repository API feature service. Never raises on lookup paths.
"""

import logging
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from tollms.models.model_repository import RepositoryModel, SyncRun
from tollms.services.model_repository.canonical import canonicalize

logger = logging.getLogger(__name__)

# Gateway provider_type -> repository provider names (best effort; CUSTOM has no hint).
PROVIDER_HINTS = {
    "OPENAI_CHAT": ("openai",),
    "OPENAI_RESPONSES": ("openai",),
    "ANTHROPIC_MESSAGES": ("anthropic",),
    "GEMINI": ("gemini", "google"),
    "VERTEX_AI": ("vertex_ai", "google"),
    "BEDROCK_CONVERSE": ("bedrock", "bedrock_converse"),
}


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
