"""Media generation endpoints: images and videos through the gateway."""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from tollms.api.attachments.schemas import AttachmentRead
from tollms.api.media import service
from tollms.api.media.schemas import ImageGenerateRequest, MediaResult, VideoGenerateRequest
from tollms.core.deps import get_db
from tollms.core.security import get_current_user
from tollms.models.user import User

router = APIRouter(prefix="/api/v1/media", tags=["media"])


def _read(attachment, latency_ms: float) -> MediaResult:
    return MediaResult(attachment=AttachmentRead.model_validate(attachment), latency_ms=latency_ms)


@router.post("/images", response_model=MediaResult)
async def generate_image(
    data: ImageGenerateRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> MediaResult:
    """Text -> image via the model's images/generations endpoint."""
    attachment, latency = await service.generate_image(db, data, user.id)
    return _read(attachment, latency)


@router.post("/videos", response_model=MediaResult)
async def generate_video(
    data: VideoGenerateRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> MediaResult:
    """Text (+ optional reference image) -> video via video/generations."""
    attachment, latency = await service.generate_video(db, data, user.id)
    return _read(attachment, latency)
