"""Gateway endpoints only. No business logic."""

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from tollms.core.deps import get_db
from tollms.modules.gateway import service
from tollms.modules.gateway.schemas import ChatRequest, ChatResponse

router = APIRouter(prefix="/api/v1/gateway", tags=["gateway"])


@router.post("/chat", response_model=ChatResponse)
async def chat(data: ChatRequest, db: Session = Depends(get_db)) -> ChatResponse:
    return await service.run_chat(db, data)


@router.post("/stream")
async def stream(data: ChatRequest, db: Session = Depends(get_db)) -> StreamingResponse:
    return StreamingResponse(service.run_stream(db, data), media_type="text/event-stream")
