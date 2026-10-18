"""Model repository request/response models."""

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from pydantic import BaseModel, Field


class RepositoryModelRead(BaseModel):
    id: uuid.UUID
    model_key: str
    canonical_name: str
    display_name: str | None
    family: str | None
    provider: str
    provider_model_id: str
    vendor: str | None
    endpoint_type: str
    primary_endpoint: str | None = None
    supported_endpoints: list[str] = []
    description: str | None
    documentation_url: str | None
    release_date: date | None
    is_active: bool
    is_deprecated: bool
    last_seen_at: datetime | None
    sources: list[str]
    supports_text_input: bool
    supports_text_output: bool
    supports_chat: bool = False
    supports_vision_input: bool
    supports_image_output: bool
    supports_audio_input: bool
    supports_audio_output: bool
    supports_video_input: bool
    supports_video_output: bool
    supports_reasoning: bool
    supports_tool_calling: bool
    supports_structured_output: bool
    supports_streaming: bool
    supports_embeddings: bool
    supports_prompt_caching: bool
    # Capability view derived from supported_endpoints at sync time.
    supports_responses: bool = False
    supports_image_generation: bool = False
    supports_image_editing: bool = False
    supports_video_generation: bool = False
    context_window: int | None
    max_input_tokens: int | None
    max_output_tokens: int | None
    max_images: int | None
    max_audio_length: int | None
    max_video_length: int | None
    input_cost: Decimal | None
    output_cost: Decimal | None
    cache_read_cost: Decimal | None
    cache_write_cost: Decimal | None
    image_input_cost: Decimal | None
    image_output_cost: Decimal | None
    audio_input_cost: Decimal | None
    audio_output_cost: Decimal | None
    video_input_cost: Decimal | None
    video_output_cost: Decimal | None
    reasoning_cost: Decimal | None
    # Normalized catalog links (models.json). NULL when unlinked.
    canonical_id: str | None = None
    reasoning_options: list[dict[str, Any]] | None = None
    extra_cost: dict[str, Any] | None = None
    # Media rate card (official per-image / per-second prices).
    image_low_price: Decimal | None = None
    image_medium_price: Decimal | None = None
    image_high_price: Decimal | None = None
    video_price_per_second: Decimal | None = None
    # `metadata` is reserved on SQLAlchemy models; the column attribute is `metadata_`.
    metadata_: dict[str, Any] = Field(alias="metadata")
    raw_source_payload: dict[str, Any]
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True, "populate_by_name": True}


class RepositoryModelPage(BaseModel):
    items: list[RepositoryModelRead]
    total: int
    page: int
    page_size: int


class RepositoryLookupRead(BaseModel):
    entry: RepositoryModelRead
    suggested: dict[str, Any]


class LastSyncRead(BaseModel):
    id: uuid.UUID
    status: str
    started_at: datetime
    finished_at: datetime | None
    models_created: int
    models_updated: int
    models_deactivated: int
    errors_count: int


class RepositoryStatsRead(BaseModel):
    total_models: int
    active_models: int
    deprecated_models: int
    providers_count: int
    by_provider: dict[str, int]
    last_sync: LastSyncRead | None


class SyncRunRead(BaseModel):
    id: uuid.UUID
    started_at: datetime
    finished_at: datetime | None
    status: str
    models_created: int
    models_updated: int
    models_deactivated: int
    errors_count: int
    error_details: list[str]

    model_config = {"from_attributes": True}



class CanonicalModelRead(BaseModel):
    id: uuid.UUID
    canonical_id: str
    name: str
    description: str | None = None
    family: str | None = None
    release_date: date | None = None
    last_updated: date | None = None
    open_weights: bool | None = None
    knowledge: str | None = None
    # `metadata` is reserved on SQLAlchemy models; the column attr is `metadata_`.
    metadata_: dict[str, Any] = Field(alias="metadata")
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True, "populate_by_name": True}


class CanonicalModelPage(BaseModel):
    items: list[CanonicalModelRead]
    total: int
    page: int
    page_size: int


class CanonicalDetailRead(BaseModel):
    canonical: CanonicalModelRead
    offerings: list[RepositoryModelRead] = Field(default_factory=list)
