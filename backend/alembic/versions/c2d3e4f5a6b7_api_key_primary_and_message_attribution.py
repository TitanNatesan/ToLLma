"""API key primary flag + message key attribution.

Revision ID: c2d3e4f5a6b7
Revises: a8b9c0d1e2f3
Create Date: 2026-10-17

(a) api_keys.is_primary BOOLEAN NOT NULL DEFAULT false with a partial
unique index (one primary per personal user: org_id IS NULL AND
is_primary AND NOT is_deleted). Org keys and non-primary personal keys
are unconstrained.
(b) messages.api_key_id UUID NULL FK api_keys.id ON DELETE SET NULL +
index (attributing key for gateway-originated messages).

No backfill: NULL/false are the correct initial state (existing keys are
non-primary, existing messages are unattributed).
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = 'c2d3e4f5a6b7'
down_revision: str | None = 'a8b9c0d1e2f3'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "api_keys",
        sa.Column("is_primary", sa.Boolean(), server_default="false", nullable=False),
    )
    op.create_index(
        "uq_api_keys_primary_per_user", "api_keys", ["user_id"], unique=True,
        postgresql_where=sa.text(
            "is_deleted = false AND org_id IS NULL AND is_primary = true"
        ),
    )
    op.add_column(
        "messages",
        sa.Column(
            "api_key_id",
            sa.UUID(as_uuid=True),
            sa.ForeignKey("api_keys.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index("ix_messages_api_key", "messages", ["api_key_id"])


def downgrade() -> None:
    op.drop_index("ix_messages_api_key", table_name="messages")
    op.drop_column("messages", "api_key_id")
    op.drop_index("uq_api_keys_primary_per_user", table_name="api_keys")
    op.drop_column("api_keys", "is_primary")
