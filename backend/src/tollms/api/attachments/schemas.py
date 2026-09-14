"""Attachment request/response models. Storage paths are never serialized."""

import uuid
from datetime import datetime

from pydantic import BaseModel


class AttachmentUploadResponse(BaseModel):
    attachment_id: uuid.UUID
    filename: str
    mime_type: str
    kind: str
    size: int


class AttachmentRead(BaseModel):
    id: uuid.UUID
    filename: str
    mime_type: str
    kind: str
    file_size: int
    conversation_id: uuid.UUID | None
    message_id: uuid.UUID | None
    created_at: datetime

    model_config = {"from_attributes": True}
