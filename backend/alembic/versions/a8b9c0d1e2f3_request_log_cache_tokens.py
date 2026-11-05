"""Request-log cache token columns (audit parity with messages).

Revision ID: a8b9c0d1e2f3
Revises: f6a7b8c9d1e2
Create Date: 2026-10-15

Adds nullable cache_read_tokens / cache_write_tokens / reasoning_tokens to
request_logs so in-app generation audits carry the same token detail as
messages (previously only prompt/completion/total were stored while
total_cost already included cache money).

No backfill: historical rows keep NULL (unknown), new rows populate.
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = 'a8b9c0d1e2f3'
down_revision: str | None = 'f6a7b8c9d1e2'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("request_logs", sa.Column("cache_read_tokens", sa.Integer(), nullable=True))
    op.add_column("request_logs", sa.Column("cache_write_tokens", sa.Integer(), nullable=True))
    op.add_column("request_logs", sa.Column("reasoning_tokens", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("request_logs", "reasoning_tokens")
    op.drop_column("request_logs", "cache_write_tokens")
    op.drop_column("request_logs", "cache_read_tokens")
