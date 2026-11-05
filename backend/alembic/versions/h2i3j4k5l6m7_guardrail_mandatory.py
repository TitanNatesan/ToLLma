"""Guardrail mandatory flag + user FK nullability.

Adds guardrail_policies.is_mandatory (mandatory org policies cannot be
disabled or deleted — backs the frontend mandatory lock) and aligns the
user_id FK with every other nullable owner FK (ondelete=SET NULL).
"""

revision: str = "h2i3j4k5l6m7"
down_revision: str | None = "g1h2i3j4k5l6"
branch_labels: str | list[str] | None = None
depends_on: str | list[str] | None = None


def upgrade() -> None:
    from alembic import op
    import sqlalchemy as sa

    op.add_column(
        "guardrail_policies",
        sa.Column("is_mandatory", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.drop_constraint(
        "guardrail_policies_user_id_fkey", "guardrail_policies", type_="foreignkey"
    )
    op.create_foreign_key(
        "guardrail_policies_user_id_fkey",
        "guardrail_policies", "users", ["user_id"], ["id"], ondelete="SET NULL",
    )


def downgrade() -> None:
    from alembic import op
    import sqlalchemy as sa

    op.drop_constraint(
        "guardrail_policies_user_id_fkey", "guardrail_policies", type_="foreignkey"
    )
    op.create_foreign_key(
        "guardrail_policies_user_id_fkey",
        "guardrail_policies", "users", ["user_id"], ["id"],
    )
    op.drop_column("guardrail_policies", "is_mandatory")
