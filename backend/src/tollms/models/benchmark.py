"""Benchmark runs: point-in-time performance snapshots per workspace.

Aggregate stats only — conditions hold the sampling plan (concurrency,
prompt mix, max tokens, time window), never prompt bodies. Payloads
carrying input_text/output_text keys are rejected at the API layer (422).
"""

import uuid
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, Float, ForeignKey, Index, Integer, Numeric, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from tollms.db.base import TimestampedModel

if TYPE_CHECKING:
    from tollms.models.organization import Organization
    from tollms.models.user import User


class BenchmarkRun(TimestampedModel):
    __tablename__ = "benchmark_runs"
    __table_args__ = (
        CheckConstraint(
            "traffic_path IN ('internal', 'external')",
            name="ck_benchmark_runs_traffic_path",
        ),
        Index("ix_benchmark_runs_org_created", "org_id", "created_at"),
        Index("ix_benchmark_runs_user_created", "user_id", "created_at"),
    )

    # Creator; NULL org_id = personal run. Nullable + SET NULL mirrors
    # prompt logs: deleting a user/org keeps the aggregate row.
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    org_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True
    )
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    traffic_path: Mapped[str] = mapped_column(String(16), nullable=False, default="internal")
    provider_label: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    model_label: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    logging_mode: Mapped[str] = mapped_column(String(32), nullable=False, default="global")
    cache_state: Mapped[str] = mapped_column(String(32), nullable=False, default="mixed")
    # Sampling plan only (concurrency, prompt mix, max_tokens, time window).
    conditions: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    n: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    errors: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    mean_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    p50_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    p95_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    p99_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    ttft_mean_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    ttft_p50_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    prompt_tokens: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    completion_tokens: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    cache_read_tokens: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    cache_write_tokens: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    total_cost: Mapped[Decimal | None] = mapped_column(Numeric(14, 8), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    owner: Mapped["User | None"] = relationship(back_populates="benchmark_runs")
    organization: Mapped["Organization | None"] = relationship(back_populates="benchmark_runs")
