"""Message intelligence endpoints: history, edit, regenerate, generations, branches."""

import uuid

from fastapi import APIRouter, Depends, Request
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
from tollms.core.sessions import gateway_client_ip
from tollms.models.user import User

router = APIRouter(prefix="/api/v1/messages", tags=["messages"])


@router.get("/{message_id}/history", response_model=MessageHistoryRead, operation_id="get_message_history")
def history(
    message_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> MessageHistoryRead:
    return service.message_history(db, message_id, user.id)


@router.patch("/{message_id}", response_model=MessageEditRead, operation_id="edit_message_branch")
async def edit(
    message_id: uuid.UUID,
    data: MessageEditRequest,
    request: Request,
    # Session-user key serving the auto-regeneration (same gate as chat send).
    # Query param: the edit body schema carries only the new content.
    key_id: uuid.UUID | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> MessageEditRead:
    """Branching edit (Rule B): a new user sibling plus a regenerated child.

    The edited node stays untouched; the active leaf moves to the new child.
    """
    from tollms.core.security import get_current_session_id

    edited, versions, child = await service.edit_message(
        db, message_id, data.content, user.id, key_id=key_id,
        session_id=get_current_session_id(request),
        client_ip=gateway_client_ip(request) if request is not None else None,
    )
    read = message_reads(db, [edited], user.id)[0]
    return MessageEditRead(
        message=read,
        versions=[MessageVersionRead.model_validate(row) for row in versions],
        current_version=versions[-1].version_number if versions else edited.version_number,
        regeneration_started=child is not None,
        regenerating_message_id=child.id if child is not None else None,
    )


@router.get("/{message_id}/generations", operation_id="list_message_generations")
def generations(
    message_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
):
    history_read = service.message_history(db, message_id, user.id)
    return history_read.generations


@router.post("/{message_id}/regenerate", response_model=GenerationStarted, operation_id="regenerate_message")
async def regenerate(
    message_id: uuid.UUID,
    request: Request,
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
        key_id=payload.key_id,
        reasoning_level=payload.reasoning_level,
        client_ip=gateway_client_ip(request) if request is not None else None,
    )


@router.post("/{message_id}/generations/{run_id}/activate", response_model=GenerationActivateRead, operation_id="activate_message_generation")
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


@router.delete("/{message_id}", status_code=204, operation_id="delete_message")
def delete(
    message_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> None:
    service.delete_message(db, message_id, user.id)


@router.get("/{message_id}", response_model=MessageRead, operation_id="get_message")
def read(
    message_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> MessageRead:
    from tollms.api.conversations.service import get_message

    return message_reads(db, [get_message(db, message_id, user.id)], user.id)[0]


@router.get("/{message_id}/siblings", response_model=list[MessageRead], operation_id="list_message_siblings")
def siblings(
    message_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> list[MessageRead]:
    """Same-parent versions of a node (Rule A alternatives), by version."""
    return message_reads(db, service.message_siblings(db, message_id, user.id), user.id)


@router.get("/{message_id}/children", response_model=list[MessageRead], operation_id="list_message_children")
def children(
    message_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> list[MessageRead]:
    """Direct replies to a node, ordered by version."""
    return message_reads(db, service.message_children(db, message_id, user.id), user.id)
