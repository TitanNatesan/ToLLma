"""Attachment CRUD + ownership. Rows gate every byte served or forwarded."""

import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from tollms.core.exceptions import NotFoundError, ValidationError
from tollms.models.attachment import Attachment
from tollms.services.gateway import attachments as engine

logger = logging.getLogger(__name__)


def _scope(conversation_id: uuid.UUID | None) -> str:
    return str(conversation_id) if conversation_id else "unassigned"


def upload_attachment(
    db: Session,
    *,
    user_id: uuid.UUID | None,
    filename: str,
    content_type: str | None,
    data: bytes,
    conversation_id: uuid.UUID | None = None,
) -> Attachment:
    """Validate, store, extract (documents) and persist one upload."""
    name = (filename or "upload").strip() or "upload"
    kind = engine.detect_kind(name)
    if len(data) == 0:
        raise ValidationError("attachment is empty")
    if len(data) > engine.max_bytes():
        raise ValidationError(f"attachment exceeds {len(data) // (1024 * 1024)} MB limit")
    if not engine.sniff_ok(name, data[:16]):
        raise ValidationError(f"{name} content does not match its extension")
    extracted: str | None = None
    if kind == "document":
        extracted = engine.extract_text(data, name)
    relpath = engine.save_bytes(user_id, _scope(conversation_id), name, data)
    row = Attachment(
        user_id=user_id,
        conversation_id=conversation_id,
        filename=engine.safe_name(name),
        mime_type=(content_type or "application/octet-stream").split(";")[0].strip() or "application/octet-stream",
        kind=kind,
        file_size=len(data),
        storage_path=relpath,
        extracted_text=extracted,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    logger.info("attachment uploaded: %s (%s, %d bytes)", row.id, kind, len(data))
    return row


def get_attachment(db: Session, attachment_id: uuid.UUID, user_id: uuid.UUID | None = None) -> Attachment:
    row = db.get(Attachment, attachment_id)
    if row is None or row.is_deleted:
        raise NotFoundError(f"attachment {attachment_id} not found")
    if user_id is not None and row.user_id != user_id:
        raise NotFoundError(f"attachment {attachment_id} not found")
    return row


def get_many(db: Session, ids: list[uuid.UUID], user_id: uuid.UUID | None = None) -> list[Attachment]:
    """Resolve + ownership-check a batch, preserving request order."""
    if not ids:
        return []
    rows = db.scalars(select(Attachment).where(Attachment.id.in_(ids))).all()
    by_id = {r.id: r for r in rows if not r.is_deleted}
    out = []
    for i in ids:
        row = by_id.get(i)
        if row is None:
            raise NotFoundError(f"attachment {i} not found")
        if user_id is not None and row.user_id != user_id:
            raise NotFoundError(f"attachment {i} not found")
        out.append(row)
    return out


def read_content(db: Session, attachment_id: uuid.UUID, user_id: uuid.UUID | None = None) -> tuple[Attachment, bytes]:
    row = get_attachment(db, attachment_id, user_id)
    return row, engine.read_bytes(row.storage_path)


def attachments_for_messages(
    db: Session, message_ids: list[uuid.UUID], user_id: uuid.UUID | None = None
) -> dict[uuid.UUID, list[Attachment]]:
    """Live attachments grouped by message. One query; used for history + reads."""
    if not message_ids:
        return {}
    stmt = (
        select(Attachment)
        .where(Attachment.message_id.in_(message_ids), Attachment.is_deleted.is_(False))
        .order_by(Attachment.created_at)
    )
    if user_id is not None:
        stmt = stmt.where(Attachment.user_id == user_id)
    grouped: dict[uuid.UUID, list[Attachment]] = {}
    for row in db.scalars(stmt):
        if row.message_id is not None:
            grouped.setdefault(row.message_id, []).append(row)
    return grouped


def link_to_message(
    db: Session, row: Attachment, conversation_id: uuid.UUID, message_id: uuid.UUID, *, commit: bool = True
) -> None:
    row.conversation_id = conversation_id
    row.message_id = message_id
    if commit:
        db.commit()
        db.refresh(row)


def delete_attachment(db: Session, attachment_id: uuid.UUID, user_id: uuid.UUID | None = None) -> None:
    """Delete staged (unsent) uploads only; sent attachments are conversation history."""
    row = get_attachment(db, attachment_id, user_id)
    if row.message_id is not None:
        raise ValidationError("attachment is part of conversation history and cannot be deleted")
    row.is_deleted = True
    row.deleted_at = datetime.now(timezone.utc)
    db.commit()
    engine.delete_bytes(row.storage_path)
    logger.info("attachment deleted: %s", attachment_id)
