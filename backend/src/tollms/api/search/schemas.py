"""Search request/response models."""

import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class SearchResult(BaseModel):
    conversation_id: uuid.UUID
    conversation_title: str
    message_id: uuid.UUID | None = None
    role: str | None = None
    kind: str
    snippet: str
    provider_id: uuid.UUID | None = None
    provider_name: str | None = None
    model_id: uuid.UUID | None = None
    model_name: str | None = None
    created_at: datetime
    rank: float


class SearchGroupItem(BaseModel):
    """One cross-type hit. Metadata only — never credential values, raw
    keys, prompt bodies, or secrets."""

    id: uuid.UUID
    type: str
    title: str
    subtitle: str | None = None
    snippet: str | None = None
    created_at: datetime | None = None


class SearchResponse(BaseModel):
    query: str
    total: int
    results: list[SearchResult]
    # Grouped cross-type hits (only populated when ?types= is given).
    groups: dict[str, list[SearchGroupItem]] = Field(default_factory=dict)


class SearchStatusRead(BaseModel):
    indexed_documents: int
    indexed_conversations: int
    indexed_messages: int
    provider: str = Field(default="postgresql", description="Full-text engine")
