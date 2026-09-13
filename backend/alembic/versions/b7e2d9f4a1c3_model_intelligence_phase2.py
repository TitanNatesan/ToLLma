"""model intelligence phase 2: vendor/docs/pricing cols, source tracking, usage tokens

Revision ID: b7e2d9f4a1c3
Revises: 9a31c4e7b2d5
Create Date: 2026-09-13

"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'b7e2d9f4a1c3'
down_revision: str | None = '9a31c4e7b2d5'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column('model_repository', sa.Column('vendor', sa.String(length=128), nullable=True))
    op.add_column('model_repository', sa.Column('documentation_url', sa.Text(), nullable=True))
    op.add_column('model_repository', sa.Column('image_output_cost', sa.Numeric(20, 12), nullable=True))
    op.add_column('model_repository', sa.Column('video_output_cost', sa.Numeric(20, 12), nullable=True))
    op.create_table(
        'model_repository_sources',
        sa.Column('source_name', sa.String(length=64), nullable=False),
        sa.Column('source_url', sa.Text(), nullable=True),
        sa.Column('source_model_id', sa.String(length=255), nullable=False),
        sa.Column(
            'model_repository_id', postgresql.UUID(as_uuid=True),
            sa.ForeignKey('model_repository.id', ondelete='CASCADE'), nullable=False,
        ),
        sa.Column('source_payload', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.UniqueConstraint('source_name', 'source_model_id', name='uq_repo_sources_name_model'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_repo_sources_repo', 'model_repository_sources', ['model_repository_id'])
    op.create_index('ix_repo_sources_created', 'model_repository_sources', ['created_at'])
    op.add_column('messages', sa.Column('cache_read_tokens', sa.Integer(), nullable=True))
    op.add_column('messages', sa.Column('cache_write_tokens', sa.Integer(), nullable=True))
    op.add_column('messages', sa.Column('reasoning_tokens', sa.Integer(), nullable=True))
    op.add_column('messages', sa.Column('cache_read_cost', sa.Numeric(12, 8), nullable=True))
    op.add_column('messages', sa.Column('cache_write_cost', sa.Numeric(12, 8), nullable=True))
    op.add_column('messages', sa.Column('reasoning_cost', sa.Numeric(12, 8), nullable=True))
    op.add_column('models', sa.Column('repository_model_key', sa.String(length=255), nullable=True))
    op.create_index('ix_models_repo_key', 'models', ['repository_model_key'])


def downgrade() -> None:
    op.drop_index('ix_models_repo_key', table_name='models')
    op.drop_column('models', 'repository_model_key')
    op.drop_column('messages', 'reasoning_cost')
    op.drop_column('messages', 'cache_write_cost')
    op.drop_column('messages', 'cache_read_cost')
    op.drop_column('messages', 'reasoning_tokens')
    op.drop_column('messages', 'cache_write_tokens')
    op.drop_column('messages', 'cache_read_tokens')
    op.drop_index('ix_repo_sources_created', table_name='model_repository_sources')
    op.drop_index('ix_repo_sources_repo', table_name='model_repository_sources')
    op.drop_table('model_repository_sources')
    op.drop_column('model_repository', 'video_output_cost')
    op.drop_column('model_repository', 'image_output_cost')
    op.drop_column('model_repository', 'documentation_url')
    op.drop_column('model_repository', 'vendor')
