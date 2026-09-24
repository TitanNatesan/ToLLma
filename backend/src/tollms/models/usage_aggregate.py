"""Daily usage aggregates for platform analytics (rollup-owned table).

One row per (day, user, provider, model) scope; NULLs collapse into a
platform-wide bucket. Written by `services/admin/rollup.py` with idempotent
upserts, read by the admin dashboard for long ranges. Never stores content —
counts, tokens, costs and media sizes only.
"""

import uuid
from datetime import date
from decimal import Decimal

from sqlalchemy import BigInteger, Date, Index, Integer, Numeric, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from tollms.db.base import Base, TimestampedModel


class UsageDailyAggregate(TimestampedModel):
    __tablename__ = "usage_daily_aggregates"
    __table_args__ = (
        UniqueConstraint("day", "user_id", "provider_id", "model_id", name="uq_usage_daily_scope"),
        Index("ix_usage_daily_day", "day"),
        Index("ix_usage_daily_user", "user_id", "day"),
        Index("ix_usage_daily_model", "model_id", "day"),
        Index("ix_usage_daily_provider", "provider_id", "day"),
    )

    day: Mapped[date] = mapped_column(Date, nullable=False)
    user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    provider_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    model_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)

    requests: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    failed_requests: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    cancelled_requests: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    prompt_tokens: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    completion_tokens: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    total_tokens: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    cache_read_tokens: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    cache_write_tokens: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    reasoning_tokens: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    images: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    videos: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    media_bytes: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)

    input_cost: Mapped[Decimal] = mapped_column(Numeric(20, 12), default=0, nullable=False)
    output_cost: Mapped[Decimal] = mapped_column(Numeric(20, 12), default=0, nullable=False)
    total_cost: Mapped[Decimal] = mapped_column(Numeric(20, 12), default=0, nullable=False)
    cache_read_cost: Mapped[Decimal] = mapped_column(Numeric(20, 12), default=0, nullable=False)
    cache_write_cost: Mapped[Decimal] = mapped_column(Numeric(20, 12), default=0, nullable=False)
    reasoning_cost: Mapped[Decimal] = mapped_column(Numeric(20, 12), default=0, nullable=False)
