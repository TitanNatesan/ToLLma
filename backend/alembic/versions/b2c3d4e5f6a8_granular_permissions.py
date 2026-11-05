"""Organizations: granular permission catalog (Change Order B).

Revision ID: b2c3d4e5f6a8
Revises: a1b2c3d4e5f7
Create Date: 2026-09-28

Expands the 10 legacy codes into the grouped granular catalog on every
permission_set_permissions row. System Owner/Approver sets are then reset to
their canonical definitions (custom sets keep their mapped grants).
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = 'b2c3d4e5f6a8'
down_revision: str | None = 'a1b2c3d4e5f7'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

EXPANSION: dict[str, list[str]] = {
    "manage_members": ["Members.Invite", "Members.Approve", "Members.Read", "Members.Update",
                       "Members.Suspend", "Members.Remove", "Members.Export"],
    "approve_members": ["Members.Approve"],
    "manage_teams": ["Teams.Create", "Teams.Read", "Teams.Update", "Teams.Delete",
                     "Teams.AssignMembers", "Teams.RemoveMembers", "Teams.AssignPermissionSets"],
    "manage_providers": ["Providers.Create", "Providers.Read", "Providers.Update", "Providers.Delete",
                         "Providers.Validate", "Providers.RefreshModels", "Providers.ViewCredentials",
                         "Providers.RotateCredentials"],
    "create_keys": ["Keys.Create", "Keys.Read", "Keys.Update", "Keys.Delete",
                    "Keys.Revoke", "Keys.Assign", "Keys.Rotate"],
    "manage_budgets": ["Budgets.Read", "Budgets.Update", "Budgets.Allocate", "Budgets.Reclaim"],
    "view_analytics": ["Analytics.ViewUsage", "Analytics.ViewCost", "Organization.ViewAnalytics"],
    "view_audit": ["Audit.Read", "Organization.ViewAudit"],
    "manage_settings": ["Organization.Update", "Organization.Settings"],
    "transfer_root": ["Organization.TransferRoot"],
}

OWNER_EXTRA = [
    "Organization.Read", "Organization.Delete",
    "PermissionSets.Create", "PermissionSets.Read", "PermissionSets.Update",
    "PermissionSets.Delete", "PermissionSets.Assign",
    "Analytics.Export", "Analytics.ViewConversations", "Analytics.ViewAttachments",
    "Audit.Export",
]

APPROVER_CANONICAL = ["Members.Approve", "Members.Read", "Analytics.ViewUsage"]


def upgrade() -> None:
    conn = op.get_bind()
    # 1. Expand legacy codes on every row (custom + system sets alike).
    for old, news in EXPANSION.items():
        rows = conn.execute(
            sa.text("SELECT id, set_id FROM permission_set_permissions WHERE code = :code"),
            {"code": old},
        ).all()
        for row_id, set_id in rows:
            existing = {
                r[0] for r in conn.execute(
                    sa.text("SELECT code FROM permission_set_permissions WHERE set_id = :s"),
                    {"s": str(set_id)},
                ).all()
            }
            conn.execute(
                sa.text("DELETE FROM permission_set_permissions WHERE id = :id"),
                {"id": str(row_id)},
            )
            existing.discard(old)
            for code in news:
                if code not in existing:
                    conn.execute(
                        sa.text(
                            "INSERT INTO permission_set_permissions (id, created_at, updated_at, set_id, code)"
                            " VALUES (gen_random_uuid(), now(), now(), :s, :c)"
                        ),
                        {"s": str(set_id), "c": code},
                    )
                    existing.add(code)
    # 2. Reset system Owner to the full canonical catalog.
    owner_id = conn.execute(
        sa.text("SELECT id FROM permission_sets WHERE org_id IS NULL AND name = 'Owner' AND is_deleted = false")
    ).scalar()
    if owner_id is not None:
        have = {
            r[0] for r in conn.execute(
                sa.text("SELECT code FROM permission_set_permissions WHERE set_id = :s"),
                {"s": str(owner_id)},
            ).all()
        }
        for code in OWNER_EXTRA:
            if code not in have:
                conn.execute(
                    sa.text(
                        "INSERT INTO permission_set_permissions (id, created_at, updated_at, set_id, code)"
                        " VALUES (gen_random_uuid(), now(), now(), :s, :c)"
                    ),
                    {"s": str(owner_id), "c": code},
                )
    # 3. Reset system Approver to canonical.
    approver_id = conn.execute(
        sa.text("SELECT id FROM permission_sets WHERE org_id IS NULL AND name = 'Approver' AND is_deleted = false")
    ).scalar()
    if approver_id is not None:
        conn.execute(
            sa.text("DELETE FROM permission_set_permissions WHERE set_id = :s"),
            {"s": str(approver_id)},
        )
        for code in APPROVER_CANONICAL:
            conn.execute(
                sa.text(
                    "INSERT INTO permission_set_permissions (id, created_at, updated_at, set_id, code)"
                    " VALUES (gen_random_uuid(), now(), now(), :s, :c)"
                ),
                {"s": str(approver_id), "c": code},
            )


def downgrade() -> None:
    # Lossy by design (granular grants collapse); restore the legacy parents
    # for any set holding at least one child code.
    conn = op.get_bind()
    reverse: dict[str, str] = {}
    for old, news in EXPANSION.items():
        for code in news:
            reverse.setdefault(code, old)
    set_ids = [r[0] for r in conn.execute(sa.text("SELECT DISTINCT set_id FROM permission_set_permissions")).all()]
    for set_id in set_ids:
        codes = {
            r[0] for r in conn.execute(
                sa.text("SELECT code FROM permission_set_permissions WHERE set_id = :s"),
                {"s": str(set_id)},
            ).all()
        }
        parents = {reverse[c] for c in codes if c in reverse}
        conn.execute(
            sa.text("DELETE FROM permission_set_permissions WHERE set_id = :s"), {"s": str(set_id)}
        )
        for code in sorted(parents):
            conn.execute(
                sa.text(
                    "INSERT INTO permission_set_permissions (id, created_at, updated_at, set_id, code)"
                    " VALUES (gen_random_uuid(), now(), now(), :s, :c)"
                ),
                {"s": str(set_id), "c": code},
            )
