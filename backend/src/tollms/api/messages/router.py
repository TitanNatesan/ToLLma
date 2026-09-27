"""Message intelligence endpoints: history, edit, regenerate, generations, branches."""

import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from tollms.api.conversations.schemas import MessageRead
from tollms.api.conversations.service import message_reads
from tollms.api.gateway.schemas import GenerationStarted, RegenerateRequest
from tollms.api.messages import service
from tollms.api.messages.schemas import (
    GenerationActivateRead,
    MessageEditRead,
    MessageEditRequest,
    MessageHistoryRead,
    MessageVersionRead,
)
from tollms.core.deps import get_db
from tollms.core.security import require_active_user
from tollms.models.user import User

router = APIRouter(prefix="/api/v1/messages", tags=["messages"])


@router.get("/{message_id}/history", response_model=MessageHistoryRead)
def history(
    message_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> MessageHistoryRead:
    return service.message_history(db, message_id, user.id)


@router.patch("/{message_id}", response_model=MessageEditRead)
async def edit(
    message_id: uuid.UUID,
    data: MessageEditRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> MessageEditRead:
    """Edit a user message, then regenerate the response that followed it."""
    message, versions, target = service.edit_message(db, message_id, data.content, user.id)
    read = message_reads(db, [message], user.id)[0]
    response = MessageEditRead(
        message=read,
        versions=[MessageVersionRead.model_validate(row) for row in versions],
        current_version=versions[-1].version_number if versions else 1,
    )
    if target is not None:
        await service.regenerate_message(
            db, target.id, user.id, session_factory=None, session_id=None
        )
        response.regeneration_started = True
        response.regenerating_message_id = target.id
    return response


@router.get("/{message_id}/generations")
def generations(
    message_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
):
    history_read = service.message_history(db, message_id, user.id)
    return history_read.generations


@router.post("/{message_id}/regenerate", response_model=GenerationStarted)
async def regenerate(
    message_id: uuid.UUID,
    data: RegenerateRequest | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> GenerationStarted:
    payload = data or RegenerateRequest()
    return await service.regenerate_message(
        db,
        message_id,
        user.id,
        provider_id=payload.provider_id,
        model_id=payload.model_id,
        reasoning_level=payload.reasoning_level,
    )


@router.post("/{message_id}/generations/{run_id}/activate", response_model=GenerationActivateRead)
def activate(
    message_id: uuid.UUID,
    run_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> GenerationActivateRead:
    message, run = service.activate_generation(db, message_id, run_id, user.id)
    read = message_reads(db, [message], user.id)[0]
    runs = service.run_reads(db, [run])
    return GenerationActivateRead(message=read, run=runs[0])


@router.delete("/{message_id}", status_code=204)
def delete(
    message_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> None:
    service.delete_message(db, message_id, user.id)


@router.get("/{message_id}", response_model=MessageRead)
def read(
    message_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> MessageRead:
    from tollms.api.conversations.service import get_message

    return message_reads(db, [get_message(db, message_id, user.id)], user.id)[0]
