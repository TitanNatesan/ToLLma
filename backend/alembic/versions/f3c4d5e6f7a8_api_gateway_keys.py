"""API gateway keys, policies, IP rules, model access and request logs.

Revision ID: f3c4d5e6f7a8
Revises: e2b3c4d5e6f7
Create Date: 2026-09-25
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "f3c4d5e6f7a8"
down_revision = "e2b3c4d5e6f7"
branch_labels = None
depends_on = None

def upgrade() -> None:
    op.create_table(
        "api_keys",
        sa.Column("id", sa.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", sa.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("key_prefix", sa.String(32), nullable=False),
        sa.Column("key_hash", sa.String(64), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("rotation_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("parent_key_id", sa.UUID(as_uuid=True), sa.ForeignKey("api_keys.id", ondelete="SET NULL"), nullable=True),
        sa.Column("routing_strategy", sa.String(32), nullable=True),
        sa.Column("metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("key_prefix", name="uq_api_keys_prefix"),
        sa.UniqueConstraint("key_hash", name="uq_api_keys_hash"),
    )
    op.create_index("ix_api_keys_user", "api_keys", ["user_id"])
    op.create_index("ix_api_keys_created", "api_keys", ["created_at"])
    op.create_index("ix_api_keys_enabled", "api_keys", ["enabled"])
    op.create_index("ix_api_keys_parent", "api_keys", ["parent_key_id"])

    op.create_table(
        "api_key_policies",
        sa.Column("id", sa.UUID(as_uuid=True), primary_key=True),
        sa.Column("api_key_id", sa.UUID(as_uuid=True), sa.ForeignKey("api_keys.id", ondelete="CASCADE"), nullable=False),
        sa.Column("max_budget_usd", sa.Numeric(14, 6), nullable=True),
        sa.Column("budget_reset_days", sa.Integer(), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("rpm", sa.Integer(), nullable=True),
        sa.Column("rph", sa.Integer(), nullable=True),
        sa.Column("rpd", sa.Integer(), nullable=True),
        sa.Column("tpm", sa.Integer(), nullable=True),
        sa.Column("tpd", sa.Integer(), nullable=True),
        sa.Column("daily_spend_limit", sa.Numeric(14, 6), nullable=True),
        sa.Column("monthly_spend_limit", sa.Numeric(14, 6), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("api_key_id", name="uq_api_key_policies_key"),
    )

    op.create_table(
        "api_key_ip_rules",
        sa.Column("id", sa.UUID(as_uuid=True), primary_key=True),
        sa.Column("api_key_id", sa.UUID(as_uuid=True), sa.ForeignKey("api_keys.id", ondelete="CASCADE"), nullable=False),
        sa.Column("type", sa.Enum("ALLOW", "DENY", name="api_key_ip_rule_type"), nullable=False),
        sa.Column("cidr", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("api_key_id", "type", "cidr", name="uq_api_key_ip_rule"),
    )
    op.create_index("ix_api_key_ip_rules_key", "api_key_ip_rules", ["api_key_id"])

    op.create_table(
        "api_key_model_permissions",
        sa.Column("id", sa.UUID(as_uuid=True), primary_key=True),
        sa.Column("api_key_id", sa.UUID(as_uuid=True), sa.ForeignKey("api_keys.id", ondelete="CASCADE"), nullable=False),
        sa.Column("provider_id", sa.UUID(as_uuid=True), sa.ForeignKey("providers.id", ondelete="CASCADE"), nullable=True),
        sa.Column("model_id", sa.UUID(as_uuid=True), sa.ForeignKey("models.id", ondelete="CASCADE"), nullable=True),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("max_budget", sa.Numeric(14, 6), nullable=True),
        sa.Column("rpm", sa.Integer(), nullable=True),
        sa.Column("tpm", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("api_key_id", "provider_id", "model_id", name="uq_api_key_model_scope"),
    )
    op.create_index("ix_api_key_model_perms_key", "api_key_model_permissions", ["api_key_id"])
    op.create_index("ix_api_key_model_perms_model", "api_key_model_permissions", ["model_id"])

    op.create_table(
        "api_request_logs",
        sa.Column("id", sa.UUID(as_uuid=True), primary_key=True),
        sa.Column("request_id", sa.String(64), nullable=False),
        sa.Column("api_key_id", sa.UUID(as_uuid=True), sa.ForeignKey("api_keys.id", ondelete="SET NULL"), nullable=True),
        sa.Column("user_id", sa.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("provider", sa.String(128), nullable=True),
        sa.Column("model", sa.String(255), nullable=True),
        sa.Column("endpoint", sa.String(64), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="success"),
        sa.Column("error_code", sa.String(48), nullable=True),
        sa.Column("latency_ms", sa.Float(), nullable=True),
        sa.Column("cost", sa.Numeric(14, 8), nullable=True),
        sa.Column("input_tokens", sa.Integer(), nullable=True),
        sa.Column("output_tokens", sa.Integer(), nullable=True),
        sa.Column("cache_read_tokens", sa.Integer(), nullable=True),
        sa.Column("cache_write_tokens", sa.Integer(), nullable=True),
        sa.Column("reasoning_tokens", sa.Integer(), nullable=True),
        sa.Column("total_tokens", sa.Integer(), nullable=True),
        sa.Column("ip_address", sa.String(64), nullable=True),
        sa.Column("user_agent", sa.Text(), nullable=True),
        sa.Column("device_type", sa.String(32), nullable=True),
        sa.Column("platform", sa.String(32), nullable=True),
        sa.Column("browser", sa.String(32), nullable=True),
        sa.Column("country", sa.String(64), nullable=True),
        sa.Column("city", sa.String(128), nullable=True),
        sa.Column("region", sa.String(128), nullable=True),
        sa.Column("is_streaming", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_api_request_logs_key_created", "api_request_logs", ["api_key_id", "created_at"])
    op.create_index("ix_api_request_logs_user_created", "api_request_logs", ["user_id", "created_at"])
    op.create_index("ix_api_request_logs_created", "api_request_logs", ["created_at"])
    op.create_index("ix_api_request_logs_model_created", "api_request_logs", ["model", "created_at"])
    op.create_index("ix_api_request_logs_endpoint", "api_request_logs", ["endpoint"])
    op.create_index("ix_api_request_logs_country", "api_request_logs", ["country"])
    op.create_index("ix_api_request_logs_request_id", "api_request_logs", ["request_id"])


def downgrade() -> None:
    op.drop_table("api_request_logs")
    op.drop_table("api_key_model_permissions")
    op.drop_table("api_key_ip_rules")
    op.drop_table("api_key_policies")
    op.drop_table("api_keys")
    op.execute("DROP TYPE IF EXISTS api_key_ip_rule_type")
