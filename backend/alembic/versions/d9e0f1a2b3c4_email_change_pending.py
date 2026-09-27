"""Email-change hardening: staged users.pending_email + requested_at.

Revision ID: d9e0f1a2b3c4
Revises: b2c3d4e5f6a7
Create Date: 2026-09-27

Email changes no longer swap users.email directly. The new address is
staged in pending_email (+ requested_at) until the verification link sent
to the NEW address is consumed; consume swaps the email then.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "d9e0f1a2b3c4"
down_revision: Union[str, None] = "b2c3d4e5f6a7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("pending_email", sa.Text(), nullable=True))
    op.add_column(
        "users",
        sa.Column("pending_email_requested_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("users", "pending_email_requested_at")
    op.drop_column("users", "pending_email")
