"""Conversation per-user newest-first listing index."""

revision: str = "n3o4p5q6r7s8"
down_revision: str | None = "m2n3o4p5q6r7"
branch_labels: str | list[str] | None = None
depends_on: str | list[str] | None = None


def upgrade() -> None:
    from alembic import op

    op.create_index("ix_conversations_user_created", "conversations", ["user_id", "created_at"])


def downgrade() -> None:
    from alembic import op

    op.drop_index("ix_conversations_user_created", table_name="conversations")
