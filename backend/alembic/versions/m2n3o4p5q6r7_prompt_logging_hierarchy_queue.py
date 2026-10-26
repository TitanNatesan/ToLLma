"""Prompt logging hierarchy + queue idempotency: team enabled flag, key overrides, request_id uniqueness."""

revision: str = "m2n3o4p5q6r7"
down_revision: str | None = "l6m7n8o9p0q1"
branch_labels: str | list[str] | None = None
depends_on: str | list[str] | None = None


def upgrade() -> None:
    from alembic import op
    import sqlalchemy as sa
    from sqlalchemy.dialects import postgresql

    op.add_column(
        "prompt_logging_team_targets",
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default="true"),
    )

    op.create_table(
        "prompt_logging_key_overrides",
        sa.Column("setting_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("prompt_logging_settings.id", ondelete="CASCADE"), nullable=False),
        sa.Column("api_key_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("api_keys.id", ondelete="CASCADE"), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=True),
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("uq_prompt_logging_key_overrides", "prompt_logging_key_overrides", ["setting_id", "api_key_id"], unique=True)
    op.create_index("ix_prompt_logging_key_overrides_setting", "prompt_logging_key_overrides", ["setting_id"])
    op.create_index("ix_prompt_logging_key_overrides_key", "prompt_logging_key_overrides", ["api_key_id"])

    # Composite (request_id, generation_id): internal chat reuses one
    # request_id per conversation, so request_id alone is not unique.
    op.create_index(
        "uq_prompt_logs_request_delivery", "prompt_logs", ["request_id", "generation_id"],
        unique=True, postgresql_where=sa.text("request_id IS NOT NULL"),
    )


def downgrade() -> None:
    from alembic import op

    op.drop_index("uq_prompt_logs_request_delivery", table_name="prompt_logs")
    for index in ("uq_prompt_logging_key_overrides",
                  "ix_prompt_logging_key_overrides_setting",
                  "ix_prompt_logging_key_overrides_key"):
        op.drop_index(index, table_name="prompt_logging_key_overrides")
    op.drop_table("prompt_logging_key_overrides")
    op.drop_column("prompt_logging_team_targets", "enabled")
