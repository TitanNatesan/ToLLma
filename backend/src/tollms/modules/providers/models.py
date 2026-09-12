"""Provider registry table."""

import enum
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, Enum, Index, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from tollms.db.base import Base, SoftDeleteMixin, TimestampedModel

if TYPE_CHECKING:
    from tollms.modules.models.models import AIModel


class ProviderType(str, enum.Enum):
    OPENAI_RESPONSES = "OPENAI_RESPONSES"
    OPENAI_CHAT = "OPENAI_CHAT"
    ANTHROPIC_MESSAGES = "ANTHROPIC_MESSAGES"
    GEMINI = "GEMINI"
    VERTEX_AI = "VERTEX_AI"
    BEDROCK_CONVERSE = "BEDROCK_CONVERSE"
    CUSTOM = "CUSTOM"


class Provider(SoftDeleteMixin, TimestampedModel):
    __tablename__ = "providers"
    __table_args__ = (
        Index("ix_providers_type", "provider_type"),
        Index("ix_providers_active", "is_active"),
        Index("ix_providers_created", "created_at"),
    )

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    provider_type: Mapped[ProviderType] = mapped_column(Enum(ProviderType, name="provider_type"), nullable=False)
    credentials_encrypted: Mapped[str] = mapped_column(Text, nullable=False)
    metadata_: Mapped[dict] = mapped_column("metadata", JSONB, default=dict, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    models: Mapped[list["AIModel"]] = relationship(back_populates="provider")
