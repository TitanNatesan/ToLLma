"""Conversation intelligence: request logs, history, branching, search, sharing, exports

Revision ID: d1e2f3a4b5c6
Revises: b8f1c2d3e4a5
Create Date: 2026-09-21

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "d1e2f3a4b5c6"
down_revision: Union[str, None] = "b8f1c2d3e4a5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- structured error taxonomy on messages ---------------------------------
    op.add_column("messages", sa.Column("error_code", sa.String(length=48), nullable=True))

    # --- conversation branching -------------------------------------------------
    op.add_column(
        "conversations", sa.Column("parent_conversation_id", postgresql.UUID(as_uuid=True), nullable=True)
    )
    op.add_column(
        "conversations", sa.Column("branch_from_message_id", postgresql.UUID(as_uuid=True), nullable=True)
    )
    op.add_column("conversations", sa.Column("branch_name", sa.String(length=120), nullable=True))
    op.create_foreign_key(
        "fk_conversations_parent",
        "conversations",
        "conversations",
        ["parent_conversation_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_conversations_branch_message",
        "conversations",
        "messages",
        ["branch_from_message_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_conversations_parent_conversation_id", "conversations", ["parent_conversation_id"])

    # --- request logs -----------------------------------------------------------
    op.create_table(
        "request_logs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("conversation_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("message_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("provider_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("model_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("request_started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("request_completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("latency_ms", sa.Float(), nullable=True),
        sa.Column("prompt_tokens", sa.Integer(), nullable=True),
        sa.Column("completion_tokens", sa.Integer(), nullable=True),
        sa.Column("total_tokens", sa.Integer(), nullable=True),
        sa.Column("input_cost", sa.Numeric(12, 8), nullable=True),
        sa.Column("output_cost", sa.Numeric(12, 8), nullable=True),
        sa.Column("total_cost", sa.Numeric(12, 8), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="success"),
        sa.Column("error_code", sa.String(length=48), nullable=True),
        sa.Column("is_regeneration", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("is_streaming", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["conversation_id"], ["conversations.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["message_id"], ["messages.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["provider_id"], ["providers.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["model_id"], ["models.id"], ondelete="SET NULL"),
    )
    op.create_index("ix_request_logs_user_id", "request_logs", ["user_id"])
    op.create_index("ix_request_logs_conversation_id", "request_logs", ["conversation_id"])
    op.create_index("ix_request_logs_message_id", "request_logs", ["message_id"])
    op.create_index("ix_request_logs_provider_id", "request_logs", ["provider_id"])
    op.create_index("ix_request_logs_model_id", "request_logs", ["model_id"])
    op.create_index("ix_request_logs_status", "request_logs", ["status"])
    op.create_index("ix_request_logs_user_created", "request_logs", ["user_id", "created_at"])
    op.create_index("ix_request_logs_conversation", "request_logs", ["conversation_id", "created_at"])

    # --- export events ----------------------------------------------------------
    op.create_table(
        "export_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("dataset", sa.String(length=48), nullable=False),
        sa.Column("format", sa.String(length=16), nullable=False),
        sa.Column("item_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("detail", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
    )
    op.create_index("ix_export_events_user_id", "export_events", ["user_id"])
    op.create_index("ix_export_events_user_created", "export_events", ["user_id", "created_at"])

    # --- message versions -------------------------------------------------------
    op.create_table(
        "message_versions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("message_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("version_number", sa.Integer(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False, server_default=""),
        sa.Column("edited_by", sa.String(length=16), nullable=False, server_default="user"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["message_id"], ["messages.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("message_id", "version_number", name="uq_message_versions_message_number"),
    )
    op.create_index("ix_message_versions_message_id", "message_versions", ["message_id"])
    op.create_index("ix_message_versions_user_id", "message_versions", ["user_id"])

    # --- generation runs --------------------------------------------------------
    op.create_table(
        "generation_runs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("message_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("generation_number", sa.Integer(), nullable=False),
        sa.Column("provider_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("model_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("content", sa.Text(), nullable=False, server_default=""),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="running"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("prompt_tokens", sa.Integer(), nullable=True),
        sa.Column("completion_tokens", sa.Integer(), nullable=True),
        sa.Column("total_tokens", sa.Integer(), nullable=True),
        sa.Column("total_cost", sa.Numeric(12, 8), nullable=True),
        sa.Column("latency_ms", sa.Numeric(12, 3), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["message_id"], ["messages.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["provider_id"], ["providers.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["model_id"], ["models.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("message_id", "generation_number", name="uq_generation_runs_message_number"),
    )
    op.create_index("ix_generation_runs_message_id", "generation_runs", ["message_id"])
    op.create_index("ix_generation_runs_user_id", "generation_runs", ["user_id"])
    op.create_index("ix_generation_runs_message_active", "generation_runs", ["message_id", "is_active"])

    # --- conversation shares ----------------------------------------------------
    op.create_table(
        "conversation_shares",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("conversation_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("share_token", sa.String(length=64), nullable=False),
        sa.Column("is_public", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("view_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["conversation_id"], ["conversations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("share_token"),
    )
    op.create_index("ix_conversation_shares_conversation_id", "conversation_shares", ["conversation_id"])
    op.create_index("ix_conversation_shares_user_id", "conversation_shares", ["user_id"])
    op.create_index(
        "ix_conversation_shares_conversation_public", "conversation_shares", ["conversation_id", "is_public"]
    )

    # --- full-text search index -------------------------------------------------
    op.create_table(
        "conversation_search_index",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("conversation_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("message_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("kind", sa.String(length=16), nullable=False, server_default="message"),
        sa.Column("title", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("content", sa.Text(), nullable=False, server_default=""),
        sa.Column("provider_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("model_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("provider_name", sa.String(length=255), nullable=True),
        sa.Column("model_name", sa.String(length=255), nullable=True),
        sa.Column("role", sa.String(length=16), nullable=True),
        sa.Column(
            "tsv",
            postgresql.TSVECTOR(),
            sa.Computed(
                "to_tsvector('english', coalesce(title, '') || ' ' || coalesce(content, ''))",
                persisted=True,
            ),
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["conversation_id"], ["conversations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["message_id"], ["messages.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_conversation_search_index_user_id", "conversation_search_index", ["user_id"])
    op.create_index(
        "ix_conversation_search_index_conversation_id", "conversation_search_index", ["conversation_id"]
    )
    op.create_index("ix_conversation_search_index_message_id", "conversation_search_index", ["message_id"])
    op.create_index("ix_conversation_search_index_provider_id", "conversation_search_index", ["provider_id"])
    op.create_index("ix_conversation_search_index_model_id", "conversation_search_index", ["model_id"])
    op.create_index(
        "ix_conversation_search_tsv", "conversation_search_index", ["tsv"], postgresql_using="gin"
    )
    op.create_index(
        "ix_conversation_search_user_conversation", "conversation_search_index", ["user_id", "conversation_id"]
    )

    # --- backfill ---------------------------------------------------------------
    # Search documents for every live conversation + message.
    op.execute(
        """
        INSERT INTO conversation_search_index
            (id, user_id, conversation_id, message_id, kind, title, content,
             provider_id, model_id, provider_name, model_name, role, created_at, updated_at)
        SELECT gen_random_uuid(), c.user_id, c.id, NULL, 'conversation', c.title, '',
               c.provider_id, c.model_id, NULL, NULL, NULL,
               c.created_at, now()
        FROM conversations c
        WHERE c.is_deleted IS FALSE
        """
    )
    op.execute(
        """
        INSERT INTO conversation_search_index
            (id, user_id, conversation_id, message_id, kind, title, content,
             provider_id, model_id, provider_name, model_name, role, created_at, updated_at)
        SELECT gen_random_uuid(), m.user_id, m.conversation_id, m.id, 'message', '', m.content,
               m.provider_id, m.model_id, p.name, am.name, lower(m.role::text), m.created_at, now()
        FROM messages m
        LEFT JOIN providers p ON p.id = m.provider_id
        LEFT JOIN models am ON am.id = m.model_id
        WHERE m.is_deleted IS FALSE AND m.content <> ''
        """
    )
    # Generation run #1 for every existing assistant message with content.
    op.execute(
        """
        INSERT INTO generation_runs
            (id, message_id, user_id, generation_number, provider_id, model_id, content, status,
             is_active, prompt_tokens, completion_tokens, total_tokens, total_cost, latency_ms,
             created_at, updated_at)
        SELECT gen_random_uuid(), m.id, m.user_id, 1, m.provider_id, m.model_id, m.content,
               CASE WHEN m.status = 'COMPLETED' THEN 'completed' ELSE lower(m.status::text) END,
               TRUE, m.prompt_tokens, m.completion_tokens, m.total_tokens, m.total_cost, m.latency_ms,
               m.created_at, now()
        FROM messages m
        WHERE m.role = 'ASSISTANT' AND m.is_deleted IS FALSE AND m.content <> ''
        """
    )


def downgrade() -> None:
    op.drop_table("conversation_search_index")
    op.drop_table("conversation_shares")
    op.drop_table("generation_runs")
    op.drop_table("message_versions")
    op.drop_table("export_events")
    op.drop_table("request_logs")
    op.drop_index("ix_conversations_parent_conversation_id", table_name="conversations")
    op.drop_constraint("fk_conversations_branch_message", "conversations", type_="foreignkey")
    op.drop_constraint("fk_conversations_parent", "conversations", type_="foreignkey")
    op.drop_column("conversations", "branch_name")
    op.drop_column("conversations", "branch_from_message_id")
    op.drop_column("conversations", "parent_conversation_id")
    op.drop_column("messages", "error_code")
