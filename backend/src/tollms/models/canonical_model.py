"""Canonical model records from models.json.

One row per canonical entry (keyed by full id, e.g.
``anthropic/claude-haiku-4-5``). No pricing/cost here — cost lives on the
provider-scoped association rows in model_repository. Populated by the
model-repository sync engine from the models.dev catalog; never edited by hand.
"""

from datetime import date
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, Date, Index, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from tollms.db.base import SoftDeleteMixin, TimestampedModel

if TYPE_CHECKING:
    from tollms.models.model_repository import RepositoryModel


class CanonicalModel(SoftDeleteMixin, TimestampedModel):
    __tablename__ = "canonical_model"
    __table_args__ = (
        UniqueConstraint("canonical_id", name="uq_canonical_model_canonical_id"),
        Index("ix_canonical_model_created", "created_at"),
    )

    # Full canonical id, e.g. anthropic/claude-haiku-4-5 (entry id in models.json).
    canonical_id: Mapped[str] = mapped_column(Text, nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    family: Mapped[str | None] = mapped_column(String(128), nullable=True)
    release_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    last_updated: Mapped[date | None] = mapped_column(Date, nullable=True)
    open_weights: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    knowledge: Mapped[str | None] = mapped_column(Text, nullable=True)
    metadata_: Mapped[dict] = mapped_column("metadata", JSONB, default=dict, nullable=False)

    # Provider-scoped association rows linked via
    # model_repository.canonical_id (NULL when unlinked).
    offerings: Mapped[list["RepositoryModel"]] = relationship(back_populates="canonical")
