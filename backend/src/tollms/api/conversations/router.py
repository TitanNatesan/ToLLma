"""Conversation + message endpoints only. No business logic."""

import uuid

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from tollms.core.deps import get_db
from tollms.core.security import require_active_user
from tollms.models.user import User
from tollms.api.conversations import service
from tollms.api.conversations import compaction
from tollms.api.conversations.schemas import (
    BranchCreateRequest,
    CompactResponse,
    BranchListRead,
    BranchRead,
    ConversationCreate,
    ConversationPathRead,
    ConversationPin,
    ConversationRead,
    ConversationRename,
    ConversationTreeRead,
    MessageRead,
    SelectRequest,
    UsageTotals,
)
from tollms.api.gateway.schemas import ActiveGenerationRead

router = APIRouter(prefix="/api/v1/conversations", tags=["conversations"])


@router.post("", response_model=ConversationRead, status_code=201)
def create(data: ConversationCreate, db: Session = Depends(get_db), user: User = Depends(require_active_user)) -> ConversationRead:
    conv = service.create_conversation(db, data, user.id)
    return service.conversation_read(db, conv.id, user.id)


@router.get("", response_model=list[ConversationRead])
def list_all(response: Response, search: str | None = None,
             limit: int = Query(default=20, ge=1, le=100),
             cursor: str | None = None,
             db: Session = Depends(get_db),
             user: User = Depends(require_active_user)) -> list[ConversationRead]:
    convs, next_cursor = service.list_conversations(
        db, search=search, user_id=user.id, limit=limit, cursor=cursor)
    if next_cursor is not None:
        response.headers["X-Next-Cursor"] = next_cursor
    out = []
    for c in convs:
        item = ConversationRead.model_validate(c)
        item.messages = []
        out.append(item)
    return out


@router.get("/{conversation_id}", response_model=ConversationRead)
def get(conversation_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(require_active_user)) -> ConversationRead:
    return service.conversation_read(db, conversation_id, user.id)


@router.patch("/{conversation_id}", response_model=ConversationRead)
def rename(conversation_id: uuid.UUID, data: ConversationRename, db: Session = Depends(get_db), user: User = Depends(require_active_user)) -> ConversationRead:
    conv = service.rename_conversation(db, conversation_id, data.title, user.id)
    return service.conversation_read(db, conv.id, user.id)


@router.delete("/{conversation_id}", status_code=204)
def delete(conversation_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(require_active_user)) -> None:
    service.delete_conversation(db, conversation_id, user.id)


@router.patch("/{conversation_id}/pin", response_model=ConversationRead)
def pin(conversation_id: uuid.UUID, data: ConversationPin, db: Session = Depends(get_db), user: User = Depends(require_active_user)) -> ConversationRead:
    conv = service.pin_conversation(db, conversation_id, pinned=data.pinned, user_id=user.id)
    return service.conversation_read(db, conv.id, user.id)


@router.get("/{conversation_id}/messages", response_model=list[MessageRead])
def messages(conversation_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(require_active_user)) -> list[MessageRead]:
    return service.message_reads(db, service.list_messages(db, conversation_id, user.id), user.id)


@router.get("/{conversation_id}/usage", response_model=UsageTotals)
def usage(conversation_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(require_active_user)) -> UsageTotals:
    return service.usage_totals(db, conversation_id, user.id)


@router.get("/{conversation_id}/active-generation", response_model=ActiveGenerationRead)
def active_generation(conversation_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(require_active_user)) -> ActiveGenerationRead:
    """Refresh recovery: the running generation, if any. 404 means refresh-from-DB."""
    # Deferred: gateway.service imports conversations.service at module level.
    from tollms.api.gateway import service as gateway_service

    return gateway_service.active_generation(db, conversation_id, user.id)


@router.get("/{conversation_id}/branches", response_model=BranchListRead)
def branches(
    conversation_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> BranchListRead:
    from tollms.api.messages import service as message_service

    return BranchListRead.model_validate(message_service.branch_tree(db, conversation_id, user.id))


@router.post("/{conversation_id}/branches", response_model=BranchRead, status_code=201)
def create_branch(
    conversation_id: uuid.UUID,
    data: BranchCreateRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> BranchRead:
    from tollms.api.messages import service as message_service

    branch = message_service.create_branch(
        db, conversation_id, data.message_id, user.id, data.branch_name
    )
    return message_service._branch_read(db, branch)


@router.get("/{conversation_id}/tree", response_model=ConversationTreeRead)
def tree(conversation_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(require_active_user)) -> ConversationTreeRead:
    """Versioned branching tree: every node + the selected leaf id."""
    return ConversationTreeRead.model_validate(service.conversation_tree(db, conversation_id, user.id))


@router.get("/{conversation_id}/path", response_model=ConversationPathRead)
def path(conversation_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(require_active_user)) -> ConversationPathRead:
    """Active path (root to selected leaf). This is the model context."""
    result = service.conversation_path(db, conversation_id, user.id)
    return ConversationPathRead(
        path=service.message_reads(db, result["path"], user.id),
        active_leaf_id=result["active_leaf_id"],
    )


@router.post(
    "/{conversation_id}/compact",
    response_model=CompactResponse,
    operation_id="compact_conversation",
)
async def compact(
    conversation_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(require_active_user)
) -> CompactResponse:
    """Progressive compaction: consolidate the active path into a summary node."""
    return await compaction.compact_request(db, conversation_id, user.id)


@router.post("/{conversation_id}/select", response_model=ConversationPathRead)
def select(conversation_id: uuid.UUID, data: SelectRequest, db: Session = Depends(get_db), user: User = Depends(require_active_user)) -> ConversationPathRead:
    """Switch the active branch to a node; new messages continue from it."""
    result = service.select_message(db, conversation_id, data.message_id, user.id)
    return ConversationPathRead(
        path=service.message_reads(db, result["path"], user.id),
        active_leaf_id=result["active_leaf_id"],
    )
