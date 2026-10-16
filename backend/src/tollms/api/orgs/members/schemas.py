"""Membership roster response models."""

import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class TeamRef(BaseModel):
    """Compact team reference for member enrichment."""

    id: uuid.UUID
    name: str



class MemberRead(BaseModel):
    user_id: uuid.UUID
    email: str
    is_root: bool
    state: str
    permission_sets: list[str] = Field(default_factory=list)
    permissions: list[str] = Field(default_factory=list)
    # Enrichment, all computable from existing tables (no migration):
    # teams = live teams this membership belongs to; set_ids = live direct
    # set ids backing `permission_sets`; joined_at = membership created_at;
    # key_count = live org keys assigned to this user in this org.
    teams: list[TeamRef] = Field(default_factory=list)
    team_ids: list[uuid.UUID] = Field(default_factory=list)
    set_ids: list[uuid.UUID] = Field(default_factory=list)
    joined_at: datetime | None = None
    key_count: int = 0

