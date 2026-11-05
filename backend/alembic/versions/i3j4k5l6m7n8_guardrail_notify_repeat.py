"""Guardrail notify repeat interval.

Adds guardrail_policies.notify_repeat_minutes (per-policy notification
repeat interval in minutes, 1-1440, default 60 preserves hourly dedupe).
"""

revision: str = "i3j4k5l6m7n8"
down_revision: str | None = "h2i3j4k5l6m7"
branch_labels: str | list[str] | None = None
depends_on: str | list[str] | None = None


def upgrade() -> None:
    from alembic import op
    import sqlalchemy as sa

    op.add_column(
        "guardrail_policies",
        sa.Column("notify_repeat_minutes", sa.Integer(), nullable=False, server_default="60"),
    )


def downgrade() -> None:
    from alembic import op

    op.drop_column("guardrail_policies", "notify_repeat_minutes")
