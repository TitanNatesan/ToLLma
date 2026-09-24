"""Daily usage aggregates + platform-admin query indexes.

Revision ID: e2b3c4d5e6f7
Revises: d1a2b3c4d5e6
Create Date: 2026-09-24
"""

from alembic import op
import sqlalchemy as sa

revision = "e2b3c4d5e6f7"
down_revision = "d1a2b3c4d5e6"
branch_labels = None
depends_on = None

_AGGREGATE_COLUMNS = (
    ("requests", sa.Integer(), "0"),
    ("failed_requests", sa.Integer(), "0"),
    ("cancelled_requests", sa.Integer(), "0"),
    ("prompt_tokens", sa.BigInteger(), "0"),
    ("completion_tokens", sa.BigInteger(), "0"),
    ("total_tokens", sa.BigInteger(), "0"),
    ("cache_read_tokens", sa.BigInteger(), "0"),
    ("cache_write_tokens", sa.BigInteger(), "0"),
    ("reasoning_tokens", sa.BigInteger(), "0"),
    ("images", sa.Integer(), "0"),
    ("videos", sa.Integer(), "0"),
    ("media_bytes", sa.BigInteger(), "0"),
)


def upgrade() -> None:
    op.create_table(
        "usage_daily_aggregates",
        sa.Column("id", sa.UUID(as_uuid=True), primary_key=True),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("user_id", sa.UUID(as_uuid=True), nullable=True),
        sa.Column("provider_id", sa.UUID(as_uuid=True), nullable=True),
        sa.Column("model_id", sa.UUID(as_uuid=True), nullable=True),
        *[sa.Column(name, type_, nullable=False, server_default=default) for name, type_, default in _AGGREGATE_COLUMNS],
        sa.Column("input_cost", sa.Numeric(20, 12), nullable=False, server_default="0"),
        sa.Column("output_cost", sa.Numeric(20, 12), nullable=False, server_default="0"),
        sa.Column("total_cost", sa.Numeric(20, 12), nullable=False, server_default="0"),
        sa.Column("cache_read_cost", sa.Numeric(20, 12), nullable=False, server_default="0"),
        sa.Column("cache_write_cost", sa.Numeric(20, 12), nullable=False, server_default="0"),
        sa.Column("reasoning_cost", sa.Numeric(20, 12), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("day", "user_id", "provider_id", "model_id", name="uq_usage_daily_scope"),
    )
    op.create_index("ix_usage_daily_day", "usage_daily_aggregates", ["day"])
    op.create_index("ix_usage_daily_user", "usage_daily_aggregates", ["user_id", "day"])
    op.create_index("ix_usage_daily_model", "usage_daily_aggregates", ["model_id", "day"])
    op.create_index("ix_usage_daily_provider", "usage_daily_aggregates", ["provider_id", "day"])

    # Platform-wide aggregations scan by time and group by owner/route; the
    # existing per-user indexes do not serve them.
    op.create_index("ix_messages_created_status", "messages", ["created_at", "status"])
    op.create_index("ix_messages_provider_created", "messages", ["provider_id", "created_at"])
    op.create_index("ix_messages_model_created", "messages", ["model_id", "created_at"])
    op.create_index("ix_request_logs_completed_status", "request_logs", ["request_completed_at", "status"])
    op.create_index("ix_request_logs_error_code", "request_logs", ["error_code"])
    op.create_index("ix_attachments_kind_created", "attachments", ["kind", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_attachments_kind_created", table_name="attachments")
    op.drop_index("ix_request_logs_error_code", table_name="request_logs")
    op.drop_index("ix_request_logs_completed_status", table_name="request_logs")
    op.drop_index("ix_messages_model_created", table_name="messages")
    op.drop_index("ix_messages_provider_created", table_name="messages")
    op.drop_index("ix_messages_created_status", table_name="messages")
    op.drop_index("ix_usage_daily_provider", table_name="usage_daily_aggregates")
    op.drop_index("ix_usage_daily_model", table_name="usage_daily_aggregates")
    op.drop_index("ix_usage_daily_user", table_name="usage_daily_aggregates")
    op.drop_index("ix_usage_daily_day", table_name="usage_daily_aggregates")
    op.drop_table("usage_daily_aggregates")
