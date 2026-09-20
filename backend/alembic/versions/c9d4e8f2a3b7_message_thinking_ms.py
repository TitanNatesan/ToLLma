"""message thinking_ms (persisted reasoning duration)

Revision ID: c9d4e8f2a3b7
Revises: a1b2c3d4e5f6
Create Date: 2026-09-20

"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = 'c9d4e8f2a3b7'
down_revision: str | None = 'a1b2c3d4e5f6'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column('messages', sa.Column('thinking_ms', sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column('messages', 'thinking_ms')
