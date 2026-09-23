"""Provider request/response models. Credentials never leave the server unmasked."""

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from pydantic import BaseModel, Field

from tollms.models.provider import ProviderType


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


class DiscoveredModelInfo(BaseModel):
    """One provider-discovered model enriched with repository intelligence.

    Identity fields come from the provider; pricing/capabilities in
    `suggested` come from the repository match (or zeroed defaults).
    """

    model_id: str
    name: str
    endpoint_type: str
    primary_endpoint: str | None = None
    supported_endpoints: list[str] = Field(default_factory=list)
    context_window: int | None = None
    max_output_tokens: int | None = None
    repository_model_key: str | None = None
    match_type: str = "fallback"
    suggested: dict[str, Any] = Field(default_factory=dict)
    repository_match: dict[str, Any] = Field(default_factory=dict)


class DiscoveryResult(BaseModel):
    provider_id: uuid.UUID
    discovered: list[DiscoveredModelInfo] = Field(default_factory=list)
    total: int = 0
    new_count: int = 0
    registered_count: int = 0
    last_discovery_at: datetime | None = None
    message: str = ""


class DraftValidate(BaseModel):
    provider_type: ProviderType
    credentials: dict[str, Any]


class DraftDiscoveredModel(BaseModel):
    model_id: str
    name: str
    endpoint_type: str
    primary_endpoint: str | None = None
    supported_endpoints: list[str] = Field(default_factory=list)
    context_window: int | None = None
    max_output_tokens: int | None = None
    suggested: dict[str, Any] = Field(default_factory=dict)


class DraftValidationResult(BaseModel):
    valid: bool
    message: str
    latency_ms: float
    discovered: list[DraftDiscoveredModel] = Field(default_factory=list)


class RegisterModelItem(BaseModel):
    model_id: str = Field(min_length=1, max_length=255)
    name: str = Field(min_length=1, max_length=255)
    description: str | None = None
    endpoint_type: str = "chat_completions"
    primary_endpoint: str | None = Field(default=None, max_length=64)
    supported_endpoints: list[str] = Field(default_factory=list)
    repository_model_key: str | None = None
    repository_match: dict[str, Any] | None = None
    input_price: Decimal = Decimal("0")
    output_price: Decimal = Decimal("0")
    cache_read_price: Decimal = Decimal("0")
    cache_write_price: Decimal = Decimal("0")
    supports_text: bool = True
    supports_vision: bool = False
    supports_audio_input: bool = False
    supports_audio_output: bool = False
    supports_image_generation: bool = False
    supports_tool_calling: bool = False
    supports_reasoning: bool = False
    supports_embeddings: bool = False
    supports_streaming: bool = True
    context_window: int | None = None
    max_output_tokens: int | None = None
    release_date: date | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    is_active: bool = True


class ProviderRegister(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    provider_type: ProviderType
    description: str | None = None
    credentials: dict[str, Any]
    metadata: dict[str, Any] = Field(default_factory=dict)
    validation_status: str | None = None
    validation_message: str | None = None
    models: list[RegisterModelItem] = Field(default_factory=list)


class RegisterResult(BaseModel):
    provider: ProviderRead
    models_created: int
    match_stats: dict[str, int]


class ProviderSecurityRead(BaseModel):
    """Credential-encryption health for one provider. Never returns secrets."""

    encrypted: bool
    masked: bool
    algorithm: str
    credential_keys: list[str]
    validation_status: str
    last_validated_at: datetime | None = None
