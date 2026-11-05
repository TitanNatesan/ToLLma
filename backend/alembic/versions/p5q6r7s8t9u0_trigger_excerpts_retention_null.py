"""Guardrail trigger excerpts + nullable prompt-log retention.

Adds input_excerpt/output_excerpt (redacted text, never raw) to
guardrail_triggers; retention_days NULL = keep forever (server default 90
kept for new rows); prompt_logs.expires_at nullable (NULL = never expires).

Revision ID: p5q6r7s8t9u0
Revises: o4p5q6r7s8t9
"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = 'p5q6r7s8t9u0'
down_revision: str | None = 'o4p5q6r7s8t9'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column('guardrail_triggers', sa.Column('input_excerpt', sa.Text(), nullable=True))
    op.add_column('guardrail_triggers', sa.Column('output_excerpt', sa.Text(), nullable=True))
    op.alter_column('prompt_logging_settings', 'retention_days',
                    existing_type=sa.Integer(), nullable=True)
    op.alter_column('prompt_logs', 'expires_at',
                    existing_type=sa.DateTime(timezone=True), nullable=True)


def downgrade() -> None:
    op.execute("UPDATE prompt_logs SET expires_at = now() WHERE expires_at IS NULL")
    op.alter_column('prompt_logs', 'expires_at',
                    existing_type=sa.DateTime(timezone=True), nullable=False)
    op.execute("UPDATE prompt_logging_settings SET retention_days = 90 WHERE retention_days IS NULL")
    op.alter_column('prompt_logging_settings', 'retention_days',
                    existing_type=sa.Integer(), nullable=False)
    op.drop_column('guardrail_triggers', 'output_excerpt')
    op.drop_column('guardrail_triggers', 'input_excerpt')
