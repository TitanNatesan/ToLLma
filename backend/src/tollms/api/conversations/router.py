"""Conversation + message endpoints only. No business logic."""

import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from tollms.core.deps import get_db
from tollms.api.conversations import service
from tollms.api.conversations.schemas import (
    ConversationCreate,
    ConversationPin,
    ConversationRead,
    ConversationRename,
    MessageRead,
    UsageTotals,
)

router = APIRouter(prefix="/api/v1/conversations", tags=["conversations"])


@router.post("", response_model=ConversationRead, status_code=201)
def create(data: ConversationCreate, db: Session = Depends(get_db)) -> ConversationRead:
    conv = service.create_conversation(db, data)
    return ConversationRead.model_validate(service.get_conversation_with_messages(db, conv.id))


@router.get("", response_model=list[ConversationRead])
def list_all(search: str | None = None, db: Session = Depends(get_db)) -> list[ConversationRead]:
    convs = service.list_conversations(db, search=search)
    out = []
    for c in convs:
        item = ConversationRead.model_validate(c)
        item.messages = []
        out.append(item)
    return out


@router.get("/{conversation_id}", response_model=ConversationRead)
def get(conversation_id: uuid.UUID, db: Session = Depends(get_db)) -> ConversationRead:
    return ConversationRead.model_validate(service.get_conversation_with_messages(db, conversation_id))


@router.patch("/{conversation_id}", response_model=ConversationRead)
def rename(conversation_id: uuid.UUID, data: ConversationRename, db: Session = Depends(get_db)) -> ConversationRead:
    conv = service.rename_conversation(db, conversation_id, data.title)
    return ConversationRead.model_validate(service.get_conversation_with_messages(db, conv.id))


@router.delete("/{conversation_id}", status_code=204)
def delete(conversation_id: uuid.UUID, db: Session = Depends(get_db)) -> None:
    service.delete_conversation(db, conversation_id)


@router.patch("/{conversation_id}/pin", response_model=ConversationRead)
def pin(conversation_id: uuid.UUID, data: ConversationPin, db: Session = Depends(get_db)) -> ConversationRead:
    conv = service.pin_conversation(db, conversation_id, pinned=data.pinned)
    return ConversationRead.model_validate(service.get_conversation_with_messages(db, conv.id))


@router.get("/{conversation_id}/messages", response_model=list[MessageRead])
def messages(conversation_id: uuid.UUID, db: Session = Depends(get_db)) -> list[MessageRead]:
    return [MessageRead.model_validate(m) for m in service.list_messages(db, conversation_id)]


@router.get("/{conversation_id}/usage", response_model=UsageTotals)
def usage(conversation_id: uuid.UUID, db: Session = Depends(get_db)) -> UsageTotals:
    return service.usage_totals(db, conversation_id)
