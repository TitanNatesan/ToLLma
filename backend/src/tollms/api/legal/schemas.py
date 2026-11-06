"""Legal schemas. Request/response DTOs only; no ORM imports."""

import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class LegalDocumentRead(BaseModel):
    slug: str
    version: str
    title: str
    locale: str
    status: str
    content_hash: str
    requires_reaccept: bool
    effective_at: datetime | None
    published_at: datetime | None


class LegalDocumentBody(LegalDocumentRead):
    body: str


class LegalDocumentUpsert(BaseModel):
    slug: str = Field(min_length=1, max_length=120)
    version: str = Field(min_length=1, max_length=32)
    title: str = Field(min_length=1, max_length=255)
    locale: str = Field(default="en-IN", max_length=12)
    body: str = Field(min_length=1)
    requires_reaccept: bool = False
    effective_at: datetime | None = None
    publish: bool = False


class LegalAcceptanceCreate(BaseModel):
    slug: str = Field(min_length=1, max_length=120)
    ui_version: str | None = Field(default=None, max_length=64)


class LegalAcceptanceRead(BaseModel):
    id: uuid.UUID
    document_slug: str
    document_version: str
    content_hash: str
    accepted_at: datetime
    method: str
    locale: str
