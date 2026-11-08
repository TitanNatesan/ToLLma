"""message summary role for progressive compaction

Revision ID: c41d7e2a9b03
Revises: 38aa765cebc8
Create Date: 2026-11-08

Adds the SUMMARY label to the message_role enum (see Role.SUMMARY in
models/message.py). ALTER TYPE ... ADD VALUE cannot run inside a transaction
block, so the upgrade commits first via autocommit_block.

Downgrade is a documented no-op: PostgreSQL cannot drop an enum label, and
recreating the type would rewrite every row. Existing summary rows keep
working; fresh downgraded code simply never creates new ones.

If a downgrade is ever exercised anyway, the required data step comes first:
delete or convert every role='SUMMARY' row before recreating the enum
without the label, e.g. DELETE FROM messages WHERE role = 'SUMMARY' (loses
compacted context) or UPDATE messages SET role = 'SYSTEM' WHERE role =
'SUMMARY' (keeps the text readable). Skipping this step leaves rows whose
label the old enum no longer accepts, and the type rewrite will fail.
"""
from collections.abc import Sequence

from alembic import op

revision: str = 'c41d7e2a9b03'
down_revision: str | None = '38aa765cebc8'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE message_role ADD VALUE IF NOT EXISTS 'SUMMARY'")


def downgrade() -> None:
    # No-op by design (see docstring): enum labels cannot be dropped without
    # a full type rewrite. If ever exercised, first delete/convert all
    # role='SUMMARY' rows (see docstring), then recreate the type.
    pass
