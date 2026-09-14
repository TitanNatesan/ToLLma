"""attachments table (chat file uploads)

Revision ID: e8a4c1d2f7b9
Revises: d5f1a2b3c4d6
Create Date: 2026-09-14

"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'e8a4c1d2f7b9'
down_revision: str | None = 'd5f1a2b3c4d6'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        'attachments',
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('conversation_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('message_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('filename', sa.String(length=255), nullable=False),
        sa.Column('mime_type', sa.String(length=127), nullable=False),
        sa.Column('kind', sa.String(length=16), nullable=False, server_default='document'),
        sa.Column('file_size', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('storage_path', sa.Text(), nullable=False),
        sa.Column('extracted_text', sa.Text(), nullable=True),
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('is_deleted', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('deleted_by', postgresql.UUID(as_uuid=True), nullable=True),
        sa.ForeignKeyConstraint(['conversation_id'], ['conversations.id'], name='fk_attachments_conversation', ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['message_id'], ['messages.id'], name='fk_attachments_message', ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], name='fk_attachments_user'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_attachments_user', 'attachments', ['user_id'])
    op.create_index('ix_attachments_conversation', 'attachments', ['conversation_id'])
    op.create_index('ix_attachments_message', 'attachments', ['message_id'])
    op.create_index('ix_attachments_created', 'attachments', ['created_at'])


def downgrade() -> None:
    op.drop_index('ix_attachments_created', table_name='attachments')
    op.drop_index('ix_attachments_message', table_name='attachments')
    op.drop_index('ix_attachments_conversation', table_name='attachments')
    op.drop_index('ix_attachments_user', table_name='attachments')
    op.drop_table('attachments')
