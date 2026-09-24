"""Platform admin aggregates: daily usage rollups + admin query indexes.

Revision ID: d1a2b3c4d5e6
Revises: c9f1a2b3d4e5
Create Date: 2026-09-24
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "d1a2b3c4d5e6"
down_revision = "c9f1a2b3d4e5"
branch_labels = None
depends_on = None

PLATFORM_ROLE = sa.Enum("USER", "PLATFORM_ADMIN", name="platform_role")


def upgrade() -> None:
    PLATFORM_ROLE.create(op.get_bind(), checkfirst=True)
    op.add_column(
        "users",
        sa.Column("platform_role", PLATFORM_ROLE, nullable=False, server_default="USER"),
    )
    op.create_index("ix_users_platform_role", "users", ["platform_role"])


def downgrade() -> None:
    op.drop_index("ix_users_platform_role", table_name="users")
    op.drop_column("users", "platform_role")
    PLATFORM_ROLE.drop(op.get_bind(), checkfirst=True)
