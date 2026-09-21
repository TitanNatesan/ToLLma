"""PostgreSQL full-text search engine (conversation title + message content).

`conversation_search_index` holds one denormalized document per conversation
title and per message, with a generated tsvector. Queries use
`websearch_to_tsquery` + `ts_rank_cd` + `ts_headline` — never LIKE.
"""

import logging
import uuid
from datetime import datetime

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from tollms.models.conversation import Conversation
from tollms.models.message import Message
from tollms.models.search_index import ConversationSearchEntry
from tollms.services.cache import keys as cache_keys
from tollms.services.cache.manager import cache_invalidate_sync

logger = logging.getLogger(__name__)

MAX_SNIPPET_CHARS = 400


def _invalidate(user_id: uuid.UUID | None) -> None:
    """Search results are cached; any index write must drop the owner's cache."""
    try:
        cache_invalidate_sync(cache_keys.search_pattern(user_id))
    except Exception:
        logger.warning("search cache invalidation failed", exc_info=True)


def index_conversation(db: Session, conversation: Conversation, provider_name: str | None = None,
                       model_name: str | None = None) -> None:
    """Upsert the title document for a conversation."""
    row = db.execute(
        select(ConversationSearchEntry).where(
            ConversationSearchEntry.conversation_id == conversation.id,
            ConversationSearchEntry.kind == "conversation",
        )
    ).scalar_one_or_none()
    if row is None:
        row = ConversationSearchEntry(
            conversation_id=conversation.id,
            user_id=conversation.user_id,
            kind="conversation",
        )
        db.add(row)
    row.title = conversation.title
    row.provider_id = conversation.provider_id
    row.model_id = conversation.model_id
    if provider_name is not None:
        row.provider_name = provider_name
    if model_name is not None:
        row.model_name = model_name
    _invalidate(conversation.user_id)


def index_message(
    db: Session,
    message: Message,
    *,
    conversation_title: str | None = None,
    provider_name: str | None = None,
    model_name: str | None = None,
) -> None:
    """Upsert the message document. Empty content is removed from the index."""
    row = db.execute(
        select(ConversationSearchEntry).where(ConversationSearchEntry.message_id == message.id)
    ).scalar_one_or_none()
    content = message.content or ""
    if not content.strip():
        if row is not None:
            db.delete(row)
        return
    if row is None:
        row = ConversationSearchEntry(
            conversation_id=message.conversation_id,
            message_id=message.id,
            user_id=message.user_id,
            kind="message",
        )
        db.add(row)
    row.title = conversation_title or ""
    row.content = content
    row.provider_id = message.provider_id
    row.model_id = message.model_id
    row.provider_name = provider_name
    row.model_name = model_name
    row.role = message.role.value if hasattr(message.role, "value") else str(message.role)
    _invalidate(message.user_id)


def remove_conversation(db: Session, conversation_id: uuid.UUID) -> None:
    owners = db.execute(
        select(ConversationSearchEntry.user_id)
        .where(ConversationSearchEntry.conversation_id == conversation_id)
        .limit(1)
    ).scalar_one_or_none()
    db.execute(delete(ConversationSearchEntry).where(ConversationSearchEntry.conversation_id == conversation_id))
    _invalidate(owners)


def search(
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
) -> dict:
    """Ranked full-text search scoped to one owner."""
    cleaned = (query or "").strip()
    if not cleaned:
        return {"query": cleaned, "total": 0, "results": []}

    tsquery = func.websearch_to_tsquery("english", cleaned)
    rank = func.ts_rank_cd(ConversationSearchEntry.tsv, tsquery).label("rank")
    headline_source = func.coalesce(
        func.nullif(ConversationSearchEntry.content, ""), ConversationSearchEntry.title
    )
    snippet = func.ts_headline(
        "english",
        headline_source,
        tsquery,
        "StartSel=<mark>, StopSel=</mark>, MaxWords=42, MinWords=12, ShortWord=2",
    ).label("snippet")

    filters = [ConversationSearchEntry.tsv.op("@@")(tsquery)]
    filters.append(
        ConversationSearchEntry.user_id == user_id
        if user_id is not None
        else ConversationSearchEntry.user_id.is_(None)
    )
    if provider_id is not None:
        filters.append(ConversationSearchEntry.provider_id == provider_id)
    if model_id is not None:
        filters.append(ConversationSearchEntry.model_id == model_id)
    if start is not None:
        filters.append(ConversationSearchEntry.created_at >= start)
    if end is not None:
        filters.append(ConversationSearchEntry.created_at < end)

    total = db.execute(
        select(func.count()).select_from(ConversationSearchEntry).where(*filters)
    ).scalar_one()

    rows = db.execute(
        select(ConversationSearchEntry, rank, snippet)
        .where(*filters)
        .order_by(rank.desc(), ConversationSearchEntry.created_at.desc())
        .limit(limit)
        .offset(offset)
    ).all()

    titles = dict(
        db.execute(
            select(ConversationSearchEntry.conversation_id, ConversationSearchEntry.title).where(
                ConversationSearchEntry.kind == "conversation",
                ConversationSearchEntry.conversation_id.in_([row[0].conversation_id for row in rows] or [None]),
            )
        ).all()
    )

    return {
        "query": cleaned,
        "total": int(total or 0),
        "results": [
            {
                "conversation_id": entry.conversation_id,
                "conversation_title": titles.get(entry.conversation_id) or entry.title or "Conversation",
                "message_id": entry.message_id,
                "role": entry.role,
                "kind": entry.kind,
                "snippet": (snippet_text or "")[:MAX_SNIPPET_CHARS],
                "provider_id": entry.provider_id,
                "provider_name": entry.provider_name,
                "model_id": entry.model_id,
                "model_name": entry.model_name,
                "created_at": entry.created_at,
                "rank": float(score or 0),
            }
            for entry, score, snippet_text in rows
        ],
    }
