"""Shared org guards: membership, effective permissions, paging/filter parsing.

Leaf module — imports ONLY models/*, core/* and stdlib. Never services,
routers, or sibling orgs submodules.
"""

import uuid
from datetime import date, datetime, timezone

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from tollms.core.exceptions import NotFoundError, ValidationError
from tollms.models.organization import (
    InvitationKind,
    InvitationStatus,
    Membership,
    MembershipPermissionSet,
    MembershipState,
    Organization,
    OrgStatus,
    PermissionSet,
    PermissionSetPermission,
    Team,
    TeamMembership,
    TeamPermissionSet,
)


PERMISSION_GROUPS: dict[str, list[tuple[str, str]]] = {
    "Organization": [
        ("Organization.Read", "View organization"),
        ("Organization.Update", "Update organization profile"),
        ("Organization.Delete", "Delete organization"),
        ("Organization.TransferRoot", "Transfer root ownership"),
        ("Organization.Settings", "Manage organization settings"),
        ("Organization.ViewAnalytics", "View organization analytics"),
        ("Organization.ViewAudit", "View audit log"),
    ],
    "Members": [
        ("Members.Invite", "Invite members"),
        ("Members.Approve", "Approve requests"),
        ("Members.Read", "View members"),
        ("Members.Update", "Update members"),
        ("Members.Suspend", "Suspend members"),
        ("Members.Remove", "Remove members"),
        ("Members.Export", "Export members"),
    ],
    "Teams": [
        ("Teams.Create", "Create teams"),
        ("Teams.Read", "View teams"),
        ("Teams.Update", "Update teams"),
        ("Teams.Delete", "Delete teams"),
        ("Teams.AssignMembers", "Assign team members"),
        ("Teams.RemoveMembers", "Remove team members"),
        ("Teams.AssignPermissionSets", "Assign team permission sets"),
    ],
    "PermissionSets": [
        ("PermissionSets.Create", "Create permission sets"),
        ("PermissionSets.Read", "View permission sets"),
        ("PermissionSets.Update", "Update permission sets"),
        ("PermissionSets.Delete", "Delete permission sets"),
        ("PermissionSets.Assign", "Assign permission sets"),
    ],
    "Providers": [
        ("Providers.Create", "Create providers"),
        ("Providers.Read", "View providers"),
        ("Providers.Update", "Update providers"),
        ("Providers.Delete", "Delete providers"),
        ("Providers.Validate", "Validate providers"),
        ("Providers.RefreshModels", "Refresh provider models"),
        ("Providers.ViewCredentials", "View provider credentials"),
        ("Providers.RotateCredentials", "Rotate provider credentials"),
    ],
    "Keys": [
        ("Keys.Create", "Create API keys"),
        ("Keys.Read", "View API keys"),
        ("Keys.Update", "Update API keys"),
        ("Keys.Delete", "Delete API keys"),
        ("Keys.Revoke", "Revoke API keys"),
        ("Keys.Assign", "Assign API keys"),
        ("Keys.Rotate", "Rotate API keys"),
    ],
    "Budgets": [
        ("Budgets.Read", "View budgets"),
        ("Budgets.Update", "Update budgets"),
        ("Budgets.Allocate", "Allocate budgets"),
        ("Budgets.Reclaim", "Reclaim budgets"),
    ],
    "Analytics": [
        ("Analytics.ViewUsage", "View usage analytics"),
        ("Analytics.ViewCost", "View cost analytics"),
        ("Analytics.Export", "Export analytics"),
        ("Analytics.ViewConversations", "View conversations"),
        ("Analytics.ViewAttachments", "View attachments"),
    ],
    "Audit": [
        ("Audit.Read", "Read audit log"),
        ("Audit.Export", "Export audit log"),
    ],
}



PERMISSION_CATALOG = [code for group in PERMISSION_GROUPS.values() for code, _ in group]



PERMISSION_LABELS = {code: label for group in PERMISSION_GROUPS.values() for code, label in group}



SYSTEM_SET_DEFS = {
    "Owner": ("Full organization control (all permissions).", list(PERMISSION_CATALOG)),
    "Approver": (
        "Membership approvals and usage analytics.",
        ["Members.Approve", "Members.Read", "Analytics.ViewUsage"],
    ),
    "Member": ("No governance permissions.", []),
}



_ORG_NOT_FOUND = "organization not found"



def _set_codes(db: Session, set_id: uuid.UUID) -> list[str]:
    return sorted(
        r[0] for r in db.execute(
            select(PermissionSetPermission.code).where(PermissionSetPermission.set_id == set_id)
        ).all()
    )



_VALID_STATES = {s.value for s in MembershipState}



_VALID_KINDS = {k.value for k in InvitationKind}



_VALID_STATUSES = {s.value for s in InvitationStatus}



_MAX_PAGE = 200



def _clamp_limit(limit: int | None, default: int | None) -> int | None:
    """Clamp a page size to [1, 200]; None yields the endpoint default (which
    itself may be None = uncapped full list). Non-integer input never reaches
    here — FastAPI rejects it with 422 before the service runs."""
    if limit is None:
        return default
    return min(max(limit, 1), _MAX_PAGE)



def _clamp_offset(offset: int) -> int:
    return max(offset or 0, 0)



def _search_like(value: str | None) -> str | None:
    if value is None or not value.strip():
        return None
    return f"%{value.strip().lower()}%"



def _parse_uuid(value: str | None, name: str) -> uuid.UUID | None:
    """Strict UUID param parsing: malformed values are 422 (never ignored)."""
    if value is None:
        return None
    try:
        return uuid.UUID(str(value).strip())
    except (ValueError, TypeError, AttributeError):
        raise ValidationError(f"invalid {name}: {value!r}") from None



def _parse_time(value: str | None, name: str, *, end_of_day: bool = False) -> datetime | None:
    """Strict ISO date/datetime parsing: malformed values are 422. Bare dates
    resolve to day-start (or day-end for upper bounds); naive datetimes are
    assumed UTC."""
    if value is None:
        return None
    text = value.strip()
    try:
        try:
            parsed = datetime.fromisoformat(text)
        except ValueError:
            day = date.fromisoformat(text)
            if end_of_day:
                parsed = datetime(day.year, day.month, day.day, 23, 59, 59, 999999,
                                  tzinfo=timezone.utc)
            else:
                parsed = datetime(day.year, day.month, day.day, tzinfo=timezone.utc)
    except ValueError:
        raise ValidationError(f"invalid {name}: {value!r}; expected ISO date/datetime") from None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed



def _live_membership(db: Session, org_id: uuid.UUID, user_id: uuid.UUID) -> Membership | None:
    return db.execute(
        select(Membership).where(
            Membership.org_id == org_id, Membership.user_id == user_id,
            Membership.is_deleted.is_(False), Membership.state == MembershipState.ACTIVE.value,
        )
    ).scalars().first()



def _any_membership(db: Session, org_id: uuid.UUID, user_id: uuid.UUID) -> Membership | None:
    return db.execute(
        select(Membership).where(
            Membership.org_id == org_id, Membership.user_id == user_id,
            Membership.is_deleted.is_(False),
        )
    ).scalars().first()



def effective_permissions(db: Session, org_id: uuid.UUID, user_id: uuid.UUID) -> set[str]:
    """Root holds every catalog code implicitly. Active members get the union
    of their direct live sets plus the team leg: codes from sets attached to
    the caller's teams (reachable only via the caller's own ACTIVE membership,
    so suspend/remove/leave drop the team leg automatically while the roster
    rows are retained through suspend). Everyone else
    (suspended/removed/stranger) evaluates to empty. No cache: every
    _require_perm caller inherits the union by calling this single site."""
    mem = _live_membership(db, org_id, user_id)
    if mem is None:
        return set()
    if mem.is_root:
        return set(PERMISSION_CATALOG)
    set_ids = [
        r[0] for r in db.execute(
            select(MembershipPermissionSet.set_id).where(MembershipPermissionSet.membership_id == mem.id)
        ).all()
    ]
    team_set_ids = [
        r[0] for r in db.execute(
            select(TeamPermissionSet.set_id)
            .join(TeamMembership, TeamMembership.team_id == TeamPermissionSet.team_id)
            .join(Team, Team.id == TeamMembership.team_id)
            .where(
                TeamMembership.membership_id == mem.id,
                Team.org_id == org_id,
                Team.is_deleted.is_(False),
            )
        ).all()
    ]
    set_ids = list(set(set_ids) | set(team_set_ids))
    if not set_ids:
        return set()
    return set(
        r[0] for r in db.execute(
            select(PermissionSetPermission.code)
            .join(PermissionSet, PermissionSet.id == PermissionSetPermission.set_id)
            .where(
                PermissionSetPermission.set_id.in_(set_ids),
                PermissionSet.is_deleted.is_(False),
            )
        ).all()
    )



def _get_org(db: Session, org_id: uuid.UUID) -> Organization:
    org = db.get(Organization, org_id)
    if org is None or org.is_deleted or org.status != OrgStatus.ACTIVE.value:
        raise NotFoundError(_ORG_NOT_FOUND)
    return org



def _member_org(db: Session, org_id: uuid.UUID, user_id: uuid.UUID) -> tuple[Organization, Membership]:
    """Active membership required; strangers and non-active members get 404."""
    org = _get_org(db, org_id)
    mem = _live_membership(db, org_id, user_id)
    if mem is None:
        raise NotFoundError(_ORG_NOT_FOUND)
    return org, mem



def _require_perm(db: Session, org: Organization, mem: Membership, user_id: uuid.UUID, code: str) -> set[str]:
    perms = effective_permissions(db, org.id, user_id)
    if code not in perms and not mem.is_root:
        raise NotFoundError(_ORG_NOT_FOUND)
    return perms



def _check_grantable(granter: set[str], codes: list[str]) -> None:
    """Escalation hard rule: never grant what you do not possess."""
    unknown = [c for c in codes if c not in PERMISSION_CATALOG]
    if unknown:
        raise ValidationError(f"unknown permissions: {', '.join(sorted(unknown))}")
    excess = [c for c in codes if c not in granter]
    if excess:
        raise NotFoundError("permission set not found")



def _resolve_sets(db: Session, org_id: uuid.UUID, set_ids: list[uuid.UUID]) -> list[PermissionSet]:
    if not set_ids:
        return []
    rows = db.execute(
        select(PermissionSet).where(
            PermissionSet.id.in_(set_ids), PermissionSet.is_deleted.is_(False),
            or_(PermissionSet.org_id == org_id, PermissionSet.org_id.is_(None)),
        )
    ).scalars().all()
    if len(rows) != len(set(set_ids)):
        raise NotFoundError("permission set not found")
    return list(rows)

