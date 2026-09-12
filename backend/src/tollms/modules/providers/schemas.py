"""Provider request/response models. Credentials never leave the server unmasked."""

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field

from tollms.modules.providers.models import ProviderType


class ProviderCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    provider_type: ProviderType
    credentials: dict[str, Any]
    metadata: dict[str, Any] = Field(default_factory=dict)
    is_active: bool = True


class ProviderUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    credentials: dict[str, Any] | None = None
    metadata: dict[str, Any] | None = None
    is_active: bool | None = None


class ProviderRead(BaseModel):
    id: uuid.UUID
    name: str
    provider_type: ProviderType
    credentials_masked: dict[str, str]
    # `metadata` is reserved on SQLAlchemy models; the column attribute is `metadata_`.
    metadata_: dict[str, Any] = Field(alias="metadata")
    is_active: bool
    validation_status: str = "unknown"
    validation_message: str | None = None
    last_validated_at: datetime | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True, "populate_by_name": True}


class ValidationResult(BaseModel):
    valid: bool
    message: str
    latency_ms: float


class DiscoveryResult(BaseModel):
    provider_id: uuid.UUID
    discovered: list[str]
    created: int
    message: str
