"""versioned branching conversation tree

Revision ID: 38aa765cebc8
Revises: 229b12f96076
Create Date: 2026-11-07

messages.parent_message_id (self-FK, SET NULL) + messages.version_number
(1-based sibling position) and conversations.active_leaf_message_id
(selected node of the active path). Backfills chain existing rows in
(created_at, id) order per conversation via LAG, seeds version 1, and
points each leaf at its newest message.

Downgrade is lossy-by-design for tree structure only (parent links,
versions, leaf pointers are dropped); message and conversation row
data is fully preserved.
"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = '38aa765cebc8'
down_revision: str | None = '229b12f96076'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column('messages', sa.Column('parent_message_id', postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column('messages', sa.Column('version_number', sa.Integer(), nullable=True))
    op.add_column('conversations', sa.Column('active_leaf_message_id', postgresql.UUID(as_uuid=True), nullable=True))

    # Backfill: chain every conversation's rows in canonical
    # (created_at, id) order so parent links mirror the legacy linear view.
    op.execute(sa.text(
        "WITH ordered AS ("
        " SELECT id, LAG(id) OVER ("
        " PARTITION BY conversation_id ORDER BY created_at, id"
        " ) AS prev_id FROM messages"
        ") UPDATE messages m SET parent_message_id = o.prev_id"
        " FROM ordered o WHERE m.id = o.id"
    ))
    op.execute(sa.text("UPDATE messages SET version_number = 1 WHERE version_number IS NULL"))
    op.execute(sa.text(
        "WITH last_msg AS ("
        " SELECT DISTINCT ON (conversation_id) id, conversation_id"
        " FROM messages ORDER BY conversation_id, created_at DESC, id DESC"
        ") UPDATE conversations c SET active_leaf_message_id = l.id"
        " FROM last_msg l WHERE c.id = l.conversation_id"
    ))

    op.alter_column('messages', 'version_number',
                    existing_type=sa.Integer(), nullable=False, server_default='1')

    op.create_foreign_key('fk_messages_parent_message',
                          'messages', 'messages',
                          ['parent_message_id'], ['id'], ondelete='SET NULL')
    op.create_foreign_key('fk_conversations_active_leaf',
                          'conversations', 'messages',
                          ['active_leaf_message_id'], ['id'],
                          ondelete='SET NULL', use_alter=True)
    op.create_check_constraint('ck_messages_version_positive', 'messages',
                               sa.text('version_number >= 1'))
    op.create_check_constraint('ck_messages_no_self_parent', 'messages',
                               sa.text('parent_message_id IS NULL OR parent_message_id != id'))
    op.create_unique_constraint('uq_messages_sibling_version', 'messages',
                                ['conversation_id', 'parent_message_id', 'version_number'])
    op.create_index('ix_messages_parent', 'messages', ['parent_message_id'], unique=False)
    op.create_index('ix_messages_conv_parent', 'messages',
                    ['conversation_id', 'parent_message_id'], unique=False)
    op.create_index('ix_messages_roots', 'messages', ['conversation_id'], unique=False,
                    postgresql_where=sa.text('parent_message_id IS NULL'))
    op.create_index('ix_conversations_active_leaf', 'conversations',
                    ['active_leaf_message_id'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_conversations_active_leaf', table_name='conversations')
    op.drop_index('ix_messages_roots', table_name='messages')
    op.drop_index('ix_messages_conv_parent', table_name='messages')
    op.drop_index('ix_messages_parent', table_name='messages')
    op.drop_constraint('uq_messages_sibling_version', 'messages', type_='unique')
    op.drop_constraint('ck_messages_no_self_parent', 'messages', type_='check')
    op.drop_constraint('ck_messages_version_positive', 'messages', type_='check')
    op.drop_constraint('fk_conversations_active_leaf', 'conversations', type_='foreignkey')
    op.drop_constraint('fk_messages_parent_message', 'messages', type_='foreignkey')
    op.drop_column('conversations', 'active_leaf_message_id')
    op.drop_column('messages', 'version_number')
    op.drop_column('messages', 'parent_message_id')
