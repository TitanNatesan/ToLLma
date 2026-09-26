"""AIModel.supports_video_generation for video endpoint validation.

Revision ID: b2c3d4e5f6a7
Revises: f3c4d5e6f7a8
Create Date: 2026-09-26
"""

from alembic import op
import sqlalchemy as sa

revision = "b2c3d4e5f6a7"
down_revision = "f3c4d5e6f7a8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "models",
        sa.Column("supports_video_generation", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.alter_column("models", "supports_video_generation", server_default=None)


def downgrade() -> None:
    op.drop_column("models", "supports_video_generation")
