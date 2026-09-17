"""Gateway endpoints only. No business logic."""

import uuid

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from tollms.core.deps import get_db
from tollms.core.security import get_current_user
from tollms.models.user import User
from tollms.api.gateway import service
from tollms.api.gateway.schemas import (
    ActiveGenerationRead,
    ChatRequest,
    ChatResponse,
    GenerationCancelRead,
    GenerationStarted,
)

router = APIRouter(prefix="/api/v1/gateway", tags=["gateway"])


@router.post("/chat", response_model=ChatResponse)
async def chat(data: ChatRequest, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> ChatResponse:
    return await service.run_chat(db, data, user_id=user.id)


@router.post("/stream")
async def start_stream(
    data: ChatRequest, request: Request, db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> StreamingResponse:
    """Create the generation (assistant row starts RUNNING) and stream its
    progress events. The connection is a subscriber: dropping it never stops
    the backend generation — reattach via GET stream/{generation_id}."""
    started = await service.start_generation(db, data, user_id=user.id)
    return StreamingResponse(
        service.stream_events(db, started.generation_id, user.id, request.is_disconnected),
        media_type="text/event-stream",
    )


@router.get("/stream/{generation_id}")
async def reattach_stream(
    generation_id: uuid.UUID, request: Request, db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> StreamingResponse:
    """Refresh recovery: current partial content first, then live deltas."""
    return StreamingResponse(
        service.reattach_events(db, generation_id, user.id, request.is_disconnected),
        media_type="text/event-stream",
    )


@router.post("/generations/{generation_id}/cancel", response_model=GenerationCancelRead)
async def cancel_generation(
    generation_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> GenerationCancelRead:
    return await service.cancel_generation(db, generation_id, user.id)


@router.get("/generations/{generation_id}", response_model=ActiveGenerationRead)
async def generation_status(
    generation_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> ActiveGenerationRead:
    return service.generation_status(db, generation_id, user.id)
