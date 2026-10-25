"""Add usage_estimated flag to request_logs + api_request_logs.

Lets analytics distinguish provider-reported usage from locally estimated
usage (e.g. mid-stream failures with partial output where the provider never
sent a usage event). Defaults to false; unknown stays NULL in the numeric
columns, never fabricated.
"""

revision: str = "e4f1a2b3c4d5"
down_revision: str | None = "f7a8b9c0d1e2"
branch_labels: str | list[str] | None = None
depends_on: str | list[str] | None = None


def upgrade() -> None:
    from alembic import op
    import sqlalchemy as sa

    op.add_column(
        "request_logs",
        sa.Column("usage_estimated", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.add_column(
        "api_request_logs",
        sa.Column("usage_estimated", sa.Boolean(), nullable=False, server_default="false"),
    )


def downgrade() -> None:
    from alembic import op

    op.drop_column("api_request_logs", "usage_estimated")
    op.drop_column("request_logs", "usage_estimated")
