"""Normalized Models.dev catalog: canonical_model + repository links.

Revision ID: f2a3b4c5d6e7
Revises: e4f5a6b7c8d9

Additive only. No data backfill: the next sync populates canonical_model
from models.json and links model_repository.canonical_id (NULL when the
upstream record has no canonical_model_id or it resolves nowhere).
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'f2a3b4c5d6e7'
down_revision: str | None = 'e4f5a6b7c8d9'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        'canonical_model',
        sa.Column('canonical_id', sa.Text(), nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('family', sa.String(length=128), nullable=True),
        sa.Column('release_date', sa.Date(), nullable=True),
        sa.Column('last_updated', sa.Date(), nullable=True),
        sa.Column('open_weights', sa.Boolean(), nullable=True),
        sa.Column('knowledge', sa.Text(), nullable=True),
        sa.Column('metadata', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('is_deleted', sa.Boolean(), nullable=False),
        sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('deleted_by', postgresql.UUID(as_uuid=True), nullable=True),
        sa.UniqueConstraint('canonical_id', name='uq_canonical_model_canonical_id'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_canonical_model_created', 'canonical_model', ['created_at'])
    op.add_column(
        'model_repository',
        sa.Column(
            'canonical_id', sa.Text(),
            sa.ForeignKey('canonical_model.canonical_id', ondelete='SET NULL'),
            nullable=True,
        ),
    )
    op.add_column('model_repository', sa.Column('reasoning_options', postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.add_column('model_repository', sa.Column('extra_cost', postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.create_index('ix_model_repository_canonical_id', 'model_repository', ['canonical_id'])


def downgrade() -> None:
    op.drop_index('ix_model_repository_canonical_id', table_name='model_repository')
    op.drop_column('model_repository', 'extra_cost')
    op.drop_column('model_repository', 'reasoning_options')
    try:
        op.drop_constraint('model_repository_canonical_id_fkey', 'model_repository', type_='foreignkey')
    except Exception:
        pass
    op.drop_column('model_repository', 'canonical_id')
    op.drop_index('ix_canonical_model_created', table_name='canonical_model')
    op.drop_table('canonical_model')
