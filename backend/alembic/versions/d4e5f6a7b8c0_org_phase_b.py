"""Org Phase B columns: org scope for keys/providers/logs + org spend cap.

Revision ID: d4e5f6a7b8c0
Revises: c3d4e5f6a7b9
Create Date: 2026-10-03

- api_keys: org_id (NULL = personal key) + issued_by audit column;
  partial unique (org_id, name) for live org rows only.
- providers: org_id (NULL = personal); the old global live-name index
  becomes two per-scope partials (personal + org).
- request_logs: org_id + api_key_id attribution columns.
- api_request_logs: org_id attribution column (populated by backend).
- organizations: max_spend cap (NULL = unlimited).

No backfill: all new columns default to NULL (existing rows stay personal).
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'd4e5f6a7b8c0'
down_revision: str | None = 'c3d4e5f6a7b9'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _assert_no_personal_name_dupes() -> None:
    """Pre-flight: every live row lands in the personal partial (org_id NULL),
    so (user_id, name) must already be unique among live non-null-owner rows.
    NULL owners never conflict (PostgreSQL treats NULLs as distinct)."""
    bind = op.get_bind()
    dupes = bind.execute(
        sa.text(
            "SELECT user_id, name FROM providers "
            "WHERE is_deleted = false AND user_id IS NOT NULL "
            "GROUP BY user_id, name HAVING count(*) > 1 LIMIT 5"
        )
    ).all()
    if dupes:
        raise RuntimeError(
            "cannot create uq_providers_personal_name_live: duplicate live "
            f"(user_id, name) rows exist: {dupes}"
        )


def upgrade() -> None:
    op.add_column(
        'organizations',
        sa.Column('max_spend', sa.Numeric(14, 2), nullable=True),
    )

    op.add_column(
        'api_keys',
        sa.Column(
            'org_id', postgresql.UUID(as_uuid=True),
            sa.ForeignKey('organizations.id', ondelete='SET NULL'), nullable=True,
        ),
    )
    op.add_column(
        'api_keys',
        sa.Column(
            'issued_by', postgresql.UUID(as_uuid=True),
            sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True,
        ),
    )
    op.create_index('ix_api_keys_org', 'api_keys', ['org_id'])
    op.create_index('ix_api_keys_issued_by', 'api_keys', ['issued_by'])
    op.create_index(
        'uq_api_keys_org_name_live', 'api_keys', ['org_id', 'name'],
        unique=True, postgresql_where=sa.text('is_deleted = false AND org_id IS NOT NULL'),
    )

    _assert_no_personal_name_dupes()
    op.add_column(
        'providers',
        sa.Column(
            'org_id', postgresql.UUID(as_uuid=True),
            sa.ForeignKey('organizations.id', ondelete='SET NULL'), nullable=True,
        ),
    )
    op.create_index('ix_providers_org', 'providers', ['org_id'])
    op.create_index(
        'uq_providers_personal_name_live', 'providers', ['user_id', 'name'],
        unique=True, postgresql_where=sa.text('is_deleted = false AND org_id IS NULL'),
    )
    op.create_index(
        'uq_providers_org_name_live', 'providers', ['org_id', 'name'],
        unique=True, postgresql_where=sa.text('is_deleted = false AND org_id IS NOT NULL'),
    )
    op.drop_index('uq_providers_name_live', table_name='providers')

    op.add_column(
        'request_logs',
        sa.Column(
            'org_id', postgresql.UUID(as_uuid=True),
            sa.ForeignKey('organizations.id'), nullable=True,
        ),
    )
    op.add_column(
        'request_logs',
        sa.Column(
            'api_key_id', postgresql.UUID(as_uuid=True),
            sa.ForeignKey('api_keys.id', ondelete='SET NULL'), nullable=True,
        ),
    )
    op.create_index('ix_request_logs_org_created', 'request_logs', ['org_id', 'created_at'])
    op.create_index('ix_request_logs_api_key', 'request_logs', ['api_key_id'])

    op.add_column(
        'api_request_logs',
        sa.Column(
            'org_id', postgresql.UUID(as_uuid=True),
            sa.ForeignKey('organizations.id'), nullable=True,
        ),
    )
    op.create_index(
        'ix_api_request_logs_org_created', 'api_request_logs', ['org_id', 'created_at']
    )


def downgrade() -> None:
    op.drop_index('ix_api_request_logs_org_created', table_name='api_request_logs')
    op.drop_constraint('api_request_logs_org_id_fkey', 'api_request_logs', type_='foreignkey')
    op.drop_column('api_request_logs', 'org_id')

    op.drop_index('ix_request_logs_api_key', table_name='request_logs')
    op.drop_index('ix_request_logs_org_created', table_name='request_logs')
    op.drop_constraint('request_logs_api_key_id_fkey', 'request_logs', type_='foreignkey')
    op.drop_constraint('request_logs_org_id_fkey', 'request_logs', type_='foreignkey')
    op.drop_column('request_logs', 'api_key_id')
    op.drop_column('request_logs', 'org_id')

    op.drop_index('uq_providers_org_name_live', table_name='providers')
    op.drop_index('uq_providers_personal_name_live', table_name='providers')
    op.drop_index('ix_providers_org', table_name='providers')
    op.drop_constraint('providers_org_id_fkey', 'providers', type_='foreignkey')
    op.drop_column('providers', 'org_id')
    op.create_index(
        'uq_providers_name_live', 'providers', ['name'],
        unique=True, postgresql_where=sa.text('is_deleted = false'),
    )

    op.drop_index('uq_api_keys_org_name_live', table_name='api_keys')
    op.drop_index('ix_api_keys_issued_by', table_name='api_keys')
    op.drop_index('ix_api_keys_org', table_name='api_keys')
    op.drop_constraint('api_keys_issued_by_fkey', 'api_keys', type_='foreignkey')
    op.drop_constraint('api_keys_org_id_fkey', 'api_keys', type_='foreignkey')
    op.drop_column('api_keys', 'issued_by')
    op.drop_column('api_keys', 'org_id')

    op.drop_column('organizations', 'max_spend')
