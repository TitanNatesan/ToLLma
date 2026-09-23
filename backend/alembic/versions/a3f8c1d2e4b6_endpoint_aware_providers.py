"""Endpoint-aware providers: merge OpenAI types, endpoint metadata.

Merges OPENAI_CHAT + OPENAI_RESPONSES into a single OPENAI provider and adds
endpoint metadata to models + model_repository. Endpoint strings live in
TEXT/JSONB so future endpoint kinds need no enum migration.

Revision ID: a3f8c1d2e4b6
Revises: e2f3a4b5c6d7
Create Date: 2026-09-22
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "a3f8c1d2e4b6"
down_revision = "e2f3a4b5c6d7"
branch_labels = None
depends_on = None

NEW_PROVIDER_TYPES = (
    "OPENAI",
    "ANTHROPIC_MESSAGES",
    "GEMINI",
    "VERTEX_AI",
    "BEDROCK_CONVERSE",
    "CUSTOM",
)
OLD_PROVIDER_TYPES = (
    "OPENAI_RESPONSES",
    "OPENAI_CHAT",
    "ANTHROPIC_MESSAGES",
    "GEMINI",
    "VERTEX_AI",
    "BEDROCK_CONVERSE",
    "CUSTOM",
)
NEW_ENDPOINT_TYPES = (
    "RESPONSES",
    "CHAT_COMPLETIONS",
    "MESSAGES",
    "CONVERSE",
    "EMBEDDINGS",
    "IMAGES_GENERATIONS",
    "AUDIO_TRANSCRIPTIONS",
    "AUDIO_SPEECH",
)
OLD_ENDPOINT_TYPES = ("RESPONSES", "CHAT_COMPLETIONS", "MESSAGES", "CONVERSE")

ENDPOINT_BACKFILL = """
UPDATE models SET primary_endpoint = CASE endpoint_type::text
    WHEN 'RESPONSES' THEN 'responses'
    WHEN 'CHAT_COMPLETIONS' THEN 'chat_completions'
    WHEN 'MESSAGES' THEN 'messages'
    WHEN 'CONVERSE' THEN 'converse'
    WHEN 'EMBEDDINGS' THEN 'embeddings'
    WHEN 'IMAGES_GENERATIONS' THEN 'images/generations'
    WHEN 'AUDIO_TRANSCRIPTIONS' THEN 'audio/transcriptions'
    WHEN 'AUDIO_SPEECH' THEN 'audio/speech'
    ELSE 'chat_completions' END
WHERE primary_endpoint IS NULL
"""


def _swap_enum(table: str, column: str, enum_name: str, new_values: tuple[str, ...], using: str) -> None:
    """Recreate a native enum with a new value set (PG cannot drop values)."""
    op.execute(f"ALTER TYPE {enum_name} RENAME TO {enum_name}_old")
    values = ", ".join(f"'{value}'" for value in new_values)
    op.execute(f"CREATE TYPE {enum_name} AS ENUM ({values})")
    op.execute(
        f"ALTER TABLE {table} ALTER COLUMN {column} TYPE {enum_name} USING ({using})::{enum_name}"
    )
    op.execute(f"DROP TYPE {enum_name}_old")


def upgrade() -> None:
    _swap_enum(
        "providers",
        "provider_type",
        "provider_type",
        NEW_PROVIDER_TYPES,
        "CASE WHEN provider_type::text IN ('OPENAI_CHAT','OPENAI_RESPONSES') "
        "THEN 'OPENAI' ELSE provider_type::text END",
    )
    _swap_enum(
        "models",
        "endpoint_type",
        "endpoint_type",
        NEW_ENDPOINT_TYPES,
        "endpoint_type::text",
    )

    op.add_column("models", sa.Column("primary_endpoint", sa.String(length=64), nullable=True))
    op.add_column(
        "models",
        sa.Column(
            "supported_endpoints",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )
    op.add_column(
        "models",
        sa.Column("supports_embeddings", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.execute(ENDPOINT_BACKFILL)
    op.execute("UPDATE models SET supported_endpoints = jsonb_build_array(primary_endpoint)")

    op.add_column("model_repository", sa.Column("primary_endpoint", sa.String(length=64), nullable=True))
    op.add_column(
        "model_repository",
        sa.Column(
            "supported_endpoints",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )
    op.add_column(
        "model_repository",
        sa.Column("supports_chat", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    # Repository rows already store wire-ish endpoint strings.
    op.execute("UPDATE model_repository SET primary_endpoint = endpoint_type WHERE primary_endpoint IS NULL")
    op.execute(
        "UPDATE model_repository SET supported_endpoints = jsonb_build_array(endpoint_type), "
        "supports_chat = (endpoint_type = 'chat_completions')"
    )

    # Match the model metadata (python-side defaults) exactly for alembic check.
    for table, column in (
        ("models", "supported_endpoints"),
        ("models", "supports_embeddings"),
        ("model_repository", "supported_endpoints"),
        ("model_repository", "supports_chat"),
    ):
        op.alter_column(table, column, server_default=None)


def downgrade() -> None:
    op.drop_column("model_repository", "supports_chat")
    op.drop_column("model_repository", "supported_endpoints")
    op.drop_column("model_repository", "primary_endpoint")
    op.drop_column("models", "supports_embeddings")
    op.drop_column("models", "supported_endpoints")
    op.drop_column("models", "primary_endpoint")

    _swap_enum(
        "models",
        "endpoint_type",
        "endpoint_type",
        OLD_ENDPOINT_TYPES,
        "CASE WHEN endpoint_type::text IN ('EMBEDDINGS','IMAGES_GENERATIONS','AUDIO_TRANSCRIPTIONS','AUDIO_SPEECH') "
        "THEN 'CHAT_COMPLETIONS' ELSE endpoint_type::text END",
    )
    _swap_enum(
        "providers",
        "provider_type",
        "provider_type",
        OLD_PROVIDER_TYPES,
        "CASE WHEN provider_type::text = 'OPENAI' THEN 'OPENAI_CHAT' ELSE provider_type::text END",
    )
