"""Generation run key attribution.

Revision ID: d3e4f5a6b7c8
Revises: c2d3e4f5a6b7
Create Date: 2026-10-17

generation_runs.api_key_id UUID NULL FK api_keys.id ON DELETE SET NULL +
index (attributing key for keyed generations, mirroring messages.api_key_id).

No backfill: NULL is the correct initial state (existing runs predate
keyed regeneration).
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = 'd3e4f5a6b7c8'
down_revision: str | None = 'c2d3e4f5a6b7'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "generation_runs",
        sa.Column(
            "api_key_id",
            sa.UUID(as_uuid=True),
            sa.ForeignKey("api_keys.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index("ix_generation_runs_api_key", "generation_runs", ["api_key_id"])


def downgrade() -> None:
    op.drop_index("ix_generation_runs_api_key", table_name="generation_runs")
    op.drop_column("generation_runs", "api_key_id")
