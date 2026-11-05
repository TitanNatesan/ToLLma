"""Organization request/response models."""

import re
import uuid
from datetime import datetime

from pydantic import BaseModel, Field, field_validator


_NAME_RE = re.compile(r"^[\w\s\-.'&(),]{2,120}$", re.UNICODE)



def _clean(v: str | None) -> str | None:
    if v is None:
        return None
    v = v.strip()
    if v and ("<" in v or ">" in v):
        raise ValueError("angle brackets are not allowed")
    return v or None



class OrgCreate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    description: str | None = Field(default=None, max_length=500)
    website: str | None = Field(default=None, max_length=255)
    industry: str | None = Field(default=None, max_length=80)
    location: str | None = Field(default=None, max_length=120)
    size: str | None = Field(default=None, max_length=32)

    @field_validator("description", "website", "industry", "location", "size")
    @classmethod
    def _clean_fields(cls, v: str | None) -> str | None:
        return _clean(v)

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        v = v.strip()
        if not _NAME_RE.match(v):
            raise ValueError("invalid organization name")
        return v



class OrgUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    description: str | None = Field(default=None, max_length=500)
    website: str | None = Field(default=None, max_length=255)
    industry: str | None = Field(default=None, max_length=80)
    location: str | None = Field(default=None, max_length=120)
    size: str | None = Field(default=None, max_length=32)

    @field_validator("description", "website", "industry", "location", "size")
    @classmethod
    def _clean_fields(cls, v: str | None) -> str | None:
        return _clean(v)

    @field_validator("name")
    @classmethod
    def _update_name(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip()
        if not _NAME_RE.match(v):
            raise ValueError("invalid organization name")
        return v



class OrgRead(BaseModel):
    id: uuid.UUID
    name: str
    slug: str
    description: str | None
    website: str | None
    industry: str | None
    location: str | None
    size: str | None
    status: str
    is_root: bool = False
    permissions: list[str] = Field(default_factory=list)
    created_at: datetime



class OrgCard(BaseModel):
    """Public discovery card: no governance data, safe for any authenticated user."""

    id: uuid.UUID
    name: str
    slug: str
    description: str | None
    website: str | None
    industry: str | None

