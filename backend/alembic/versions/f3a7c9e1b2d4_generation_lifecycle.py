"""message generation lifecycle (status/started_at/completed_at/error)

Revision ID: f3a7c9e1b2d4
Revises: e8a4c1d2f7b9
Create Date: 2026-09-17

"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'f3a7c9e1b2d4'
down_revision: str | None = 'e8a4c1d2f7b9'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

STATUS_ENUM = postgresql.ENUM(
    'QUEUED', 'RUNNING', 'COMPLETED', 'CANCELLED', 'FAILED',
    name='message_status',
)


def upgrade() -> None:
    STATUS_ENUM.create(op.get_bind(), checkfirst=True)
    op.add_column('messages', sa.Column('status', STATUS_ENUM, nullable=False, server_default='COMPLETED'))
    op.add_column('messages', sa.Column('started_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('messages', sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('messages', sa.Column('error', sa.Text(), nullable=True))
    op.create_index('ix_messages_status', 'messages', ['status'])


def downgrade() -> None:
    op.drop_index('ix_messages_status', table_name='messages')
    op.drop_column('messages', 'error')
    op.drop_column('messages', 'completed_at')
    op.drop_column('messages', 'started_at')
    op.drop_column('messages', 'status')
    STATUS_ENUM.drop(op.get_bind(), checkfirst=True)
