"""Provider catalog (models.dev-sourced, credential-free) + repository catalog link.

Revision ID: c3d4e5f6a7b9
Revises: b2c3d4e5f6a8
Create Date: 2026-10-03
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'c3d4e5f6a7b9'
down_revision: str | None = 'b2c3d4e5f6a8'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        'provider_catalog',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('is_deleted', sa.Boolean(), server_default=sa.text('false'), nullable=False),
        sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('deleted_by', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('slug', sa.String(80), nullable=False),
        sa.Column('name', sa.String(120), nullable=False),
        sa.Column('display_name', sa.String(120), nullable=True),
        sa.Column('logo_url', sa.Text(), nullable=True),
        sa.Column('doc_url', sa.Text(), nullable=True),
        sa.Column('api_base_url', sa.Text(), nullable=True),
        sa.Column('npm_package', sa.String(120), nullable=True),
        sa.Column('env_vars', postgresql.JSONB(astext_type=sa.Text()), nullable=False,
                  server_default=sa.text("'[]'::jsonb")),
        sa.Column('source', sa.String(32), nullable=False, server_default='modelsdev'),
        sa.Column('source_id', sa.String(80), nullable=False),
        sa.Column('gateway_family', sa.String(32), nullable=True),
        sa.Column('gateway_supported', sa.Boolean(), nullable=False, server_default=sa.text('false')),
        sa.Column('capabilities', postgresql.JSONB(astext_type=sa.Text()), nullable=False,
                  server_default=sa.text("'{}'::jsonb")),
        sa.Column('model_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.text('true')),
        sa.Column('extra', postgresql.JSONB(astext_type=sa.Text()), nullable=False,
                  server_default=sa.text("'{}'::jsonb")),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        'uq_provider_catalog_slug_live', 'provider_catalog', ['slug'],
        unique=True, postgresql_where=sa.text('is_deleted = false'),
    )
    op.create_index('uq_provider_catalog_source_id', 'provider_catalog', ['source', 'source_id'], unique=True)
    op.create_index('ix_provider_catalog_gateway', 'provider_catalog', ['gateway_supported'])
    op.create_index('ix_provider_catalog_active', 'provider_catalog', ['is_active'])
    op.add_column('model_repository', sa.Column('catalog_slug', sa.String(80), nullable=True))
    op.create_index('ix_model_repository_catalog', 'model_repository', ['catalog_slug'])


def downgrade() -> None:
    op.drop_index('ix_model_repository_catalog', table_name='model_repository')
    op.drop_column('model_repository', 'catalog_slug')
    for ix in ('ix_provider_catalog_active', 'ix_provider_catalog_gateway',
               'uq_provider_catalog_source_id', 'uq_provider_catalog_slug_live'):
        op.drop_index(ix, table_name='provider_catalog')
    op.drop_table('provider_catalog')
