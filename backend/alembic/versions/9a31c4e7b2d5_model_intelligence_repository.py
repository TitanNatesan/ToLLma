"""model intelligence repository

Revision ID: 9a31c4e7b2d5
Revises: 7187f733ecbe
Create Date: 2026-09-13

"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = '9a31c4e7b2d5'
down_revision: str | None = '7187f733ecbe'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        'model_repository',
        sa.Column('model_key', sa.String(length=255), nullable=False),
        sa.Column('canonical_name', sa.String(length=255), nullable=False),
        sa.Column('display_name', sa.String(length=255), nullable=True),
        sa.Column('family', sa.String(length=128), nullable=True),
        sa.Column('provider', sa.String(length=128), nullable=False),
        sa.Column('provider_model_id', sa.String(length=255), nullable=False),
        sa.Column('endpoint_type', sa.String(length=64), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('release_date', sa.Date(), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False),
        sa.Column('is_deprecated', sa.Boolean(), nullable=False),
        sa.Column('last_seen_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('sources', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('supports_text_input', sa.Boolean(), nullable=False),
        sa.Column('supports_text_output', sa.Boolean(), nullable=False),
        sa.Column('supports_vision_input', sa.Boolean(), nullable=False),
        sa.Column('supports_image_output', sa.Boolean(), nullable=False),
        sa.Column('supports_audio_input', sa.Boolean(), nullable=False),
        sa.Column('supports_audio_output', sa.Boolean(), nullable=False),
        sa.Column('supports_video_input', sa.Boolean(), nullable=False),
        sa.Column('supports_video_output', sa.Boolean(), nullable=False),
        sa.Column('supports_reasoning', sa.Boolean(), nullable=False),
        sa.Column('supports_tool_calling', sa.Boolean(), nullable=False),
        sa.Column('supports_structured_output', sa.Boolean(), nullable=False),
        sa.Column('supports_streaming', sa.Boolean(), nullable=False),
        sa.Column('supports_embeddings', sa.Boolean(), nullable=False),
        sa.Column('supports_prompt_caching', sa.Boolean(), nullable=False),
        sa.Column('context_window', sa.Integer(), nullable=True),
        sa.Column('max_input_tokens', sa.Integer(), nullable=True),
        sa.Column('max_output_tokens', sa.Integer(), nullable=True),
        sa.Column('max_images', sa.Integer(), nullable=True),
        sa.Column('max_audio_length', sa.Integer(), nullable=True),
        sa.Column('max_video_length', sa.Integer(), nullable=True),
        sa.Column('input_cost', sa.Numeric(20, 12), nullable=True),
        sa.Column('output_cost', sa.Numeric(20, 12), nullable=True),
        sa.Column('cache_read_cost', sa.Numeric(20, 12), nullable=True),
        sa.Column('cache_write_cost', sa.Numeric(20, 12), nullable=True),
        sa.Column('image_input_cost', sa.Numeric(20, 12), nullable=True),
        sa.Column('audio_input_cost', sa.Numeric(20, 12), nullable=True),
        sa.Column('audio_output_cost', sa.Numeric(20, 12), nullable=True),
        sa.Column('video_input_cost', sa.Numeric(20, 12), nullable=True),
        sa.Column('reasoning_cost', sa.Numeric(20, 12), nullable=True),
        sa.Column('metadata', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('raw_source_payload', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('is_deleted', sa.Boolean(), nullable=False),
        sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('deleted_by', postgresql.UUID(as_uuid=True), nullable=True),
        sa.UniqueConstraint('model_key', name='uq_model_repository_key'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_model_repository_active', 'model_repository', ['is_active'])
    op.create_index('ix_model_repository_created', 'model_repository', ['created_at'])
    op.create_index('ix_model_repository_provider', 'model_repository', ['provider'])
    op.create_table(
        'model_repository_sync_runs',
        sa.Column('started_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('finished_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('status', sa.String(length=16), nullable=False),
        sa.Column('models_created', sa.Integer(), nullable=False),
        sa.Column('models_updated', sa.Integer(), nullable=False),
        sa.Column('models_deactivated', sa.Integer(), nullable=False),
        sa.Column('errors_count', sa.Integer(), nullable=False),
        sa.Column('error_details', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_sync_runs_created', 'model_repository_sync_runs', ['created_at'])
    op.create_index('ix_sync_runs_status', 'model_repository_sync_runs', ['status'])


def downgrade() -> None:
    op.drop_index('ix_sync_runs_status', table_name='model_repository_sync_runs')
    op.drop_index('ix_sync_runs_created', table_name='model_repository_sync_runs')
    op.drop_table('model_repository_sync_runs')
    op.drop_index('ix_model_repository_provider', table_name='model_repository')
    op.drop_index('ix_model_repository_created', table_name='model_repository')
    op.drop_index('ix_model_repository_active', table_name='model_repository')
    op.drop_table('model_repository')
