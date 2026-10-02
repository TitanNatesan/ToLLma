"""Organizations & Teams Phase A: orgs, memberships, permission sets,
invitations/join-requests, audit log, notifications.

Revision ID: a1b2c3d4e5f7
Revises: e7f8a9b0c1d2
Create Date: 2026-09-28

No org providers/keys/budgets (Phase B). Conversations stay user-owned.
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'a1b2c3d4e5f7'
down_revision: str | None = 'e7f8a9b0c1d2'
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
        'organizations',
        *_base_columns(),
        *_soft_delete_columns(),
        sa.Column('name', sa.String(120), nullable=False),
        sa.Column('slug', sa.String(140), nullable=False),
        sa.Column('description', sa.String(500), nullable=True),
        sa.Column('website', sa.String(255), nullable=True),
        sa.Column('industry', sa.String(80), nullable=True),
        sa.Column('location', sa.String(120), nullable=True),
        sa.Column('size', sa.String(32), nullable=True),
        sa.Column('root_user_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('status', sa.String(16), nullable=False, server_default='active'),
        sa.Column('visibility_mode', sa.String(32), nullable=False, server_default='metadata_only'),
        sa.Column('personal_sharing_enforced', sa.Boolean(), nullable=False, server_default=sa.text('false')),
        sa.Column('audit_retention_days', sa.Integer(), nullable=False, server_default='365'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        'uq_organizations_slug_live', 'organizations', ['slug'],
        unique=True, postgresql_where=sa.text('is_deleted = false'),
    )
    op.create_index('ix_organizations_root', 'organizations', ['root_user_id'])
    op.create_index('ix_organizations_status', 'organizations', ['status'])

    op.create_table(
        'memberships',
        *_base_columns(),
        *_soft_delete_columns(),
        sa.Column('org_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('organizations.id'), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('is_root', sa.Boolean(), nullable=False, server_default=sa.text('false')),
        sa.Column('state', sa.String(16), nullable=False, server_default='active'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        'uq_memberships_org_user_live', 'memberships', ['org_id', 'user_id'],
        unique=True, postgresql_where=sa.text('is_deleted = false'),
    )
    op.create_index('ix_memberships_user', 'memberships', ['user_id'])
    op.create_index('ix_memberships_state', 'memberships', ['state'])

    op.create_table(
        'permission_sets',
        *_base_columns(),
        *_soft_delete_columns(),
        sa.Column('org_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('organizations.id'), nullable=True),
        sa.Column('name', sa.String(80), nullable=False),
        sa.Column('description', sa.String(300), nullable=True),
        sa.Column('is_system', sa.Boolean(), nullable=False, server_default=sa.text('false')),
        sa.Column('created_by', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('updated_by', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('uq_permission_sets_org_name', 'permission_sets', ['org_id', 'name'], unique=True)
    op.create_index('ix_permission_sets_org', 'permission_sets', ['org_id'])

    op.create_table(
        'permission_set_permissions',
        *_base_columns(),
        sa.Column('set_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('permission_sets.id'), nullable=False),
        sa.Column('code', sa.String(64), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('uq_set_permissions', 'permission_set_permissions', ['set_id', 'code'], unique=True)

    op.create_table(
        'membership_permission_sets',
        *_base_columns(),
        sa.Column('membership_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('memberships.id'), nullable=False),
        sa.Column('set_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('permission_sets.id'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        'uq_membership_sets', 'membership_permission_sets', ['membership_id', 'set_id'], unique=True,
    )

    op.create_table(
        'invitations',
        *_base_columns(),
        *_soft_delete_columns(),
        sa.Column('org_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('organizations.id'), nullable=False),
        sa.Column('email', sa.String(320), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('kind', sa.String(16), nullable=False),
        sa.Column('status', sa.String(16), nullable=False, server_default='pending'),
        sa.Column('token', sa.String(64), nullable=False),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('invited_by', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('set_ids', postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        'uq_invitations_pending', 'invitations', ['org_id', 'email', 'kind'],
        unique=True, postgresql_where=sa.text("status = 'pending' AND is_deleted = false"),
    )
    op.create_index('uq_invitations_token', 'invitations', ['token'], unique=True)
    op.create_index('ix_invitations_org_status', 'invitations', ['org_id', 'status'])
    op.create_index('ix_invitations_email', 'invitations', ['email'])

    op.create_table(
        'audit_logs',
        *_base_columns(),
        sa.Column('org_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('organizations.id'), nullable=True),
        sa.Column('actor_user_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('action', sa.String(64), nullable=False),
        sa.Column('target', postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_audit_logs_org_time', 'audit_logs', ['org_id', 'created_at'])
    op.create_index('ix_audit_logs_action', 'audit_logs', ['action'])

    op.create_table(
        'notifications',
        *_base_columns(),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('org_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('organizations.id'), nullable=True),
        sa.Column('kind', sa.String(64), nullable=False),
        sa.Column('title', sa.String(200), nullable=False),
        sa.Column('body', sa.Text(), nullable=True),
        sa.Column('ref', postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column('read_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_notifications_user_unread', 'notifications', ['user_id', 'read_at', 'created_at'])
    op.create_index('ix_notifications_org', 'notifications', ['org_id'])


def downgrade() -> None:
    for table, indexes in [
        ('notifications', ['ix_notifications_org', 'ix_notifications_user_unread']),
        ('audit_logs', ['ix_audit_logs_action', 'ix_audit_logs_org_time']),
        ('invitations', ['ix_invitations_email', 'ix_invitations_org_status', 'uq_invitations_token', 'uq_invitations_pending']),
        ('membership_permission_sets', ['uq_membership_sets']),
        ('permission_set_permissions', ['uq_set_permissions']),
        ('permission_sets', ['ix_permission_sets_org', 'uq_permission_sets_org_name']),
        ('memberships', ['ix_memberships_state', 'ix_memberships_user', 'uq_memberships_org_user_live']),
        ('organizations', ['ix_organizations_status', 'ix_organizations_root', 'uq_organizations_slug_live']),
    ]:
        for ix in indexes:
            op.drop_index(ix, table_name=table)
        op.drop_table(table)
