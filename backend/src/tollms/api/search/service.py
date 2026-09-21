"""Conversation search: cached, ranked PostgreSQL full-text search."""

import hashlib
import logging
import uuid
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from tollms.api.search.schemas import SearchResponse, SearchResult, SearchStatusRead
from tollms.models.search_index import ConversationSearchEntry
from tollms.services import search as search_engine
from tollms.services.cache import constants as cache_constants
from tollms.services.cache import keys as cache_keys
from tollms.services.cache.manager import cache_get_sync, cache_set_sync

logger = logging.getLogger(__name__)


def _digest(
    query: str,
    provider_id: uuid.UUID | None,
    model_id: uuid.UUID | None,
    start: datetime | None,
    end: datetime | None,
    limit: int,
    offset: int,
) -> str:
    raw = "|".join(
        [query, str(provider_id), str(model_id), str(start), str(end), str(limit), str(offset)]
    )
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:32]


def search_conversations(
    db: Session,
    user_id: uuid.UUID | None,
    query: str,
    *,
    provider_id: uuid.UUID | None = None,
    model_id: uuid.UUID | None = None,
    start: datetime | None = None,
    end: datetime | None = None,
    limit: int = 20,
    offset: int = 0,
) -> SearchResponse:
    """Ranked search with a short Valkey cache (rebuildable from PostgreSQL)."""
    key = cache_keys.search_results(user_id, _digest(query, provider_id, model_id, start, end, limit, offset))
    cached = cache_get_sync(key)
    if cached:
        return SearchResponse.model_validate(cached)

    payload = search_engine.search(
        db,
        user_id,
        query,
        provider_id=provider_id,
        model_id=model_id,
        start=start,
        end=end,
        limit=limit,
        offset=offset,
    )
    response = SearchResponse(
        query=payload["query"],
        total=payload["total"],
        results=[SearchResult.model_validate(row) for row in payload["results"]],
    )
    cache_set_sync(key, response.model_dump(mode="json"), ttl=cache_constants.SEARCH)
    return response


def index_status(db: Session, user_id: uuid.UUID | None) -> SearchStatusRead:
    owner = (
        ConversationSearchEntry.user_id == user_id
        if user_id is not None
        else ConversationSearchEntry.user_id.is_(None)
    )
    documents, conversations, messages = db.execute(
        select(
            func.count(ConversationSearchEntry.id),
            func.count(ConversationSearchEntry.id).filter(ConversationSearchEntry.kind == "conversation"),
            func.count(ConversationSearchEntry.id).filter(ConversationSearchEntry.kind == "message"),
        ).where(owner)
    ).one()
    return SearchStatusRead(
        indexed_documents=int(documents or 0),
        indexed_conversations=int(conversations or 0),
        indexed_messages=int(messages or 0),
    )
