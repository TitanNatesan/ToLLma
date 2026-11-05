"""Gateway endpoints only. No business logic."""

import uuid

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from tollms.core.deps import get_db
from tollms.core.security import get_current_session_id, require_active_user
from tollms.core.sessions import gateway_client_ip
from tollms.models.user import User
from tollms.api.gateway import service
from tollms.api.gateway.schemas import (
    ActiveGenerationRead,
    ChatKeyRead,
    ChatRequest,
    ChatResponse,
    GenerationCancelRead,
    GenerationStarted,
)
from tollms.api.models.schemas import ModelRead

router = APIRouter(prefix="/api/v1/gateway", tags=["gateway"])

# In-app key picker endpoints (session users). Separate prefix by design:
# these serve the chat composer, not the gateway pipeline.
chat_router = APIRouter(prefix="/api/v1/chat", tags=["chat"])


@chat_router.get("/keys", response_model=list[ChatKeyRead])
def chat_keys(
    db: Session = Depends(get_db), user: User = Depends(require_active_user)
) -> list[ChatKeyRead]:
    """Eligible keys for the caller (personal live + assigned org keys)."""
    return service.chat_keys(db, user.id)


@chat_router.get("/models", response_model=list[ModelRead])
def chat_models(
    key_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(require_active_user)
) -> list[ModelRead]:
    """Models eligible for one key (wrong-owner keys 404, same as gateway)."""
    return service.chat_models_for_key(db, key_id, user.id)


# NOTE: chat_router is NOT nested via router.include_router (prefixes would
# compose into /api/v1/gateway/api/v1/chat/...). main.py includes it directly,
# mirroring the attachments router (/api/v1/chat/attachments).


@router.post("/chat", response_model=ChatResponse)
async def chat(
    data: ChatRequest, request: Request,
    db: Session = Depends(get_db), user: User = Depends(require_active_user),
) -> ChatResponse:
    return await service.run_chat(
        db, data, user_id=user.id, session_id=get_current_session_id(request),
        client_ip=gateway_client_ip(request),
    )


@router.post("/stream")
async def start_stream(
    data: ChatRequest, request: Request, db: Session = Depends(get_db), user: User = Depends(require_active_user)
) -> StreamingResponse:
    """Create the generation (assistant row starts RUNNING) and stream its
    progress events. The connection is a subscriber: dropping it never stops
    the backend generation — reattach via GET stream/{generation_id}."""
    started = await service.start_generation(
        db, data, user_id=user.id, session_id=get_current_session_id(request),
        client_ip=gateway_client_ip(request),
    )
    return StreamingResponse(
        service.stream_events(db, started.generation_id, user.id, request.is_disconnected),
        media_type="text/event-stream",
    )


@router.get("/stream/{generation_id}")
async def reattach_stream(
    generation_id: uuid.UUID, request: Request, db: Session = Depends(get_db), user: User = Depends(require_active_user)
) -> StreamingResponse:
    """Refresh recovery: current partial content first, then live deltas."""
    return StreamingResponse(
        service.reattach_events(db, generation_id, user.id, request.is_disconnected),
        media_type="text/event-stream",
    )


@router.post("/generations/{generation_id}/cancel", response_model=GenerationCancelRead)
async def cancel_generation(
    generation_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(require_active_user)
) -> GenerationCancelRead:
    return await service.cancel_generation(db, generation_id, user.id)


@router.get("/generations/by-client/{client_key}", response_model=ActiveGenerationRead)
async def generation_by_client_key(
    client_key: str, db: Session = Depends(get_db), user: User = Depends(require_active_user)
) -> ActiveGenerationRead:
    return service.generation_by_client_key(db, client_key, user.id)


@router.get("/generations/{generation_id}", response_model=ActiveGenerationRead)
async def generation_status(
    generation_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(require_active_user)
) -> ActiveGenerationRead:
    return service.generation_status(db, generation_id, user.id)
