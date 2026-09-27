"""Account deletion core: users deletion columns + purge_audit_log table.

Revision ID: e7f8a9b0c1d2
Revises: d9e0f1a2b3c4
Create Date: 2026-09-27

A delete-request stamps users.deletion_requested_at and schedules the hard
purge 15 days out (users.deletion_scheduled_for); deletion_notice_stage
tracks reminder progress. purge_audit_log keeps one forensics row per
purged account (deleted_user_id carries NO fk — the user row is gone).
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'e7f8a9b0c1d2'
down_revision: str | None = 'd9e0f1a2b3c4'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("deletion_requested_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "users",
        sa.Column("deletion_scheduled_for", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "users",
        sa.Column("deletion_notice_stage", sa.SmallInteger(), nullable=False, server_default="0"),
    )
    op.create_table(
        'purge_audit_log',
        sa.Column('deleted_user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('purged_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            'counts', postgresql.JSONB(astext_type=sa.Text()),
            nullable=False, server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column('result', sa.Text(), nullable=False),
        sa.Column('error', sa.Text(), nullable=True),
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_purge_audit_log_deleted_user', 'purge_audit_log', ['deleted_user_id'])


def downgrade() -> None:
    op.drop_index('ix_purge_audit_log_deleted_user', table_name='purge_audit_log')
    op.drop_table('purge_audit_log')
    op.drop_column("users", "deletion_notice_stage")
    op.drop_column("users", "deletion_scheduled_for")
    op.drop_column("users", "deletion_requested_at")
