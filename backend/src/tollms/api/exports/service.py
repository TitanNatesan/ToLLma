"""Export service: assemble conversations/analytics and render files."""

import logging
import uuid

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from tollms.api.conversations.service import list_messages
from tollms.api.exports.schemas import ExportEventRead
from tollms.core.exceptions import NotFoundError, ValidationError
from tollms.models.conversation import Conversation
from tollms.models.provider import Provider
from tollms.models.registered_model import AIModel
from tollms.models.request_log import ExportEvent
from tollms.services import exporters
from tollms.services import request_logs as request_log_engine

logger = logging.getLogger(__name__)

MAX_EXPORT_CONVERSATIONS = 200


def _names(db: Session, conversations: list[Conversation]) -> dict[uuid.UUID, tuple[str | None, str | None]]:
    """provider/model display names keyed by conversation id (2 queries max)."""
    provider_ids = {c.provider_id for c in conversations if c.provider_id}
    model_ids = {c.model_id for c in conversations if c.model_id}
    providers = dict(
        db.execute(select(Provider.id, Provider.name).where(Provider.id.in_(provider_ids or [None]))).all()
    )
    models = dict(
        db.execute(select(AIModel.id, AIModel.name).where(AIModel.id.in_(model_ids or [None]))).all()
    )
    return {
        c.id: (providers.get(c.provider_id), models.get(c.model_id)) for c in conversations
    }


def load_conversations(
    db: Session, user_id: uuid.UUID | None, conversation_ids: list[uuid.UUID], export_all: bool
) -> tuple[list[Conversation], int, bool]:
    """Load the export scope. Returns (rows, total_count, truncated).

    Scope rule: explicit conversation_ids always win, even when export_all
    is also true (never silently ignored); export_all alone dumps the whole
    account. Rows are capped at MAX_EXPORT_CONVERSATIONS; truncated is true
    when total_count exceeds the returned rows.
    """
    base = select(Conversation).where(Conversation.is_deleted.is_(False))
    base = base.where(Conversation.user_id == user_id if user_id is not None else Conversation.user_id.is_(None))
    use_ids = bool(conversation_ids)
    if use_ids:
        base = base.where(Conversation.id.in_(conversation_ids))
    total_count = int(db.execute(select(func.count()).select_from(base.subquery())).scalar_one() or 0)
    conversations = list(db.execute(base.order_by(Conversation.created_at.asc()).limit(MAX_EXPORT_CONVERSATIONS)).scalars())
    if not conversations:
        raise NotFoundError("no conversations found to export")
    if use_ids and len(conversations) != len(set(conversation_ids)):
        raise NotFoundError("some conversations were not found")
    return conversations, total_count, total_count > len(conversations)


def render_conversations(
    db: Session,
    user_id: uuid.UUID | None,
    conversation_ids: list[uuid.UUID],
    export_all: bool,
    export_format: str,
) -> tuple[bytes, str, str, int, int, bool]:
    """Returns (content, media_type, filename, item_count, total_count, truncated)."""
    if export_format not in ("md", "json", "pdf"):
        raise ValidationError(f"unsupported export format: {export_format}")

    conversations, total_count, truncated = load_conversations(db, user_id, conversation_ids, export_all)
    names = _names(db, conversations)
    bundles = [
        (conversation, list_messages(db, conversation.id, user_id), *names[conversation.id])
        for conversation in conversations
    ]

    stamp = int(__import__("time").time())
    if export_format == "md":
        parts = [
            exporters.conversation_markdown(conversation, messages, provider_name=provider, model_name=model)
            for conversation, messages, provider, model in bundles
        ]
        content = ("\n\n---\n\n".join(parts)).encode("utf-8")
        filename = f"tollma-conversations-{stamp}.md"
        media = "text/markdown; charset=utf-8"
    elif export_format == "json":
        payload = {
            "exported_at": __import__("datetime").datetime.now(
                __import__("datetime").timezone.utc
            ).isoformat(),
            "conversations": [
                exporters.conversation_payload(conversation, messages, provider_name=provider, model_name=model)
                for conversation, messages, provider, model in bundles
            ],
        }
        content = exporters.dump_json(payload)
        filename = f"tollma-conversations-{stamp}.json"
        media = "application/json"
    else:
        content = exporters.conversation_pdf(bundles)
        filename = f"tollma-conversations-{stamp}.pdf"
        media = "application/pdf"

    request_log_engine.record_export(
        db,
        user_id,
        "conversations_all" if export_all else "conversations_selected",
        export_format,
        len(conversations),
        detail=f"{sum(len(b[1]) for b in bundles)} messages",
    )
    db.commit()
    return content, media, filename, len(conversations), total_count, truncated


def export_history(db: Session, user_id: uuid.UUID | None, limit: int = 20) -> list[ExportEventRead]:
    stmt = select(ExportEvent).order_by(ExportEvent.created_at.desc()).limit(limit)
    stmt = stmt.where(ExportEvent.user_id == user_id if user_id is not None else ExportEvent.user_id.is_(None))
    return [
        ExportEventRead(
            id=row.id,
            dataset=row.dataset,
            format=row.format,
            item_count=row.item_count,
            detail=row.detail,
            created_at=row.created_at,
        )
        for row in db.execute(stmt).scalars()
    ]
