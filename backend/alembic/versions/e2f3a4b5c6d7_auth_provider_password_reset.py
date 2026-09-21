"""Auth provider identity + single-use password reset tokens

Revision ID: e2f3a4b5c6d7
Revises: d1e2f3a4b5c6
Create Date: 2026-09-21

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "e2f3a4b5c6d7"
down_revision: Union[str, None] = "d1e2f3a4b5c6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- provider identity ------------------------------------------------------
    op.add_column(
        "users",
        sa.Column("provider", sa.String(length=16), nullable=False, server_default="local"),
    )
    op.add_column("users", sa.Column("provider_user_id", sa.String(length=255), nullable=True))
    op.add_column(
        "users",
        sa.Column("has_password", sa.Boolean(), nullable=False, server_default="false"),
    )

    # Backfill from the legacy auth_provider/google_id/password_hash columns.
    op.execute(
        """
        UPDATE users
        SET provider = CASE WHEN auth_provider = 'GOOGLE' THEN 'google' ELSE 'local' END,
            provider_user_id = google_id,
            has_password = (password_hash IS NOT NULL)
        """
    )
    op.create_index("ix_users_provider", "users", ["provider"])
    op.create_index(
        "uq_users_provider_identity",
        "users",
        ["provider", "provider_user_id"],
        unique=True,
        postgresql_where=sa.text("provider_user_id IS NOT NULL AND is_deleted = false"),
    )

    # --- password reset tokens --------------------------------------------------
    op.create_table(
        "password_reset_tokens",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("request_ip", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("token_hash"),
    )
    op.create_index("ix_password_reset_tokens_user_id", "password_reset_tokens", ["user_id"])
    op.create_index("ix_password_reset_user_created", "password_reset_tokens", ["user_id", "created_at"])


def downgrade() -> None:
    op.drop_table("password_reset_tokens")
    op.drop_index("uq_users_provider_identity", table_name="users")
    op.drop_index("ix_users_provider", table_name="users")
    op.drop_column("users", "has_password")
    op.drop_column("users", "provider_user_id")
    op.drop_column("users", "provider")
