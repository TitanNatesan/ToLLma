"""Conversation search: cached, ranked PostgreSQL full-text search."""

import hashlib
import logging
import uuid
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from tollms.api.search.groups import parse_types, search_groups
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
    org_id: uuid.UUID | None = None,
    types: str | None = None,
) -> str:
    raw = "|".join(
        [query, str(provider_id), str(model_id), str(start), str(end),
         str(limit), str(offset), str(org_id), str(types)]
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
    org_id: uuid.UUID | None = None,
    types: str | None = None,
) -> SearchResponse:
    """Ranked search with a short Valkey cache (rebuildable from PostgreSQL).

    Default shape is unchanged (conversation FTS only). ?types= adds grouped
    cross-type hits (members, teams, providers, guardrails, keys, sets,
    prompt_logs, audit), each capped at `limit`, 100 items global max.

    Offset paging is capped at 5000 (deep offsets cause excessive DB work);
    keyset-cursor paths elsewhere are unchanged.
    """
    offset = min(max(offset or 0, 0), 5000)
    key = cache_keys.search_results(
        user_id, _digest(query, provider_id, model_id, start, end, limit,
                         offset, org_id, types))
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
    wanted = parse_types(types)
    groups: dict = {}
    if wanted and user_id is not None:
        per_type = min(max(int(limit or 20), 1), 100)
        groups = search_groups(db, user_id, query, org_id=org_id,
                               types=wanted, per_type=per_type)
        # Global max 100 across groups (per-type cap already applied).
        total = sum(len(v) for v in groups.values())
        if total > 100:
            budget = 100
            for name in list(groups):
                keep = min(len(groups[name]), budget)
                groups[name] = groups[name][:keep]
                budget -= keep
                if budget <= 0:
                    break
    response = SearchResponse(
        query=payload["query"],
        total=payload["total"],
        results=[SearchResult.model_validate(row) for row in payload["results"]],
        groups=groups,
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
