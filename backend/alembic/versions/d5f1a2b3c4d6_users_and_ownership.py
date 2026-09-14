"""users table + ownership columns (providers, conversations, messages)

Revision ID: d5f1a2b3c4d6
Revises: c4d8e6a2f5b1
Create Date: 2026-09-13

"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'd5f1a2b3c4d6'
down_revision: str | None = 'c4d8e6a2f5b1'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

auth_provider_enum = postgresql.ENUM('EMAIL', 'GOOGLE', name='auth_provider')


def upgrade() -> None:
    # NOTE: no explicit ENUM.create — create_table emits CREATE TYPE once.
    op.create_table(
        'users',
        sa.Column('email', sa.String(length=320), nullable=False),
        sa.Column('password_hash', sa.Text(), nullable=True),
        sa.Column('full_name', sa.String(length=255), nullable=True),
        sa.Column('email_verified', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('auth_provider', auth_provider_enum, nullable=False, server_default='EMAIL'),
        sa.Column('google_id', sa.String(length=255), nullable=True),
        sa.Column('avatar_url', sa.Text(), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('last_login_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('is_deleted', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('deleted_by', postgresql.UUID(as_uuid=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        'uq_users_email_live', 'users', ['email'], unique=True,
        postgresql_where=sa.text('is_deleted = false'),
    )
    op.create_index('uq_users_google_id', 'users', ['google_id'], unique=True)
    op.create_index('ix_users_created', 'users', ['created_at'])

    for table in ('providers', 'conversations', 'messages'):
        op.add_column(table, sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=True))
        op.create_index(f'ix_{table}_user', table, ['user_id'])
        op.create_foreign_key(f'fk_{table}_user', table, 'users', ['user_id'], ['id'])

    # Provider names go from globally unique to per-owner unique (legacy NULL
    # owners never conflict: NULLs are distinct in unique indexes).
    op.drop_index('uq_providers_name_live', table_name='providers')
    op.create_index(
        'uq_providers_name_live', 'providers', ['user_id', 'name'], unique=True,
        postgresql_where=sa.text('is_deleted = false'),
    )


def downgrade() -> None:
    op.drop_index('uq_providers_name_live', table_name='providers')
    op.create_index(
        'uq_providers_name_live', 'providers', ['name'], unique=True,
        postgresql_where=sa.text('is_deleted = false'),
    )
    for table in ('providers', 'conversations', 'messages'):
        op.drop_constraint(f'fk_{table}_user', table, type_='foreignkey')
        op.drop_index(f'ix_{table}_user', table_name=table)
        op.drop_column(table, 'user_id')
    op.drop_index('ix_users_created', table_name='users')
    op.drop_index('uq_users_google_id', table_name='users')
    op.drop_index('uq_users_email_live', table_name='users')
    op.drop_table('users')
    auth_provider_enum.drop(op.get_bind(), checkfirst=True)
