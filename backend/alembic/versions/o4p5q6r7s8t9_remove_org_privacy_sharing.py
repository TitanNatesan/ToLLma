"""Remove organizations.visibility_mode + personal_sharing_enforced.

The organization Privacy (visibility_mode) and Usage Sharing
(personal_sharing_enforced) features are deleted. Neither column has FK or
index dependencies (plain columns; organizations indexes cover only slug /
root_user_id / status). Historical audit rows with action
"org.policy_changed" stay readable via the format_event fallback, which
humanizes unknown actions.

Data deletion is IRREVERSIBLE: downgrade() recreates the columns with their
original defaults but cannot restore per-org values.

Revision ID: o4p5q6r7s8t9
Revises: n3o4p5q6r7s8
"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = 'o4p5q6r7s8t9'
down_revision: str | None = 'n3o4p5q6r7s8'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_column('organizations', 'personal_sharing_enforced')
    op.drop_column('organizations', 'visibility_mode')


def downgrade() -> None:
    # Schema-only restore; per-org values are NOT recoverable.
    op.add_column('organizations', sa.Column(
        'visibility_mode', sa.String(32), nullable=False, server_default='metadata_only'))
    op.add_column('organizations', sa.Column(
        'personal_sharing_enforced', sa.Boolean(), nullable=False, server_default=sa.text('false')))
