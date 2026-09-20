"""analytics + user settings fields

Adds durable analytics dimensions (TTFB, estimated-usage flag, session id),
the composite index analytics scans need, per-user preferences, and an
optional username handle.

Revision ID: b8f1c2d3e4a5
Revises: c9d4e8f2a3b7
Create Date: 2026-09-20 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "b8f1c2d3e4a5"
down_revision: str | None = "c9d4e8f2a3b7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("messages", sa.Column("session_id", sa.String(length=64), nullable=True))
    op.add_column("messages", sa.Column("ttfb_ms", sa.Float(), nullable=True))
    op.add_column(
        "messages",
        sa.Column("usage_estimated", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.create_index(
        "ix_messages_user_role_created", "messages", ["user_id", "role", "created_at"],
        unique=False,
    )
    op.create_index(
        "ix_messages_session_id", "messages", ["session_id"], unique=False,
        postgresql_where=sa.text("session_id IS NOT NULL"),
    )

    op.add_column("users", sa.Column("username", sa.String(length=30), nullable=True))
    op.add_column(
        "users",
        sa.Column(
            "preferences", postgresql.JSONB(astext_type=sa.Text()),
            nullable=False, server_default=sa.text("'{}'::jsonb"),
        ),
    )
    op.create_index(
        "uq_users_username_live", "users", ["username"], unique=True,
        postgresql_where=sa.text("is_deleted = false AND username IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_users_username_live", table_name="users")
    op.drop_column("users", "preferences")
    op.drop_column("users", "username")

    op.drop_index("ix_messages_session_id", table_name="messages")
    op.drop_index("ix_messages_user_role_created", table_name="messages")
    op.drop_column("messages", "usage_estimated")
    op.drop_column("messages", "ttfb_ms")
    op.drop_column("messages", "session_id")
