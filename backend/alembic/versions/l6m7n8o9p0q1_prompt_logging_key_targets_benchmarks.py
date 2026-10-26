"""Prompt logging key targets + match_source; benchmark runs ledger."""

revision: str = "l6m7n8o9p0q1"
down_revision: str | None = "k5l6m7n8o9p0"
branch_labels: str | list[str] | None = None
depends_on: str | list[str] | None = None


def upgrade() -> None:
    from alembic import op
    import sqlalchemy as sa
    from sqlalchemy.dialects import postgresql

    op.create_table(
        "prompt_logging_key_targets",
        sa.Column("setting_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("prompt_logging_settings.id", ondelete="CASCADE"), nullable=False),
        sa.Column("api_key_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("api_keys.id", ondelete="CASCADE"), nullable=False),
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("uq_prompt_logging_key_targets", "prompt_logging_key_targets", ["setting_id", "api_key_id"], unique=True)
    op.create_index("ix_prompt_logging_key_targets_setting", "prompt_logging_key_targets", ["setting_id"])
    op.create_index("ix_prompt_logging_key_targets_key", "prompt_logging_key_targets", ["api_key_id"])

    op.add_column("prompt_logs", sa.Column("match_source", sa.String(16), nullable=True))

    op.create_table(
        "benchmark_runs",
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("org_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True),
        sa.Column("name", sa.String(128), nullable=False),
        sa.Column("traffic_path", sa.String(16), nullable=False, server_default="internal"),
        sa.Column("provider_label", sa.String(128), nullable=False, server_default=""),
        sa.Column("model_label", sa.String(255), nullable=False, server_default=""),
        sa.Column("logging_mode", sa.String(32), nullable=False, server_default="global"),
        sa.Column("cache_state", sa.String(32), nullable=False, server_default="mixed"),
        sa.Column("conditions", postgresql.JSONB(), nullable=False, server_default="{}"),
        sa.Column("n", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("errors", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("mean_ms", sa.Float(), nullable=True),
        sa.Column("p50_ms", sa.Float(), nullable=True),
        sa.Column("p95_ms", sa.Float(), nullable=True),
        sa.Column("p99_ms", sa.Float(), nullable=True),
        sa.Column("ttft_mean_ms", sa.Float(), nullable=True),
        sa.Column("ttft_p50_ms", sa.Float(), nullable=True),
        sa.Column("prompt_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("completion_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("cache_read_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("cache_write_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("total_cost", sa.Numeric(14, 8), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("traffic_path IN ('internal', 'external')", name="ck_benchmark_runs_traffic_path"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_benchmark_runs_org_created", "benchmark_runs", ["org_id", "created_at"])
    op.create_index("ix_benchmark_runs_user_created", "benchmark_runs", ["user_id", "created_at"])


def downgrade() -> None:
    from alembic import op

    op.drop_index("ix_benchmark_runs_user_created", table_name="benchmark_runs")
    op.drop_index("ix_benchmark_runs_org_created", table_name="benchmark_runs")
    op.drop_table("benchmark_runs")
    op.drop_column("prompt_logs", "match_source")
    for index in ("uq_prompt_logging_key_targets",
                  "ix_prompt_logging_key_targets_setting",
                  "ix_prompt_logging_key_targets_key"):
        op.drop_index(index, table_name="prompt_logging_key_targets")
    op.drop_table("prompt_logging_key_targets")
