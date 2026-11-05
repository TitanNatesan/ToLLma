"""Workspace prompt logging: settings, team targets, immutable log ledger."""

revision: str = "j4k5l6m7n8o9"
down_revision: str | None = "i3j4k5l6m7n8"
branch_labels: str | list[str] | None = None
depends_on: str | list[str] | None = None


def upgrade() -> None:
    from alembic import op
    import sqlalchemy as sa
    from sqlalchemy.dialects import postgresql

    op.create_table(
        "prompt_logging_settings",
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("org_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("mode", sa.String(16), nullable=False, server_default="global"),
        sa.Column("capture_input", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("capture_output", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("retention_days", sa.Integer(), nullable=False, server_default="90"),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.CheckConstraint("(user_id IS NULL) != (org_id IS NULL)", name="ck_prompt_logging_settings_owner_scope"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_prompt_logging_settings_user", "prompt_logging_settings", ["user_id"])
    op.create_index("ix_prompt_logging_settings_org", "prompt_logging_settings", ["org_id"])
    op.create_index(
        "uq_prompt_logging_settings_personal_live", "prompt_logging_settings", ["user_id"],
        unique=True, postgresql_where=sa.text("is_deleted = false AND org_id IS NULL"),
    )
    op.create_index(
        "uq_prompt_logging_settings_org_live", "prompt_logging_settings", ["org_id"],
        unique=True, postgresql_where=sa.text("is_deleted = false AND org_id IS NOT NULL"),
    )

    op.create_table(
        "prompt_logging_team_targets",
        sa.Column("setting_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("prompt_logging_settings.id", ondelete="CASCADE"), nullable=False),
        sa.Column("team_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("teams.id", ondelete="CASCADE"), nullable=False),
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("uq_prompt_logging_team_targets", "prompt_logging_team_targets", ["setting_id", "team_id"], unique=True)
    op.create_index("ix_prompt_logging_team_targets_setting", "prompt_logging_team_targets", ["setting_id"])
    op.create_index("ix_prompt_logging_team_targets_team", "prompt_logging_team_targets", ["team_id"])

    op.create_table(
        "prompt_logs",
        sa.Column("workspace_type", sa.String(16), nullable=False, server_default="personal"),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("org_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True),
        sa.Column("api_key_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("api_keys.id", ondelete="SET NULL"), nullable=True),
        sa.Column("key_provenance", sa.String(16), nullable=False, server_default="personal"),
        sa.Column("team_ids", postgresql.JSONB(), nullable=False, server_default="[]"),
        sa.Column("conversation_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("conversations.id", ondelete="SET NULL"), nullable=True),
        sa.Column("provider_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("providers.id", ondelete="SET NULL"), nullable=True),
        sa.Column("model_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("models.id", ondelete="SET NULL"), nullable=True),
        sa.Column("endpoint", sa.String(64), nullable=False, server_default=""),
        sa.Column("source", sa.String(16), nullable=False, server_default="internal"),
        sa.Column("request_id", sa.String(128), nullable=True),
        sa.Column("generation_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("status", sa.String(24), nullable=False, server_default="completed"),
        sa.Column("input_cipher", sa.Text(), nullable=True),
        sa.Column("output_cipher", sa.Text(), nullable=True),
        sa.Column("input_truncated", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("output_truncated", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("input_chars", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("output_chars", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("prompt_tokens", sa.Integer(), nullable=True),
        sa.Column("completion_tokens", sa.Integer(), nullable=True),
        sa.Column("latency_ms", sa.Float(), nullable=True),
        sa.Column("error_code", sa.String(64), nullable=True),
        sa.Column("policy_version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("content_expired", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_prompt_logs_org_created", "prompt_logs", ["org_id", "created_at"])
    op.create_index("ix_prompt_logs_user_created", "prompt_logs", ["user_id", "created_at"])
    op.create_index("ix_prompt_logs_key_created", "prompt_logs", ["api_key_id", "created_at"])
    op.create_index("ix_prompt_logs_request", "prompt_logs", ["request_id"])
    op.create_index("ix_prompt_logs_expires", "prompt_logs", ["expires_at"])
    op.create_index("ix_prompt_logs_status", "prompt_logs", ["status"])
    op.create_index("ix_prompt_logs_created", "prompt_logs", ["created_at"])


def downgrade() -> None:
    from alembic import op

    for table, indexes in [
        ("prompt_logs", ["ix_prompt_logs_org_created", "ix_prompt_logs_user_created",
                         "ix_prompt_logs_key_created", "ix_prompt_logs_request",
                         "ix_prompt_logs_expires", "ix_prompt_logs_status",
                         "ix_prompt_logs_created"]),
        ("prompt_logging_team_targets", ["uq_prompt_logging_team_targets",
                                         "ix_prompt_logging_team_targets_setting",
                                         "ix_prompt_logging_team_targets_team"]),
        ("prompt_logging_settings", ["ix_prompt_logging_settings_user",
                                     "ix_prompt_logging_settings_org",
                                     "uq_prompt_logging_settings_personal_live",
                                     "uq_prompt_logging_settings_org_live"]),
    ]:
        for index in indexes:
            op.drop_index(index, table_name=table)
        op.drop_table(table)
