"""Export request/response models."""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator

ExportFormat = Literal["md", "json", "pdf"]
AnalyticsFormat = Literal["csv", "xlsx", "json"]


class ConversationExportRequest(BaseModel):
    conversation_ids: list[uuid.UUID] = Field(default_factory=list, max_length=200)
    all: bool = False
    format: ExportFormat = "md"

    @model_validator(mode="after")
    def _scope(self) -> "ConversationExportRequest":
        if not self.all and not self.conversation_ids:
            raise ValueError("provide conversation_ids or all=true")
        return self


class ExportEventRead(BaseModel):
    id: uuid.UUID
    dataset: str
    format: str
    item_count: int
    detail: str | None = None
    created_at: datetime


class ExportResultRead(BaseModel):
    """Metadata response for exports (file bytes stream separately)."""

    dataset: str
    format: str
    item_count: int
    filename: str
