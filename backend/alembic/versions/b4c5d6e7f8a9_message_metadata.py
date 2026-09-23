"""Message metadata: generation details for media messages.

Revision ID: b4c5d6e7f8a9
Revises: a3f8c1d2e4b6
Create Date: 2026-09-23
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "b4c5d6e7f8a9"
down_revision = "a3f8c1d2e4b6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "messages",
        sa.Column(
            "metadata",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
    )
    op.alter_column("messages", "metadata", server_default=None)


def downgrade() -> None:
    op.drop_column("messages", "metadata")
