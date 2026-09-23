"""Media generation request/response models (images + videos)."""

import uuid

from pydantic import BaseModel, Field

from tollms.api.attachments.schemas import AttachmentRead


class ImageGenerateRequest(BaseModel):
    provider_id: uuid.UUID
    model_id: uuid.UUID
    prompt: str = Field(min_length=1, max_length=4000)
    size: str = Field(default="1024x1024", max_length=16)
    quality: str = Field(default="low", max_length=16)


class VideoGenerateRequest(BaseModel):
    provider_id: uuid.UUID
    model_id: uuid.UUID
    prompt: str = Field(min_length=1, max_length=4000)
    size: str = Field(default="1280x720", max_length=16)
    seconds: str = Field(default="2", max_length=4)
    # Optional reference image attachment id -> image-to-video.
    reference_attachment_id: uuid.UUID | None = None


class MediaResult(BaseModel):
    attachment: AttachmentRead
    latency_ms: float
