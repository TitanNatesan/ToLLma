"""Personal default API key flag.

Revision ID: d6e7f8a9b0c1
Revises: f2a3b4c5d6e7
Create Date: 2026-10-19

Adds api_keys.is_default BOOLEAN NOT NULL DEFAULT false with a partial
unique index (one default per personal user: org_id IS NULL AND
is_default AND NOT is_deleted) mirroring uq_api_keys_primary_per_user.

Backfill picks exactly one row per personal user — the primary when one
exists, else the most-recent live key — so the new partial unique index
builds with no duplicates. Org keys never participate.
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = 'd6e7f8a9b0c1'
down_revision: str | None = 'f2a3b4c5d6e7'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "api_keys",
        sa.Column("is_default", sa.Boolean(), server_default="false", nullable=False),
    )
    op.execute(
        sa.text(
            "UPDATE api_keys k SET is_default = true FROM ("
            "SELECT DISTINCT ON (user_id) id FROM api_keys "
            "WHERE is_deleted = false AND org_id IS NULL "
            "ORDER BY user_id, is_primary DESC, created_at DESC"
            ") t WHERE k.id = t.id"
        )
    )
    op.create_index(
        "uq_api_keys_default_per_user", "api_keys", ["user_id"], unique=True,
        postgresql_where=sa.text(
            "is_deleted = false AND org_id IS NULL AND is_default = true"
        ),
    )


def downgrade() -> None:
    op.drop_index("uq_api_keys_default_per_user", table_name="api_keys")
    op.drop_column("api_keys", "is_default")
