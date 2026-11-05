"""Prompt log filter indexes: conversation/provider/model + created_at."""

revision: str = "k5l6m7n8o9p0"
down_revision: str | None = "j4k5l6m7n8o9"
branch_labels: str | list[str] | None = None
depends_on: str | list[str] | None = None


def upgrade() -> None:
    from alembic import op

    op.create_index("ix_prompt_logs_conversation", "prompt_logs", ["conversation_id", "created_at"])
    op.create_index("ix_prompt_logs_provider", "prompt_logs", ["provider_id", "created_at"])
    op.create_index("ix_prompt_logs_model", "prompt_logs", ["model_id", "created_at"])


def downgrade() -> None:
    from alembic import op

    for index in ("ix_prompt_logs_model", "ix_prompt_logs_provider", "ix_prompt_logs_conversation"):
        op.drop_index(index, table_name="prompt_logs")
