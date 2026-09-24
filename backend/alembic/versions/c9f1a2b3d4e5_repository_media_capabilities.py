"""Repository capability flags + media rate card.

Revision ID: c9f1a2b3d4e5
Revises: b4c5d6e7f8a9
Create Date: 2026-09-24
"""

from alembic import op
import sqlalchemy as sa

revision = "c9f1a2b3d4e5"
down_revision = "b4c5d6e7f8a9"
branch_labels = None
depends_on = None

_BOOLEAN_FLAGS = (
    "supports_responses",
    "supports_image_generation",
    "supports_image_editing",
    "supports_video_generation",
)

_PRICE_COLUMNS = (
    "image_low_price",
    "image_medium_price",
    "image_high_price",
    "video_price_per_second",
)


def upgrade() -> None:
    for column in _BOOLEAN_FLAGS:
        op.add_column(
            "model_repository",
            sa.Column(column, sa.Boolean(), nullable=False, server_default=sa.false()),
        )
        op.alter_column("model_repository", column, server_default=None)
    for column in _PRICE_COLUMNS:
        op.add_column(
            "model_repository",
            sa.Column(column, sa.Numeric(precision=20, scale=12), nullable=True),
        )


def downgrade() -> None:
    for column in _PRICE_COLUMNS:
        op.drop_column("model_repository", column)
    for column in _BOOLEAN_FLAGS:
        op.drop_column("model_repository", column)
