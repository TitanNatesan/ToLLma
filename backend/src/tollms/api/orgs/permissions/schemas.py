"""Permission-set request/response models."""

import uuid
from datetime import datetime

from pydantic import BaseModel, Field, field_validator


# Mirrored from overview/schemas.py (kept local: no sibling imports).
def _clean(v: str | None) -> str | None:
    if v is None:
        return None
    v = v.strip()
    if v and ("<" in v or ">" in v):
        raise ValueError("angle brackets are not allowed")
    return v or None



class PermissionSetCreate(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    description: str | None = Field(default=None, max_length=300)
    permissions: list[str] = Field(default_factory=list)

    @field_validator("description")
    @classmethod
    def _clean_description(cls, v: str | None) -> str | None:
        return _clean(v)



class PermissionSetUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=80)
    description: str | None = Field(default=None, max_length=300)
    permissions: list[str] | None = None



class PermissionSetRead(BaseModel):
    id: uuid.UUID
    name: str
    description: str | None
    is_system: bool
    permissions: list[str] = Field(default_factory=list)
    created_at: datetime
    # Table enrichment (computed from live assignment rows, no migration):
    # member_count = live memberships holding this set; team_count = live
    # teams with this set attached.
    member_count: int = 0
    team_count: int = 0



class AssignSets(BaseModel):
    set_ids: list[uuid.UUID] = Field(default_factory=list)

