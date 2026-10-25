"""Model registry table."""

import enum
import uuid
from datetime import date
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, Date, Enum, ForeignKey, Index, Numeric, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from tollms.db.base import Base, SoftDeleteMixin, TimestampedModel

if TYPE_CHECKING:
    from tollms.models.guardrail import GuardrailAssignment, GuardrailTrigger
    from tollms.models.provider import Provider


class EndpointType(str, enum.Enum):
    RESPONSES = "responses"
    CHAT_COMPLETIONS = "chat_completions"
    MESSAGES = "messages"
    CONVERSE = "converse"
    EMBEDDINGS = "embeddings"
    IMAGES_GENERATIONS = "images_generations"
    AUDIO_TRANSCRIPTIONS = "audio_transcriptions"
    AUDIO_SPEECH = "audio_speech"


# Canonical wire path per endpoint. `supported_endpoints`/`primary_endpoint`
# store these strings (JSONB / TEXT) so new endpoints never need a migration.
ENDPOINT_WIRE: dict[EndpointType, str] = {
    EndpointType.RESPONSES: "responses",
    EndpointType.CHAT_COMPLETIONS: "chat_completions",
    EndpointType.MESSAGES: "messages",
    EndpointType.CONVERSE: "converse",
    EndpointType.EMBEDDINGS: "embeddings",
    EndpointType.IMAGES_GENERATIONS: "images/generations",
    EndpointType.AUDIO_TRANSCRIPTIONS: "audio/transcriptions",
    EndpointType.AUDIO_SPEECH: "audio/speech",
}
WIRE_ENDPOINT: dict[str, EndpointType] = {wire: member for member, wire in ENDPOINT_WIRE.items()}

# Chat-style endpoints stream assistant text through the conversation system;
# the others are capability/utility endpoints with their own adapter methods.
CHAT_ENDPOINTS = frozenset(
    {
        ENDPOINT_WIRE[EndpointType.RESPONSES],
        ENDPOINT_WIRE[EndpointType.CHAT_COMPLETIONS],
        ENDPOINT_WIRE[EndpointType.MESSAGES],
        ENDPOINT_WIRE[EndpointType.CONVERSE],
    }
)


def endpoint_wire(endpoint: EndpointType | str | None) -> str | None:
    """Normalize an enum member or wire string to its wire path."""
    if endpoint is None:
        return None
    if isinstance(endpoint, EndpointType):
        return ENDPOINT_WIRE[endpoint]
    return endpoint


def endpoint_enum(endpoint: str | None) -> EndpointType | None:
    """Wire path -> enum member (None for unknown/future endpoints)."""
    if not endpoint:
        return None
    return WIRE_ENDPOINT.get(endpoint)


def normalize_endpoints(
    primary: str | None,
    supported: list[str] | None,
    legacy: EndpointType | None,
) -> tuple[EndpointType, str, list[str]]:
    """Coerce (primary_endpoint, supported_endpoints, endpoint_type) into agreement.

    Primary wins over the legacy enum; unknown endpoint strings fall back to
    chat_completions for the legacy enum while the wire string is preserved so
    future endpoints keep working before an enum member exists.
    """
    wire = (
        endpoint_wire(primary)
        or endpoint_wire(legacy)
        or ENDPOINT_WIRE[EndpointType.CHAT_COMPLETIONS]
    )
    enum = endpoint_enum(wire) or EndpointType.CHAT_COMPLETIONS
    endpoints = [item for item in dict.fromkeys(supported or []) if item]
    if wire not in endpoints:
        endpoints.insert(0, wire)
    return enum, wire, endpoints


class AIModel(SoftDeleteMixin, TimestampedModel):
    __tablename__ = "models"
    __table_args__ = (
        UniqueConstraint("provider_id", "model_id", name="uq_models_provider_model"),
        Index("ix_models_provider", "provider_id"),
        Index("ix_models_active", "is_active"),
        Index("ix_models_created", "created_at"),
        Index("ix_models_repo_key", "repository_model_key"),
    )

    provider_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("providers.id"), nullable=False)
    model_id: Mapped[str] = mapped_column(String(255), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    endpoint_type: Mapped[EndpointType] = mapped_column(Enum(EndpointType, name="endpoint_type"), nullable=False)
    # Endpoint-aware routing: the model decides where it is called. `endpoint_type`
    # stays as the legacy mirror of `primary_endpoint` for older readers.
    primary_endpoint: Mapped[str | None] = mapped_column(String(64), nullable=True)
    supported_endpoints: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)

    input_price: Mapped[Decimal] = mapped_column(Numeric(12, 6), default=Decimal("0"), nullable=False)
    output_price: Mapped[Decimal] = mapped_column(Numeric(12, 6), default=Decimal("0"), nullable=False)
    cache_read_price: Mapped[Decimal] = mapped_column(Numeric(12, 6), default=Decimal("0"), nullable=False)
    cache_write_price: Mapped[Decimal] = mapped_column(Numeric(12, 6), default=Decimal("0"), nullable=False)

    supports_text: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    supports_vision: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    supports_audio_input: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    supports_audio_output: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    supports_image_generation: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    supports_video_generation: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    supports_tool_calling: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    supports_reasoning: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    supports_embeddings: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    supports_streaming: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    context_window: Mapped[int | None] = mapped_column(nullable=True)
    max_output_tokens: Mapped[int | None] = mapped_column(nullable=True)
    release_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    # Canonical key of the source repository entry this model was imported from
    # (null for hand-entered models). Current values are user overrides; the
    # original repository values are snapshotted in metadata_["repository_snapshot"].
    repository_model_key: Mapped[str | None] = mapped_column(String(255), nullable=True)
    metadata_: Mapped[dict] = mapped_column("metadata", JSONB, default=dict, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    provider: Mapped["Provider"] = relationship(back_populates="models")
    guardrail_assignments: Mapped[list["GuardrailAssignment"]] = relationship(back_populates="model")
    guardrail_triggers: Mapped[list["GuardrailTrigger"]] = relationship(back_populates="model")
