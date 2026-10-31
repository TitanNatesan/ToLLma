"""Drop team-based prompt logging; scopes are global + API-key-only.

Removes the ``prompt_logging_team_targets`` table (plus its indexes) and the
``prompt_logs.team_ids`` JSONB column. Legacy rows in mode ``teams`` are
remapped to mode ``keys``: the key allow-list / key-override semantics carry
over unchanged, the team leg simply stops matching (an empty key list in
``keys`` mode logs nothing, never falls back to global — same fail-closed
rule ``teams`` mode had).

History preservation: ``prompt_logs`` rows themselves are untouched, so
historical rows with ``match_source='team'`` remain readable; no new ``team``
matches occur after this migration (resolution only emits global/key).

Downgrade recreates the table/column empty (team membership data is not
restored) and maps mode ``keys`` back to ``teams``.
"""

revision: str = "q6r7s8t9u0v1"
down_revision: str | None = "p5q6r7s8t9u0"
branch_labels: str | list[str] | None = None
depends_on: str | list[str] | None = None


def upgrade() -> None:
    from alembic import op
    import sqlalchemy as sa
    from sqlalchemy.dialects import postgresql

    op.execute("UPDATE prompt_logging_settings SET mode = 'keys' WHERE mode = 'teams'")
    for index in ("uq_prompt_logging_team_targets",
                  "ix_prompt_logging_team_targets_setting",
                  "ix_prompt_logging_team_targets_team"):
        op.drop_index(index, table_name="prompt_logging_team_targets")
    op.drop_table("prompt_logging_team_targets")
    op.drop_column("prompt_logs", "team_ids")


def downgrade() -> None:
    from alembic import op
    import sqlalchemy as sa
    from sqlalchemy.dialects import postgresql

    op.create_table(
        "prompt_logging_team_targets",
        sa.Column("setting_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("prompt_logging_settings.id", ondelete="CASCADE"), nullable=False),
        sa.Column("team_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("teams.id", ondelete="CASCADE"), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("uq_prompt_logging_team_targets", "prompt_logging_team_targets", ["setting_id", "team_id"], unique=True)
    op.create_index("ix_prompt_logging_team_targets_setting", "prompt_logging_team_targets", ["setting_id"])
    op.create_index("ix_prompt_logging_team_targets_team", "prompt_logging_team_targets", ["team_id"])
    op.add_column("prompt_logs", sa.Column("team_ids", postgresql.JSONB(), nullable=False, server_default="[]"))
    # NOTE (downgrade limitation): genuine `keys`-mode policies are also flipped
    # back to `teams`; team membership rows are unrestorable by design.
    # Downgrade is best-effort only — upgrade is the supported direction.
    op.execute("UPDATE prompt_logging_settings SET mode = 'teams' WHERE mode = 'keys'")
