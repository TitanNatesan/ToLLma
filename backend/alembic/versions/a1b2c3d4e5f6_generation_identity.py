"""generation identity (client_key + active-assistant uniqueness)

Revision ID: a1b2c3d4e5f6
Revises: f3a7c9e1b2d4
Create Date: 2026-09-17

"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = 'a1b2c3d4e5f6'
down_revision: str | None = 'f3a7c9e1b2d4'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Deploy safety: no driver survives a deploy, so anything still marked
    # live is stale — fail it now (the lifespan sweep covers restarts).
    op.execute(
        sa.text(
            "UPDATE messages SET status = 'FAILED', error = COALESCE(error, 'lifecycle reset'), "
            "completed_at = COALESCE(completed_at, now()) "
            "WHERE is_deleted IS FALSE AND status IN ('QUEUED', 'RUNNING')"
        )
    )
    op.add_column('messages', sa.Column('client_key', sa.Text(), nullable=True))
    op.create_index(
        'ix_one_active_assistant', 'messages', ['conversation_id'], unique=True,
        postgresql_where=sa.text(
            "role = 'ASSISTANT' AND status IN ('QUEUED', 'RUNNING') AND is_deleted IS FALSE"
        ),
    )
    op.create_index(
        'ix_messages_client_key', 'messages', ['user_id', 'client_key'], unique=True,
        postgresql_where=sa.text('client_key IS NOT NULL'),
    )


def downgrade() -> None:
    op.drop_index('ix_messages_client_key', table_name='messages')
    op.drop_index('ix_one_active_assistant', table_name='messages')
    op.drop_column('messages', 'client_key')
