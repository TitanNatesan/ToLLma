"""Gateway endpoints only. No business logic."""

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from tollms.core.deps import get_db
from tollms.core.security import get_current_user
from tollms.models.user import User
from tollms.api.gateway import service
from tollms.api.gateway.schemas import ChatRequest, ChatResponse

router = APIRouter(prefix="/api/v1/gateway", tags=["gateway"])


@router.post("/chat", response_model=ChatResponse)
async def chat(data: ChatRequest, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> ChatResponse:
    return await service.run_chat(db, data, user_id=user.id)


@router.post("/stream")
async def stream(data: ChatRequest, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> StreamingResponse:
    return StreamingResponse(service.run_stream(db, data, user_id=user.id), media_type="text/event-stream")
