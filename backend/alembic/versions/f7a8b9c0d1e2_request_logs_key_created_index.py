"""Add composite index request_logs(api_key_id, created_at).

The in-app key-policy Postgres spend fallback (`postgres_spend`) filters one
key over a budget window; without this index that SUM scans. Mirrors
`ix_api_request_logs_key_created` on the public-gateway ledger.
"""

revision: str = 'f7a8b9c0d1e2'
down_revision: str | None = 'd6e7f8a9b0c1'
branch_labels: str | list[str] | None = None
depends_on: str | list[str] | None = None


def upgrade() -> None:
    from alembic import op

    op.create_index(
        "ix_request_logs_key_created", "request_logs", ["api_key_id", "created_at"]
    )


def downgrade() -> None:
    from alembic import op

    op.drop_index("ix_request_logs_key_created", table_name="request_logs")
