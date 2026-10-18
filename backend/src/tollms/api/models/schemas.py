"""Model registry request/response models."""

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from pydantic import BaseModel, Field

from tollms.models.registered_model import EndpointType

CAPABILITY_FIELDS = (
    "supports_text",
    "supports_vision",
    "supports_audio_input",
    "supports_audio_output",
    "supports_image_generation",
    "supports_video_generation",
    "supports_tool_calling",
    "supports_reasoning",
    "supports_embeddings",
    "supports_streaming",
)


class ModelCreate(BaseModel):
    provider_id: uuid.UUID
    model_id: str = Field(min_length=1, max_length=255)
    name: str = Field(min_length=1, max_length=255)
    description: str | None = None
    endpoint_type: EndpointType = EndpointType.CHAT_COMPLETIONS
    # Endpoint-aware routing (wire paths, e.g. "responses", "images/generations").
    primary_endpoint: str | None = Field(default=None, max_length=64)
    supported_endpoints: list[str] = Field(default_factory=list)
    repository_model_key: str | None = Field(default=None, max_length=255)
    input_price: Decimal = Decimal("0")
    output_price: Decimal = Decimal("0")
    cache_read_price: Decimal = Decimal("0")
    cache_write_price: Decimal = Decimal("0")
    supports_text: bool = True
    supports_vision: bool = False
    supports_audio_input: bool = False
    supports_audio_output: bool = False
    supports_image_generation: bool = False
    supports_video_generation: bool = False
    supports_tool_calling: bool = False
    supports_reasoning: bool = False
    supports_embeddings: bool = False
    supports_streaming: bool = True
    context_window: int | None = None
    max_output_tokens: int | None = None
    release_date: date | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    is_active: bool = True


class ModelUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    endpoint_type: EndpointType | None = None
    primary_endpoint: str | None = Field(default=None, max_length=64)
    supported_endpoints: list[str] | None = None
    input_price: Decimal | None = None
    output_price: Decimal | None = None
    cache_read_price: Decimal | None = None
    cache_write_price: Decimal | None = None
    supports_text: bool | None = None
    supports_vision: bool | None = None
    supports_audio_input: bool | None = None
    supports_audio_output: bool | None = None
    supports_image_generation: bool | None = None
    supports_video_generation: bool | None = None
    supports_tool_calling: bool | None = None
    supports_reasoning: bool | None = None
    supports_embeddings: bool | None = None
    supports_streaming: bool | None = None
    context_window: int | None = None
    max_output_tokens: int | None = None
    release_date: date | None = None
    metadata: dict[str, Any] | None = None
    is_active: bool | None = None


class ModelRead(BaseModel):
    id: uuid.UUID
    provider_id: uuid.UUID
    model_id: str
    name: str
    description: str | None
    endpoint_type: EndpointType
    primary_endpoint: str | None = None
    supported_endpoints: list[str] = Field(default_factory=list)
    input_price: Decimal
    output_price: Decimal
    cache_read_price: Decimal
    cache_write_price: Decimal
    supports_text: bool
    supports_vision: bool
    supports_audio_input: bool
    supports_audio_output: bool
    supports_image_generation: bool
    supports_video_generation: bool = False
    supports_tool_calling: bool
    supports_reasoning: bool
    supports_embeddings: bool = False
    supports_streaming: bool
    context_window: int | None
    max_output_tokens: int | None
    release_date: date | None
    repository_model_key: str | None
    reasoning_options: list[dict[str, Any]] | None = None
    # `metadata` is reserved on SQLAlchemy models; the column attribute is `metadata_`.
    metadata_: dict[str, Any] = Field(alias="metadata")
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True, "populate_by_name": True}


def read_model(m) -> ModelRead:
    """Map one registered-model ORM row to its public read shape (no secrets).

    Single home for the mapping so the registry router and the scoped chat
    picker (`chat_models_for_key`) serialize identically.
    """
    return ModelRead(
        id=m.id,
        provider_id=m.provider_id,
        model_id=m.model_id,
        name=m.name,
        description=m.description,
        endpoint_type=m.endpoint_type,
        primary_endpoint=m.primary_endpoint,
        supported_endpoints=list(m.supported_endpoints or []),
        input_price=m.input_price,
        output_price=m.output_price,
        cache_read_price=m.cache_read_price,
        cache_write_price=m.cache_write_price,
        supports_text=m.supports_text,
        supports_vision=m.supports_vision,
        supports_audio_input=m.supports_audio_input,
        supports_audio_output=m.supports_audio_output,
        supports_image_generation=m.supports_image_generation,
        supports_video_generation=m.supports_video_generation,
        supports_tool_calling=m.supports_tool_calling,
        supports_reasoning=m.supports_reasoning,
        supports_embeddings=m.supports_embeddings,
        supports_streaming=m.supports_streaming,
        context_window=m.context_window,
        max_output_tokens=m.max_output_tokens,
        release_date=m.release_date,
        repository_model_key=m.repository_model_key,
        reasoning_options=(
            m.metadata_.get("reasoning_options")
            if isinstance(getattr(m, "metadata_", None), dict)
            and isinstance(m.metadata_.get("reasoning_options"), list)
            else None
        ),
        metadata=m.metadata_,
        is_active=m.is_active,
        created_at=m.created_at,
        updated_at=m.updated_at,
    )
