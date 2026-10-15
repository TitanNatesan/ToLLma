"""Org teams: teams + team_memberships + team_permission_sets.

Revision ID: f6a7b8c9d1e2
Revises: e5f6a7b8c9d1
Create Date: 2026-10-04

- teams: org-scoped grouping (soft-delete; live-only UQ (org_id, name) so a
  deleted name is reusable). Plain FKs (RESTRICT-style, repo precedent);
  cross-org pairing is enforced app-side with a 404 oracle.
- team_memberships: roster rows keyed by membership_id (leaving/removing the
  org hard-deletes them). Link-table convention: UUID PK, no soft-delete.
- team_permission_sets: sets granted to a team. Same convention.

No backfill: new tables start empty.
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'f6a7b8c9d1e2'
down_revision: str | None = 'e5f6a7b8c9d1'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _base_columns() -> list:
    return [
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    ]


def _soft_delete_columns() -> list:
    return [
        sa.Column('is_deleted', sa.Boolean(), server_default=sa.text('false'), nullable=False),
        sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('deleted_by', postgresql.UUID(as_uuid=True), nullable=True),
    ]


def upgrade() -> None:
    op.create_table(
        'teams',
        *_base_columns(),
        *_soft_delete_columns(),
        sa.Column('org_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('organizations.id'), nullable=False),
        sa.Column('name', sa.String(80), nullable=False),
        sa.Column('description', sa.String(300), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        'uq_teams_org_name_live', 'teams', ['org_id', 'name'],
        unique=True, postgresql_where=sa.text('is_deleted = false'),
    )
    op.create_index('ix_teams_org', 'teams', ['org_id'])

    op.create_table(
        'team_memberships',
        *_base_columns(),
        sa.Column('team_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('teams.id'), nullable=False),
        sa.Column('membership_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('memberships.id'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('uq_team_memberships', 'team_memberships', ['team_id', 'membership_id'], unique=True)
    op.create_index('ix_team_memberships_team', 'team_memberships', ['team_id'])
    op.create_index('ix_team_memberships_membership', 'team_memberships', ['membership_id'])

    op.create_table(
        'team_permission_sets',
        *_base_columns(),
        sa.Column('team_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('teams.id'), nullable=False),
        sa.Column('set_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('permission_sets.id'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('uq_team_permission_sets', 'team_permission_sets', ['team_id', 'set_id'], unique=True)
    op.create_index('ix_team_permission_sets_team', 'team_permission_sets', ['team_id'])
    op.create_index('ix_team_permission_sets_set', 'team_permission_sets', ['set_id'])


def downgrade() -> None:
    for table, indexes in [
        ('team_permission_sets', ['ix_team_permission_sets_set', 'ix_team_permission_sets_team',
                                  'uq_team_permission_sets']),
        ('team_memberships', ['ix_team_memberships_membership', 'ix_team_memberships_team',
                              'uq_team_memberships']),
        ('teams', ['ix_teams_org', 'uq_teams_org_name_live']),
    ]:
        for ix in indexes:
            op.drop_index(ix, table_name=table)
        op.drop_table(table)
