"""Provider owner-scope check constraint.

Revision ID: e4f5a6b7c8d9
Revises: d3e4f5a6b7c8
Create Date: 2026-10-17

Ownership is decided SOLELY by org_id: NULL = personal owned by user_id
(NOT NULL); NOT NULL = org-owned (user_id is creator audit, never scope).
Both-set rows REMAIN VALID org rows and are not touched.

Pre-flight aborts with a clear message when both-null providers exist
(audit found none, so the constraint applies cleanly).
"""

from collections.abc import Sequence

from alembic import op
from sqlalchemy import text


revision: str = 'e4f5a6b7c8d9'
down_revision: str | None = 'd3e4f5a6b7c8'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_CONSTRAINT = "(org_id IS NULL AND user_id IS NOT NULL) OR (org_id IS NOT NULL)"


def upgrade() -> None:
    conn = op.get_bind()
    both_null = conn.scalar(
        text("SELECT COUNT(*) FROM providers WHERE org_id IS NULL AND user_id IS NULL")
    )
    if both_null:
        raise RuntimeError(
            f"cannot create ck_providers_owner_scope: {both_null} provider row(s) "
            "have BOTH org_id AND user_id NULL (ownerless). Backfill user_id or "
            "soft-delete them, then re-run the migration."
        )
    op.create_check_constraint("ck_providers_owner_scope", "providers", _CONSTRAINT)


def downgrade() -> None:
    op.drop_constraint("ck_providers_owner_scope", "providers", type_="check")
