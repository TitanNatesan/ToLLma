"""unique provider names (wizard step 1)

Revision ID: c4d8e6a2f5b1
Revises: b7e2d9f4a1c3
Create Date: 2026-09-13

"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = 'c4d8e6a2f5b1'
down_revision: str | None = 'b7e2d9f4a1c3'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Partial index: names are unique among live rows; soft-deleted names stay reusable.
    op.create_index(
        'uq_providers_name_live', 'providers', ['name'], unique=True,
        postgresql_where=sa.text('is_deleted = false'),
    )


def downgrade() -> None:
    op.drop_index('uq_providers_name_live', table_name='providers')
