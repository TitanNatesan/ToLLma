"""Team request/response models."""

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator


class TeamCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    description: str | None = Field(default=None, max_length=300)
    set_ids: list[uuid.UUID] = Field(default_factory=list)

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("team name is required")
        return v



class TeamUpdate(BaseModel):
    """Rename/description only. org_id is immutable: unknown fields are
    rejected (422) so moving a team across orgs is impossible."""

    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=80)
    description: str | None = Field(default=None, max_length=300)

    @field_validator("name")
    @classmethod
    def _name(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip()
        if not v:
            raise ValueError("team name is required")
        return v



class TeamMemberAdd(BaseModel):
    user_id: uuid.UUID



class TeamMemberRead(BaseModel):
    membership_id: uuid.UUID
    user_id: uuid.UUID
    email: str
    full_name: str | None = None
    state: str



class TeamSetRead(BaseModel):
    id: uuid.UUID
    name: str
    codes: list[str] = Field(default_factory=list)



class TeamRead(BaseModel):
    id: uuid.UUID
    name: str
    description: str | None
    member_count: int = 0
    # Union of permission codes from the team's attached sets.
    codes: list[str] = Field(default_factory=list)
    created_at: datetime
    # Detail sections, populated ONLY when ?include= lists them; otherwise
    # left unset (the list route uses response_model_exclude_unset so the
    # default JSON is byte-identical to the old stripped shape).
    members: list[TeamMemberRead] | None = None
    sets: list[TeamSetRead] | None = None



class TeamDetail(TeamRead):
    members: list[TeamMemberRead] = Field(default_factory=list)
    sets: list[TeamSetRead] = Field(default_factory=list)

