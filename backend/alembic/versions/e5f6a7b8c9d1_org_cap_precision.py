"""Widen organizations.max_spend to 6dp (sub-cent caps were rounded to 0.00)."""

import sqlalchemy as sa
from alembic import op

revision = "e5f6a7b8c9d1"
down_revision = "d4e5f6a7b8c0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column(
        "organizations", "max_spend",
        existing_type=sa.Numeric(14, 2), type_=sa.Numeric(14, 6),
        existing_nullable=True,
    )


def downgrade() -> None:
    op.alter_column(
        "organizations", "max_spend",
        existing_type=sa.Numeric(14, 6), type_=sa.Numeric(14, 2),
        existing_nullable=True,
    )
