"""Organizations Phase A service: orgs, permission sets, invitations,
join-requests, members, audit, search. Cross-org reads raise NotFoundError
(404 oracle, never 403)."""

import logging
import re
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from tollms.api.keys import service as keys_service
from tollms.api.auth import service as auth_service
from tollms.api.orgs.schemas import (
    AcceptNewResponse,
    AnalyticsDayPoint,
    AnalyticsModelRow,
    AnalyticsOverview,
    AnalyticsProviderRow,
    AnalyticsTotals,
    AnalyticsUserRow,
    AuditRead,
    BudgetRead,
    InvitationRead,
    InvitePreview,
    InviterRef,
    MemberRead,
    OrgCard,
    OrgKeyRead,
    OrgRead,
    PermissionSetRead,
    PermissionSetSummary,
    RejectNewResponse,
    TeamDetail,
    TeamMemberRead,
    TeamRead,
    TeamSetRead,
)
from tollms.core import security
from tollms.core.config import get_settings
from tollms.core.exceptions import ConflictError, NotFoundError, ValidationError
from tollms.models.organization import (
    AuditLog,
    Invitation,
    InvitationKind,
    InvitationStatus,
    Membership,
    MembershipPermissionSet,
    MembershipState,
    Notification,
    Organization,
    OrgStatus,
    PermissionSet,
    PermissionSetPermission,
    Team,
    TeamMembership,
    TeamPermissionSet,
)
from tollms.models.user import User
from tollms.services.email.service import route_email

logger = logging.getLogger(__name__)

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


# --- audit + notifications ----------------------------------------------------


def _audit(db: Session, org_id: uuid.UUID | None, actor: uuid.UUID | None, action: str, **target) -> None:
    db.add(AuditLog(org_id=org_id, actor_user_id=actor, action=action, target=dict(target)))


def _notify(db: Session, user_id: uuid.UUID, kind: str, title: str, org_id: uuid.UUID | None = None,
            body: str | None = None, **ref) -> None:
    db.add(Notification(user_id=user_id, kind=kind, title=title, body=body, org_id=org_id, ref=dict(ref)))


# --- permission sets ----------------------------------------------------------


def ensure_system_sets(db: Session) -> dict[str, PermissionSet]:
    """Idempotent platform seed: Owner / Approver / Member (org_id NULL)."""
    out: dict[str, PermissionSet] = {}
    for name, (desc, codes) in SYSTEM_SET_DEFS.items():
        row = db.execute(
            select(PermissionSet).where(PermissionSet.org_id.is_(None), PermissionSet.name == name,
                                       PermissionSet.is_deleted.is_(False))
        ).scalars().first()
        if row is None:
            row = PermissionSet(org_id=None, name=name, description=desc, is_system=True)
            db.add(row)
            db.flush()
            for code in codes:
                db.add(PermissionSetPermission(set_id=row.id, code=code))
            db.flush()
        out[name] = row
    return out


def permission_catalog() -> list[dict]:
    """Grouped catalog with human labels for the permission builder UI."""
    return [
        {"group": group, "permissions": [{"code": code, "label": label} for code, label in items]}
        for group, items in PERMISSION_GROUPS.items()
    ]


def _set_codes(db: Session, set_id: uuid.UUID) -> list[str]:
    return sorted(
        r[0] for r in db.execute(
            select(PermissionSetPermission.code).where(PermissionSetPermission.set_id == set_id)
        ).all()
    )


def _read_set(db: Session, row: PermissionSet) -> PermissionSetRead:
    return PermissionSetRead(
        id=row.id, name=row.name, description=row.description, is_system=row.is_system,
        permissions=_set_codes(db, row.id), created_at=row.created_at,
    )


# --- membership + effective permissions ---------------------------------------


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


def _read_org(db: Session, org: Organization, user_id: uuid.UUID) -> OrgRead:
    mem = _live_membership(db, org.id, user_id)
    perms = effective_permissions(db, org.id, user_id) if mem else set()
    return OrgRead(
        id=org.id, name=org.name, slug=org.slug, description=org.description, website=org.website,
        industry=org.industry, location=org.location, size=org.size, status=org.status,
        visibility_mode=org.visibility_mode, personal_sharing_enforced=org.personal_sharing_enforced,
        is_root=bool(mem and mem.is_root), permissions=sorted(perms), created_at=org.created_at,
    )


# --- organizations --------------------------------------------------------------


def _slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:100] or "org"
    return f"{slug}-{uuid.uuid4().hex[:6]}"


def create_organization(db: Session, user_id: uuid.UUID, *, name: str, description: str | None,
                        website: str | None, industry: str | None, location: str | None,
                        size: str | None) -> OrgRead:
    ensure_system_sets(db)
    slug = _slugify(name)
    while db.execute(
        select(Organization.id).where(Organization.slug == slug, Organization.is_deleted.is_(False))
    ).first():
        slug = _slugify(name)
    org = Organization(
        name=name, slug=slug, description=description, website=website, industry=industry,
        location=location, size=size, root_user_id=user_id, status=OrgStatus.ACTIVE.value,
    )
    db.add(org)
    db.flush()
    db.add(Membership(org_id=org.id, user_id=user_id, is_root=True, state=MembershipState.ACTIVE.value))
    _audit(db, org.id, user_id, "org.created", org_name=name, slug=slug)
    db.commit()
    db.refresh(org)
    logger.info("organization created: org_id=%s root=%s", org.id, user_id)
    return _read_org(db, org, user_id)


def list_my_organizations(db: Session, user_id: uuid.UUID) -> list[OrgRead]:
    rows = db.execute(
        select(Organization).join(Membership, Membership.org_id == Organization.id).where(
            Membership.user_id == user_id, Membership.is_deleted.is_(False),
            Membership.state == MembershipState.ACTIVE.value,
            Organization.is_deleted.is_(False), Organization.status == OrgStatus.ACTIVE.value,
        ).order_by(Organization.created_at.desc())
    ).scalars().all()
    return [_read_org(db, o, user_id) for o in rows]


def search_organizations(db: Session, query: str, limit: int = 20) -> list[OrgCard]:
    q = f"%{query.strip().lower()}%"
    rows = db.execute(
        select(Organization).where(
            Organization.is_deleted.is_(False), Organization.status == OrgStatus.ACTIVE.value,
            or_(func.lower(Organization.name).like(q), func.lower(Organization.slug).like(q)),
        ).order_by(Organization.name).limit(min(max(limit, 1), 50))
    ).scalars().all()
    return [
        OrgCard(id=o.id, name=o.name, slug=o.slug, description=o.description, website=o.website,
                industry=o.industry)
        for o in rows
    ]


def update_organization(db: Session, user_id: uuid.UUID, org_id: uuid.UUID, **fields) -> OrgRead:
    org, mem = _member_org(db, org_id, user_id)
    _require_perm(db, org, mem, user_id, "Organization.Settings")
    changed: dict = {}
    for key in ("description", "website", "industry", "location", "size", "visibility_mode",
                "personal_sharing_enforced"):
        if key in fields and fields[key] is not None:
            setattr(org, key, fields[key])
            changed[key] = fields[key]
    if "visibility_mode" in changed or "personal_sharing_enforced" in changed:
        _notify_members_policy_change(db, org, {k: v for k, v in changed.items()
                                                if k in ("visibility_mode", "personal_sharing_enforced")})
    _audit(db, org.id, user_id, "org.policy_changed" if set(changed) & {"visibility_mode", "personal_sharing_enforced"} else "org.updated", **{k: str(v) for k, v in changed.items()})
    db.commit()
    db.refresh(org)
    return _read_org(db, org, user_id)


def _notify_members_policy_change(db: Session, org: Organization, changed: dict) -> None:
    if not changed:
        return
    member_ids = [
        r[0] for r in db.execute(
            select(Membership.user_id).where(
                Membership.org_id == org.id, Membership.is_deleted.is_(False),
                Membership.state == MembershipState.ACTIVE.value,
            )
        ).all()
    ]
    for uid in member_ids:
        _notify(db, uid, "org.policy_changed", f"Organization policy updated: {org.name}",
                org_id=org.id, changed=list(changed))


# --- permission sets ------------------------------------------------------------


def list_sets(db: Session, user_id: uuid.UUID, org_id: uuid.UUID) -> list[PermissionSetRead]:
    org, mem = _member_org(db, org_id, user_id)
    _require_perm(db, org, mem, user_id, "PermissionSets.Read")
    rows = db.execute(
        select(PermissionSet).where(
            or_(PermissionSet.org_id == org_id, PermissionSet.org_id.is_(None)),
            PermissionSet.is_deleted.is_(False),
        ).order_by(PermissionSet.is_system.desc(), PermissionSet.name)
    ).scalars().all()
    return [_read_set(db, r) for r in rows]


def create_set(db: Session, user_id: uuid.UUID, org_id: uuid.UUID, *, name: str,
               description: str | None, permissions: list[str]) -> PermissionSetRead:
    org, mem = _member_org(db, org_id, user_id)
    granter = _require_perm(db, org, mem, user_id, "PermissionSets.Create")
    _check_grantable(granter if not mem.is_root else set(PERMISSION_CATALOG), permissions)
    exists = db.execute(
        select(PermissionSet.id).where(
            PermissionSet.org_id == org_id, func.lower(PermissionSet.name) == name.lower(),
            PermissionSet.is_deleted.is_(False))
    ).first()
    if exists:
        raise ConflictError("permission set name already exists")
    row = PermissionSet(org_id=org_id, name=name.strip(), description=description,
                        is_system=False, created_by=user_id, updated_by=user_id)
    db.add(row)
    db.flush()
    for code in sorted(set(permissions)):
        db.add(PermissionSetPermission(set_id=row.id, code=code))
    _audit(db, org_id, user_id, "set.created", set_name=name, permissions=sorted(set(permissions)))
    db.commit()
    db.refresh(row)
    return _read_set(db, row)


def update_set(db: Session, user_id: uuid.UUID, org_id: uuid.UUID, set_id: uuid.UUID, *,
               name: str | None, description: str | None, permissions: list[str] | None) -> PermissionSetRead:
    org, mem = _member_org(db, org_id, user_id)
    granter = _require_perm(db, org, mem, user_id, "PermissionSets.Update")
    row = db.get(PermissionSet, set_id)
    if row is None or row.is_deleted or (row.org_id != org_id and row.org_id is not None):
        raise NotFoundError("permission set not found")
    if row.is_system:
        raise ValidationError("system permission sets are immutable; clone them instead")
    if permissions is not None:
        _check_grantable(granter if not mem.is_root else set(PERMISSION_CATALOG), permissions)
        db.query(PermissionSetPermission).filter(PermissionSetPermission.set_id == row.id).delete()
        for code in sorted(set(permissions)):
            db.add(PermissionSetPermission(set_id=row.id, code=code))
    if name is not None:
        dup = db.execute(
            select(PermissionSet.id).where(
                PermissionSet.org_id == org_id, func.lower(PermissionSet.name) == name.strip().lower(),
                PermissionSet.is_deleted.is_(False), PermissionSet.id != row.id)
        ).first()
        if dup:
            raise ConflictError("permission set name already exists")
        row.name = name.strip()
    if description is not None:
        row.description = description
    row.updated_by = user_id
    _audit(db, org_id, user_id, "set.updated", set_id=str(set_id))
    db.commit()
    db.refresh(row)
    return _read_set(db, row)


def delete_set(db: Session, user_id: uuid.UUID, org_id: uuid.UUID, set_id: uuid.UUID) -> None:
    org, mem = _member_org(db, org_id, user_id)
    _require_perm(db, org, mem, user_id, "PermissionSets.Delete")
    row = db.get(PermissionSet, set_id)
    if row is None or row.is_deleted or (row.org_id != org_id and row.org_id is not None):
        raise NotFoundError("permission set not found")
    if row.is_system:
        raise ValidationError("system permission sets cannot be deleted")
    assigned = db.execute(
        select(MembershipPermissionSet.membership_id).where(MembershipPermissionSet.set_id == set_id).limit(1)
    ).first()
    team_assigned = db.execute(
        select(TeamPermissionSet.team_id).where(TeamPermissionSet.set_id == set_id).limit(1)
    ).first()
    if assigned or team_assigned:
        raise ConflictError("permission set is assigned; unassign it first")
    row.is_deleted = True
    row.deleted_by = user_id
    row.deleted_at = datetime.now(timezone.utc)
    _audit(db, org_id, user_id, "set.deleted", set_id=str(set_id), set_name=row.name)
    db.commit()


def clone_set(db: Session, user_id: uuid.UUID, org_id: uuid.UUID, set_id: uuid.UUID, *, name: str) -> PermissionSetRead:
    org, mem = _member_org(db, org_id, user_id)
    granter = _require_perm(db, org, mem, user_id, "PermissionSets.Create")
    src = db.get(PermissionSet, set_id)
    if src is None or src.is_deleted or (src.org_id not in (None, org_id)):
        raise NotFoundError("permission set not found")
    codes = _set_codes(db, src.id)
    _check_grantable(granter if not mem.is_root else set(PERMISSION_CATALOG), codes)
    return create_set(db, user_id, org_id, name=name, description=f"Cloned from {src.name}.", permissions=codes)


def assign_sets(db: Session, granter_id: uuid.UUID, org_id: uuid.UUID, target_user_id: uuid.UUID,
                set_ids: list[uuid.UUID]) -> MemberRead:
    org, mem = _member_org(db, org_id, granter_id)
    granter = _require_perm(db, org, mem, granter_id, "PermissionSets.Assign")
    target = _live_membership(db, org_id, target_user_id)
    if target is None:
        raise NotFoundError("member not found")
    rows = _resolve_sets(db, org_id, set_ids)
    codes = sorted({c for r in rows for c in _set_codes(db, r.id)})
    _check_grantable(granter if not mem.is_root else set(PERMISSION_CATALOG), codes)
    db.query(MembershipPermissionSet).filter(MembershipPermissionSet.membership_id == target.id).delete()
    for sid in {r.id for r in rows}:
        db.add(MembershipPermissionSet(membership_id=target.id, set_id=sid))
    _audit(db, org_id, granter_id, "set.assigned", user_id=str(target_user_id),
           sets=[r.name for r in rows])
    db.commit()
    return read_member(db, org, target)


# --- teams ----------------------------------------------------------------------


def _get_team(db: Session, org_id: uuid.UUID, team_id: uuid.UUID) -> Team:
    """Live team of this org. Missing, deleted, and foreign-org ids all raise
    the identical 404 (no cross-org existence oracle)."""
    team = db.get(Team, team_id)
    if team is None or team.is_deleted or team.org_id != org_id:
        raise NotFoundError("team not found")
    return team


def _team_codes(db: Session, team_id: uuid.UUID) -> list[str]:
    """Union of live codes from the team's attached sets (deduped, sorted)."""
    return sorted(set(
        r[0] for r in db.execute(
            select(PermissionSetPermission.code)
            .join(TeamPermissionSet, TeamPermissionSet.set_id == PermissionSetPermission.set_id)
            .join(PermissionSet, PermissionSet.id == PermissionSetPermission.set_id)
            .where(TeamPermissionSet.team_id == team_id, PermissionSet.is_deleted.is_(False))
        ).all()
    ))


def _read_team(db: Session, team: Team) -> TeamDetail:
    links = db.execute(
        select(TeamMembership).where(TeamMembership.team_id == team.id)
        .order_by(TeamMembership.created_at)
    ).scalars().all()
    members: list[TeamMemberRead] = []
    for link in links:
        membership = db.get(Membership, link.membership_id)
        if membership is None or membership.is_deleted:
            continue
        user = db.get(User, membership.user_id)
        members.append(TeamMemberRead(
            membership_id=membership.id, user_id=membership.user_id,
            email=user.email if user else "", full_name=user.full_name if user else None,
            state=membership.state,
        ))
    rows = db.execute(
        select(PermissionSet)
        .join(TeamPermissionSet, TeamPermissionSet.set_id == PermissionSet.id)
        .where(TeamPermissionSet.team_id == team.id, PermissionSet.is_deleted.is_(False))
        .order_by(PermissionSet.name)
    ).scalars().all()
    return TeamDetail(
        id=team.id, name=team.name, description=team.description,
        member_count=len(members), codes=_team_codes(db, team.id),
        created_at=team.created_at, members=members,
        sets=[TeamSetRead(id=r.id, name=r.name, codes=_set_codes(db, r.id)) for r in rows],
    )


def _reject_system_sets(rows: list[PermissionSet]) -> None:
    """System sets are readable but never writable on teams — clone first.
    422 like the existing system-set write guards (update/delete_set)."""
    if any(r.is_system for r in rows):
        raise ValidationError("system permission sets cannot be assigned to teams; clone them instead")


def create_team(db: Session, user_id: uuid.UUID, org_id: uuid.UUID, *, name: str,
                description: str | None, set_ids: list[uuid.UUID]) -> TeamDetail:
    org, mem = _member_org(db, org_id, user_id)
    granter = _require_perm(db, org, mem, user_id, "Teams.Create")
    name = (name or "").strip()
    if not name:
        raise ValidationError("team name is required")
    dup = db.execute(
        select(Team.id).where(
            Team.org_id == org_id, func.lower(Team.name) == name.lower(),
            Team.is_deleted.is_(False))
    ).first()
    if dup:
        raise ConflictError("team name already exists")
    rows = _resolve_sets(db, org_id, list(set_ids or []))
    _reject_system_sets(rows)
    codes = sorted({c for r in rows for c in _set_codes(db, r.id)})
    _check_grantable(granter if not mem.is_root else set(PERMISSION_CATALOG), codes)
    team = Team(org_id=org_id, name=name, description=description)
    db.add(team)
    db.flush()
    for r in rows:
        db.add(TeamPermissionSet(team_id=team.id, set_id=r.id))
    _audit(db, org_id, user_id, "team.created", team_id=str(team.id), team_name=name)
    db.commit()
    db.refresh(team)
    return _read_team(db, team)


def list_teams(db: Session, user_id: uuid.UUID, org_id: uuid.UUID) -> list[TeamDetail]:
    org, mem = _member_org(db, org_id, user_id)
    _require_perm(db, org, mem, user_id, "Teams.Read")
    rows = db.execute(
        select(Team).where(Team.org_id == org_id, Team.is_deleted.is_(False)).order_by(Team.name)
    ).scalars().all()
    return [_read_team(db, t) for t in rows]


def get_team(db: Session, user_id: uuid.UUID, org_id: uuid.UUID, team_id: uuid.UUID) -> TeamDetail:
    org, mem = _member_org(db, org_id, user_id)
    _require_perm(db, org, mem, user_id, "Teams.Read")
    return _read_team(db, _get_team(db, org_id, team_id))


def update_team(db: Session, user_id: uuid.UUID, org_id: uuid.UUID, team_id: uuid.UUID, *,
                name: str | None = None, description: str | None = None) -> TeamDetail:
    org, mem = _member_org(db, org_id, user_id)
    _require_perm(db, org, mem, user_id, "Teams.Update")
    team = _get_team(db, org_id, team_id)
    if name is not None:
        name = name.strip()
        if not name:
            raise ValidationError("team name is required")
        dup = db.execute(
            select(Team.id).where(
                Team.org_id == org_id, func.lower(Team.name) == name.lower(),
                Team.is_deleted.is_(False), Team.id != team.id)
        ).first()
        if dup:
            raise ConflictError("team name already exists")
        team.name = name
    if description is not None:
        team.description = description
    _audit(db, org_id, user_id, "team.updated", team_id=str(team.id), team_name=team.name)
    db.commit()
    db.refresh(team)
    return _read_team(db, team)


def delete_team(db: Session, user_id: uuid.UUID, org_id: uuid.UUID, team_id: uuid.UUID) -> None:
    """Soft-delete the team + hard-delete its link rows. Users, memberships,
    providers, conversations, and keys are never touched."""
    org, mem = _member_org(db, org_id, user_id)
    _require_perm(db, org, mem, user_id, "Teams.Delete")
    team = _get_team(db, org_id, team_id)
    db.query(TeamMembership).filter(TeamMembership.team_id == team.id).delete()
    db.query(TeamPermissionSet).filter(TeamPermissionSet.team_id == team.id).delete()
    team.is_deleted = True
    team.deleted_by = user_id
    team.deleted_at = datetime.now(timezone.utc)
    _audit(db, org_id, user_id, "team.deleted", team_id=str(team.id), team_name=team.name)
    db.commit()


def add_team_member(db: Session, actor_id: uuid.UUID, org_id: uuid.UUID, team_id: uuid.UUID,
                    target_user_id: uuid.UUID) -> TeamDetail:
    """Roster add: the target gains the team's current codes, so the team's
    codes must sit inside the adder's effective set (escalation rule)."""
    org, mem = _member_org(db, org_id, actor_id)
    granter = _require_perm(db, org, mem, actor_id, "Teams.AssignMembers")
    team = _get_team(db, org_id, team_id)
    target = _live_membership(db, org_id, target_user_id)
    if target is None:
        raise NotFoundError("member not found")
    exists = db.execute(
        select(TeamMembership.id).where(
            TeamMembership.team_id == team.id, TeamMembership.membership_id == target.id)
    ).first()
    if exists:
        raise ConflictError("user is already a team member")
    _check_grantable(granter if not mem.is_root else set(PERMISSION_CATALOG), _team_codes(db, team.id))
    db.add(TeamMembership(team_id=team.id, membership_id=target.id))
    _audit(db, org_id, actor_id, "team.member_added", team_id=str(team.id),
           user_id=str(target_user_id))
    db.commit()
    return _read_team(db, team)


def remove_team_member(db: Session, actor_id: uuid.UUID, org_id: uuid.UUID, team_id: uuid.UUID,
                       target_user_id: uuid.UUID) -> None:
    """Roster removal drops only the link row. Root-protection precedent
    (remove_member): the root is never detached — transfer root first."""
    org, mem = _member_org(db, org_id, actor_id)
    _require_perm(db, org, mem, actor_id, "Teams.RemoveMembers")
    team = _get_team(db, org_id, team_id)
    # Any live membership (incl. suspended, whose rows are kept) is removable.
    target = _any_membership(db, org_id, target_user_id)
    if target is None:
        raise NotFoundError("member not found")
    if target.is_root:
        raise ConflictError("cannot remove the root from a team; transfer root first")
    link = db.execute(
        select(TeamMembership).where(
            TeamMembership.team_id == team.id, TeamMembership.membership_id == target.id)
    ).scalars().first()
    if link is None:
        raise NotFoundError("team member not found")
    db.delete(link)
    _audit(db, org_id, actor_id, "team.member_removed", team_id=str(team.id),
           user_id=str(target_user_id))
    db.commit()


def set_team_sets(db: Session, actor_id: uuid.UUID, org_id: uuid.UUID, team_id: uuid.UUID,
                  set_ids: list[uuid.UUID]) -> TeamDetail:
    """Replace-all set assignment (same shape as assign_sets). Single
    team.sets_assigned audit event per replace — not per-add/per-remove."""
    org, mem = _member_org(db, org_id, actor_id)
    granter = _require_perm(db, org, mem, actor_id, "Teams.AssignPermissionSets")
    team = _get_team(db, org_id, team_id)
    rows = _resolve_sets(db, org_id, list(set_ids or []))
    _reject_system_sets(rows)
    codes = sorted({c for r in rows for c in _set_codes(db, r.id)})
    _check_grantable(granter if not mem.is_root else set(PERMISSION_CATALOG), codes)
    db.query(TeamPermissionSet).filter(TeamPermissionSet.team_id == team.id).delete()
    for r in {r.id for r in rows}:
        db.add(TeamPermissionSet(team_id=team.id, set_id=r))
    _audit(db, org_id, actor_id, "team.sets_assigned", team_id=str(team.id),
           sets=[r.name for r in rows])
    db.commit()
    return _read_team(db, team)


def read_member(db: Session, org: Organization, mem: Membership) -> MemberRead:
    user = db.get(User, mem.user_id)
    set_ids = [
        r[0] for r in db.execute(
            select(MembershipPermissionSet.set_id).where(MembershipPermissionSet.membership_id == mem.id)
        ).all()
    ]
    names: list[str] = []
    if set_ids:
        names = sorted(
            r[0] for r in db.execute(
                select(PermissionSet.name).where(PermissionSet.id.in_(set_ids),
                                                PermissionSet.is_deleted.is_(False))
            ).all()
        )
    return MemberRead(
        user_id=mem.user_id, email=user.email if user else "", is_root=mem.is_root, state=mem.state,
        permission_sets=names, permissions=sorted(effective_permissions(db, org.id, mem.user_id)),
    )


def list_members(db: Session, user_id: uuid.UUID, org_id: uuid.UUID) -> list[MemberRead]:
    org, mem = _member_org(db, org_id, user_id)
    _require_perm(db, org, mem, user_id, "Members.Read")
    rows = db.execute(
        select(Membership).where(Membership.org_id == org_id, Membership.is_deleted.is_(False))
        .order_by(Membership.is_root.desc(), Membership.created_at)
    ).scalars().all()
    return [read_member(db, org, m) for m in rows]


# --- invitations & join requests --------------------------------------------------


def _expire_due(db: Session, org_id: uuid.UUID | None = None) -> None:
    now = datetime.now(timezone.utc)
    stmt = select(Invitation).where(
        Invitation.status == InvitationStatus.PENDING.value, Invitation.is_deleted.is_(False),
        Invitation.expires_at < now,
    )
    if org_id is not None:
        stmt = stmt.where(Invitation.org_id == org_id)
    for inv in db.execute(stmt).scalars().all():
        inv.status = InvitationStatus.EXPIRED.value
        _audit(db, inv.org_id, None, "invite.expired", invitation_id=str(inv.id), email=inv.email)
    db.flush()


def _find_user_by_email(db: Session, email: str) -> User | None:
    return db.execute(
        select(User).where(func.lower(User.email) == email.lower(), User.is_deleted.is_(False))
    ).scalars().first()


def _invite_link(token: str) -> str:
    # Public invitation entry point: unauthenticated users must land on the
    # invitation/profile-setup page, never on a login-gated route.
    return f"{get_settings().frontend_url.rstrip('/')}/invite/{token}"


def _send_invite_email(to: str, org_name: str, inviter: str, token: str) -> None:
    link = _invite_link(token)
    html = (
        f"<p>You have been invited to join <strong>{org_name}</strong> on ToLLma by {inviter}.</p>"
        f'<p><a href="{link}">Accept or decline the invitation</a></p>'
        f"<p>This invitation expires in 7 days.</p>"
    )
    route_email("org_invite", to, f"You are invited to join {org_name} on ToLLma", html, html)


def invite_user(db: Session, inviter_id: uuid.UUID, org_id: uuid.UUID, *,
                email: str, set_ids: list[uuid.UUID]) -> InvitationRead:
    org, mem = _member_org(db, org_id, inviter_id)
    granter = _require_perm(db, org, mem, inviter_id, "Members.Invite")
    email = email.strip().lower()
    existing = _find_user_by_email(db, email)
    if existing is not None and _live_membership(db, org_id, existing.id) is not None:
        raise ConflictError("user is already a member")
    _expire_due(db, org_id)
    dup = db.execute(
        select(Invitation.id).where(
            Invitation.org_id == org_id, Invitation.email == email,
            Invitation.kind == InvitationKind.INVITE.value,
            Invitation.status == InvitationStatus.PENDING.value, Invitation.is_deleted.is_(False))
    ).first()
    if dup:
        raise ConflictError("a pending invitation already exists for this email")
    rows = _resolve_sets(db, org_id, set_ids)
    codes = sorted({c for r in rows for c in _set_codes(db, r.id)})
    _check_grantable(granter if not mem.is_root else set(PERMISSION_CATALOG), codes)
    user = existing
    inv = Invitation(
        org_id=org_id, email=email, user_id=user.id if user else None, kind=InvitationKind.INVITE.value,
        status=InvitationStatus.PENDING.value, token=secrets.token_urlsafe(32),
        expires_at=datetime.now(timezone.utc) + timedelta(days=7),
        invited_by=inviter_id, set_ids=[str(s) for s in {r.id for r in rows}],
    )
    db.add(inv)
    db.flush()
    inviter = db.get(User, inviter_id)
    if user is not None:
        _notify(db, user.id, "invited", f"You have been invited to join {org.name}",
                org_id=org_id, invitation_id=str(inv.id),
                body=f"{inviter.email if inviter else 'Someone'} invited you to join {org.name}.")
    try:
        _send_invite_email(email, org.name, inviter.email if inviter else "your team", inv.token)
    except Exception:
        logger.exception("org invite email failed: org_id=%s", org_id)
    _audit(db, org_id, inviter_id, "member.invited", email=email, invitation_id=str(inv.id))
    db.commit()
    db.refresh(inv)
    return _read_invitation(db, inv, org.name)


def request_join(db: Session, user_id: uuid.UUID, org_id: uuid.UUID) -> InvitationRead:
    org = _get_org(db, org_id)
    if _live_membership(db, org_id, user_id) is not None:
        raise ConflictError("you are already a member")
    _expire_due(db, org_id)
    user = db.get(User, user_id)
    email = (user.email if user else "").lower()
    dup = db.execute(
        select(Invitation.id).where(
            Invitation.org_id == org_id, Invitation.email == email,
            Invitation.kind == InvitationKind.REQUEST.value,
            Invitation.status == InvitationStatus.PENDING.value, Invitation.is_deleted.is_(False))
    ).first()
    if dup:
        raise ConflictError("a pending join request already exists")
    inv = Invitation(
        org_id=org_id, email=email, user_id=user_id, kind=InvitationKind.REQUEST.value,
        status=InvitationStatus.PENDING.value, token=secrets.token_urlsafe(32),
        expires_at=datetime.now(timezone.utc) + timedelta(days=7),
        invited_by=user_id, set_ids=[],
    )
    db.add(inv)
    db.flush()
    for approver_id in _approver_ids(db, org_id):
        _notify(db, approver_id, "join_request.created", f"{email} requested to join {org.name}",
                org_id=org_id, invitation_id=str(inv.id))
    _audit(db, org_id, user_id, "member.requested", email=email, invitation_id=str(inv.id))
    db.commit()
    db.refresh(inv)
    return _read_invitation(db, inv, org.name)


def _approver_ids(db: Session, org_id: uuid.UUID) -> list[uuid.UUID]:
    ids: list[uuid.UUID] = []
    mems = db.execute(
        select(Membership).where(
            Membership.org_id == org_id, Membership.is_deleted.is_(False),
            Membership.state == MembershipState.ACTIVE.value)
    ).scalars().all()
    for m in mems:
        if m.is_root:
            ids.append(m.user_id)
            continue
        if effective_permissions(db, org_id, m.user_id) & {"Members.Invite", "Members.Approve", "Members.Update"}:
            ids.append(m.user_id)
    return ids


def _set_summaries(db: Session, set_ids: list[str]) -> list[PermissionSetSummary]:
    """Resolve invitation set ids (org sets + system sets) to name+codes."""
    out: list[PermissionSetSummary] = []
    for raw in set_ids or []:
        try:
            sid = uuid.UUID(str(raw))
        except (ValueError, TypeError, AttributeError):
            continue
        row = db.get(PermissionSet, sid)
        if row is None or row.is_deleted:
            continue
        out.append(PermissionSetSummary(id=str(row.id), name=row.name, codes=_set_codes(db, row.id)))
    return out


def _read_invitation(db: Session, inv: Invitation, org_name: str = "",
                     include_token: bool = False) -> InvitationRead:
    name = org_name
    slug = ""
    org = db.get(Organization, inv.org_id)
    if org is not None:
        slug = org.slug
        if not name:
            name = org.name
    inviter = db.get(User, inv.invited_by) if inv.invited_by else None
    return InvitationRead(
        id=inv.id, org_id=inv.org_id, org_name=name, email=inv.email, kind=inv.kind, status=inv.status,
        expires_at=inv.expires_at, invited_by=inv.invited_by, set_ids=list(inv.set_ids or []),
        created_at=inv.created_at, token=inv.token if include_token else None, org_slug=slug,
        invited_by_email=inviter.email if inviter else None,
        invited_by_name=(inviter.full_name if inviter else None),
        permission_sets=_set_summaries(db, list(inv.set_ids or [])),
    )


def list_invitations(db: Session, user_id: uuid.UUID, org_id: uuid.UUID,
                     status: str | None = None) -> list[InvitationRead]:
    org, mem = _member_org(db, org_id, user_id)
    _require_perm(db, org, mem, user_id, "Members.Read")
    _expire_due(db, org_id)
    db.commit()
    stmt = select(Invitation).where(
        Invitation.org_id == org_id, Invitation.kind == InvitationKind.INVITE.value,
        Invitation.is_deleted.is_(False)).order_by(Invitation.created_at.desc())
    if status:
        stmt = stmt.where(Invitation.status == status)
    return [_read_invitation(db, i, org.name) for i in db.execute(stmt).scalars().all()]


def list_requests(db: Session, user_id: uuid.UUID, org_id: uuid.UUID) -> list[InvitationRead]:
    org, mem = _member_org(db, org_id, user_id)
    perms = effective_permissions(db, org_id, user_id)
    if not (mem.is_root or perms & {"Members.Approve", "Members.Update"}):
        raise NotFoundError(_ORG_NOT_FOUND)
    _expire_due(db, org_id)
    db.commit()
    rows = db.execute(
        select(Invitation).where(
            Invitation.org_id == org_id, Invitation.kind == InvitationKind.REQUEST.value,
            Invitation.status == InvitationStatus.PENDING.value, Invitation.is_deleted.is_(False))
        .order_by(Invitation.created_at.desc())
    ).scalars().all()
    return [_read_invitation(db, i, org.name) for i in rows]


def my_invitations(db: Session, user_id: uuid.UUID) -> list[InvitationRead]:
    user = db.get(User, user_id)
    _expire_due(db)
    db.commit()
    rows = db.execute(
        select(Invitation).where(
            Invitation.kind == InvitationKind.INVITE.value,
            Invitation.status == InvitationStatus.PENDING.value, Invitation.is_deleted.is_(False),
            or_(Invitation.user_id == user_id,
                func.lower(Invitation.email) == (user.email.lower() if user else "")),
        ).order_by(Invitation.created_at.desc())
    ).scalars().all()
    return [_read_invitation(db, i, include_token=True) for i in rows]


def _load_token(db: Session, token: str) -> Invitation:
    inv = db.execute(
        select(Invitation).where(Invitation.token == token, Invitation.is_deleted.is_(False))
    ).scalars().first()
    if inv is None:
        raise NotFoundError("invitation not found")
    if inv.status != InvitationStatus.PENDING.value:
        raise ValidationError(f"invitation is {inv.status}")
    if inv.expires_at < datetime.now(timezone.utc):
        inv.status = InvitationStatus.EXPIRED.value
        _audit(db, inv.org_id, None, "invite.expired", invitation_id=str(inv.id), email=inv.email)
        db.commit()
        raise ValidationError("invitation expired")
    return inv


def _activate_membership(db: Session, org: Organization, user_id: uuid.UUID, set_ids: list[str]) -> Membership:
    mem = _any_membership(db, org.id, user_id)
    if mem is not None and mem.state == MembershipState.ACTIVE.value and not mem.is_deleted:
        raise ConflictError("user is already a member")
    if mem is None or mem.is_deleted:
        mem = Membership(org_id=org.id, user_id=user_id, is_root=False, state=MembershipState.ACTIVE.value)
        db.add(mem)
        db.flush()
    else:
        mem.state = MembershipState.ACTIVE.value
        db.query(MembershipPermissionSet).filter(MembershipPermissionSet.membership_id == mem.id).delete()
    if set_ids:
        rows = _resolve_sets(db, org.id, [uuid.UUID(s) for s in set_ids])
        for r in rows:
            db.add(MembershipPermissionSet(membership_id=mem.id, set_id=r.id))
    return mem


def accept_invitation(db: Session, user_id: uuid.UUID, token: str) -> OrgRead:
    inv = _load_token(db, token)
    user = db.get(User, user_id)
    if user is None or user.email.lower() != inv.email.lower():
        raise NotFoundError("invitation not found")
    if inv.kind != InvitationKind.INVITE.value:
        raise ValidationError("invitation cannot be accepted this way")
    org = _get_org(db, inv.org_id)
    inv.user_id = user_id
    mem = _activate_membership(db, org, user_id, list(inv.set_ids or []))
    inv.status = InvitationStatus.ACCEPTED.value
    _audit(db, org.id, user_id, "member.accepted", email=inv.email, invitation_id=str(inv.id))
    for approver_id in _approver_ids(db, org.id):
        if approver_id != user_id:
            _notify(db, approver_id, "invitation.accepted", f"{inv.email} joined {org.name}",
                    org_id=org.id, invitation_id=str(inv.id))
    db.commit()
    logger.info("invitation accepted: org_id=%s user_id=%s", org.id, user_id)
    return _read_org(db, org, user_id)


def reject_invitation(db: Session, user_id: uuid.UUID, token: str) -> None:
    inv = _load_token(db, token)
    user = db.get(User, user_id)
    if user is None or user.email.lower() != inv.email.lower():
        raise NotFoundError("invitation not found")
    inv.status = InvitationStatus.REJECTED.value
    _audit(db, inv.org_id, user_id, "member.rejected_invite", email=inv.email, invitation_id=str(inv.id))
    if inv.invited_by and inv.invited_by != user_id:
        _notify(db, inv.invited_by, "invitation.rejected", f"{inv.email} declined to join",
                org_id=inv.org_id, invitation_id=str(inv.id))
    db.commit()


def resend_invitation(db: Session, user_id: uuid.UUID, org_id: uuid.UUID,
                      invitation_id: uuid.UUID) -> InvitationRead:
    """Resend a pending invitation: fresh token (old invalidated), fresh 7-day
    expiry, audit event, recipient notified and re-emailed. Non-pending rows
    (accepted/rejected/expired/closed) are rejected."""
    org, mem = _member_org(db, org_id, user_id)
    _require_perm(db, org, mem, user_id, "Members.Invite")
    inv = db.get(Invitation, invitation_id)
    if inv is None or inv.is_deleted or inv.org_id != org_id:
        raise NotFoundError("invitation not found")
    if inv.kind != InvitationKind.INVITE.value:
        raise ValidationError("only invitations can be resent")
    if inv.status != InvitationStatus.PENDING.value:
        raise ValidationError(f"only pending invitations can be resent (status is {inv.status})")
    inv.token = secrets.token_urlsafe(32)
    inv.expires_at = datetime.now(timezone.utc) + timedelta(days=7)
    target = _find_user_by_email(db, inv.email)
    if target is not None:
        inv.user_id = target.id
        _notify(db, target.id, "invited", f"Reminder: you are invited to join {org.name}",
                org_id=org_id, invitation_id=str(inv.id),
                body="The invitation was resent. Your previous link no longer works.")
    inviter = db.get(User, user_id)
    try:
        _send_invite_email(inv.email, org.name, inviter.email if inviter else "your team", inv.token)
    except Exception:
        logger.exception("org invite resend email failed: org_id=%s", org_id)
    _audit(db, org_id, user_id, "invite.resent", email=inv.email, invitation_id=str(inv.id))
    db.commit()
    db.refresh(inv)
    logger.info("invitation resent: org_id=%s invitation_id=%s", org_id, inv.id)
    return _read_invitation(db, inv, org.name)


def cancel_invitation(db: Session, user_id: uuid.UUID, org_id: uuid.UUID, invitation_id: uuid.UUID) -> None:
    org, mem = _member_org(db, org_id, user_id)
    _require_perm(db, org, mem, user_id, "Members.Invite")
    inv = db.get(Invitation, invitation_id)
    if inv is None or inv.is_deleted or inv.org_id != org_id or inv.status != InvitationStatus.PENDING.value:
        raise NotFoundError("invitation not found")
    inv.status = InvitationStatus.CLOSED.value
    _audit(db, org_id, user_id, "invite.revoked", invitation_id=str(inv.id), email=inv.email)
    db.commit()


def approve_request(db: Session, approver_id: uuid.UUID, org_id: uuid.UUID,
                    invitation_id: uuid.UUID, set_ids: list[uuid.UUID]) -> MemberRead:
    org, mem = _member_org(db, org_id, approver_id)
    granter = effective_permissions(db, org_id, approver_id)
    if not (mem.is_root or granter & {"Members.Approve", "Members.Update"}):
        raise NotFoundError(_ORG_NOT_FOUND)
    inv = db.get(Invitation, invitation_id)
    if inv is None or inv.is_deleted or inv.org_id != org_id \
            or inv.kind != InvitationKind.REQUEST.value or inv.status != InvitationStatus.PENDING.value:
        raise NotFoundError("join request not found")
    if inv.expires_at < datetime.now(timezone.utc):
        inv.status = InvitationStatus.EXPIRED.value
        db.commit()
        raise ValidationError("join request expired")
    rows = _resolve_sets(db, org_id, set_ids)
    codes = sorted({c for r in rows for c in _set_codes(db, r.id)})
    _check_grantable(granter if not mem.is_root else set(PERMISSION_CATALOG), codes)
    target_id = inv.user_id
    if target_id is None:
        raise ValidationError("join request has no user")
    member = _activate_membership(db, org, target_id, [str(r.id) for r in rows])
    inv.status = InvitationStatus.ACCEPTED.value
    _audit(db, org_id, approver_id, "member.approved", user_id=str(target_id), invitation_id=str(inv.id))
    _notify(db, target_id, "join_request.approved", f"Your request to join {org.name} was approved",
            org_id=org_id)
    try:
        route_email("org_request_approved", inv.email, f"Welcome to {org.name} on ToLLma",
                    f"<p>Your request to join <strong>{org.name}</strong> was approved.</p>",
                    f"Your request to join {org.name} was approved.")
    except Exception:
        logger.exception("request-approved email failed: org_id=%s", org_id)
    db.commit()
    return read_member(db, org, member)


def reject_request(db: Session, approver_id: uuid.UUID, org_id: uuid.UUID, invitation_id: uuid.UUID) -> None:
    org, mem = _member_org(db, org_id, approver_id)
    granter = effective_permissions(db, org_id, approver_id)
    if not (mem.is_root or granter & {"Members.Approve", "Members.Update"}):
        raise NotFoundError(_ORG_NOT_FOUND)
    inv = db.get(Invitation, invitation_id)
    if inv is None or inv.is_deleted or inv.org_id != org_id \
            or inv.kind != InvitationKind.REQUEST.value or inv.status != InvitationStatus.PENDING.value:
        raise NotFoundError("join request not found")
    inv.status = InvitationStatus.REJECTED.value
    _audit(db, org_id, approver_id, "member.request_rejected", invitation_id=str(inv.id))
    if inv.user_id:
        _notify(db, inv.user_id, "join_request.rejected", f"Your request to join {org.name} was declined",
                org_id=org_id)
    db.commit()


def suspend_member(db: Session, actor_id: uuid.UUID, org_id: uuid.UUID, target_user_id: uuid.UUID) -> MemberRead:
    """Suspend: org access denied immediately, login/personal assets survive.
    Effective permissions evaluate to empty (only ACTIVE memberships count).
    Team roster rows are deliberately KEPT: the team leg already drops to
    empty via the membership state, and resume restores it automatically."""
    org, mem = _member_org(db, org_id, actor_id)
    _require_perm(db, org, mem, actor_id, "Members.Suspend")
    target = _live_membership(db, org_id, target_user_id)
    if target is None:
        raise NotFoundError("member not found")
    if target.is_root:
        raise ConflictError("cannot suspend the root")
    target.state = MembershipState.SUSPENDED.value
    _revoke_member_keys(db, org_id, target_user_id, reason="member.suspended", actor_id=actor_id)
    _audit(db, org_id, actor_id, "member.suspended", user_id=str(target_user_id))
    _notify(db, target_user_id, "member.suspended", f"Your membership in {org.name} was suspended",
            org_id=org_id)
    db.commit()
    logger.info("member suspended: org_id=%s user_id=%s", org_id, target_user_id)
    return read_member(db, org, target)


def resume_member(db: Session, actor_id: uuid.UUID, org_id: uuid.UUID, target_user_id: uuid.UUID) -> MemberRead:
    """Resume a suspended member: access returns per assigned permission sets."""
    org, mem = _member_org(db, org_id, actor_id)
    _require_perm(db, org, mem, actor_id, "Members.Suspend")
    target = _any_membership(db, org_id, target_user_id)
    if target is None or target.is_deleted or target.state != MembershipState.SUSPENDED.value:
        raise NotFoundError("suspended member not found")
    target.state = MembershipState.ACTIVE.value
    _audit(db, org_id, actor_id, "member.resumed", user_id=str(target_user_id))
    _notify(db, target_user_id, "member.resumed", f"Your membership in {org.name} was reactivated",
            org_id=org_id)
    db.commit()
    logger.info("member resumed: org_id=%s user_id=%s", org_id, target_user_id)
    return read_member(db, org, target)


def remove_member(db: Session, actor_id: uuid.UUID, org_id: uuid.UUID, target_user_id: uuid.UUID) -> None:
    org, mem = _member_org(db, org_id, actor_id)
    _require_perm(db, org, mem, actor_id, "Members.Remove")
    target = _live_membership(db, org_id, target_user_id)
    if target is None:
        raise NotFoundError("member not found")
    if target.is_root:
        raise ConflictError("cannot remove the root; transfer root first")
    target.state = MembershipState.REMOVED.value
    target.is_deleted = True
    target.deleted_by = actor_id
    target.deleted_at = datetime.now(timezone.utc)
    # Membership-keyed team roster rows die with the membership; the team
    # itself and every other member are untouched.
    db.query(TeamMembership).filter(TeamMembership.membership_id == target.id).delete()
    _revoke_member_keys(db, org_id, target_user_id, reason="member.removed", actor_id=actor_id)
    _audit(db, org_id, actor_id, "member.removed", user_id=str(target_user_id))
    _notify(db, target_user_id, "member.removed", f"You were removed from {org.name}", org_id=org_id)
    db.commit()
    logger.info("member removed: org_id=%s user_id=%s", org_id, target_user_id)


def leave_organization(db: Session, user_id: uuid.UUID, org_id: uuid.UUID) -> None:
    org, mem = _member_org(db, org_id, user_id)
    if mem.is_root:
        raise ConflictError("root cannot leave; transfer root first")
    mem.state = MembershipState.REMOVED.value
    mem.is_deleted = True
    mem.deleted_by = user_id
    mem.deleted_at = datetime.now(timezone.utc)
    # Self-removal drops the leaver's team roster rows like an admin removal.
    db.query(TeamMembership).filter(TeamMembership.membership_id == mem.id).delete()
    # Self-removal revokes the leaver's org keys like an admin removal does.
    _revoke_member_keys(db, org_id, user_id, reason="member.left", actor_id=user_id)
    _audit(db, org.id, user_id, "member.left")
    db.commit()


def get_audit(db: Session, user_id: uuid.UUID, org_id: uuid.UUID, limit: int = 100) -> list[AuditRead]:
    org, mem = _member_org(db, org_id, user_id)
    _require_perm(db, org, mem, user_id, "Audit.Read")
    rows = db.execute(
        select(AuditLog).where(AuditLog.org_id == org_id)
        .order_by(AuditLog.created_at.desc()).limit(min(max(limit, 1), 200))
    ).scalars().all()
    return [AuditRead(id=r.id, action=r.action, actor_user_id=r.actor_user_id, target=dict(r.target or {}),
                      created_at=r.created_at) for r in rows]


# --- Phase B: org keys ----------------------------------------------------------
#
# Org-scoped keys (`api_keys.org_id` set): issued by a member to an ACTIVE
# member, budgeted against the org cap, revoked on membership loss. Raw keys
# are shown once at issuance and never stored. Personal keys (`org_id` NULL)
# are managed exclusively through `api/keys/service.py` and never appear here.


def active_org_ids(db: Session, user_id: uuid.UUID) -> set[uuid.UUID]:
    """Org ids where `user_id` holds ACTIVE, live membership."""
    return set(
        r[0] for r in db.execute(
            select(Membership.org_id).where(
                Membership.user_id == user_id,
                Membership.is_deleted.is_(False),
                Membership.state == MembershipState.ACTIVE.value,
            )
        ).all()
    )


def _org_key_select():
    from tollms.models.api_key import ApiKey

    return (
        select(ApiKey)
        .where(ApiKey.is_deleted.is_(False))
        .options(
            selectinload(ApiKey.policy),
            selectinload(ApiKey.model_permissions),
        )
    )


def _read_org_key(db: Session, key) -> OrgKeyRead:
    assignee = db.get(User, key.user_id)
    return OrgKeyRead(
        id=key.id, org_id=key.org_id, assignee_user_id=key.user_id,
        assignee_email=assignee.email if assignee else None,
        issued_by=key.issued_by, name=key.name, description=key.description,
        key_prefix=key.key_prefix, masked=keys_service.masked_prefix(key.key_prefix),
        enabled=key.enabled, expires_at=key.expires_at, last_used_at=key.last_used_at,
        rotation_count=key.rotation_count,
        policy=key.policy, model_permissions=list(key.model_permissions or []),
        created_at=key.created_at, updated_at=key.updated_at,
    )


def _allocated_budget(db: Session, org_id: uuid.UUID) -> Decimal:
    """SUM(policy.max_budget_usd) over live org keys (NULL budgets count 0)."""
    from tollms.models.api_key import ApiKey, ApiKeyPolicy

    total = db.scalar(
        select(func.coalesce(func.sum(ApiKeyPolicy.max_budget_usd), 0))
        .join(ApiKey, ApiKey.id == ApiKeyPolicy.api_key_id)
        .where(
            ApiKey.org_id == org_id, ApiKey.is_deleted.is_(False),
            ApiKey.enabled.is_(True),
        )
    )
    return Decimal(str(total or 0))


def create_org_key(
    db: Session, caller_id: uuid.UUID, org_id: uuid.UUID, *, assignee_user_id: uuid.UUID,
    name: str, description: str | None, max_budget_usd: Decimal | None,
    model_permissions: list,
) -> tuple:
    """Issue an org key to an ACTIVE member. Gates (all 404-oracle except budget):

    - caller ACTIVE member + ``Keys.Create`` (strangers denied as 404);
    - assignee ACTIVE member (else 404);
    - every listed model scope visible to the granter (escalation rule);
    - org cap: allocated + new <= max_spend (else 422).
    """
    from tollms.api.keys.schemas import ApiKeyCreate, PolicyIn
    from tollms.models.api_key import ApiKey
    from tollms.services.observability.events import emit

    org, mem = _member_org(db, org_id, caller_id)
    granter = _require_perm(db, org, mem, caller_id, "Keys.Create")
    assignee = _live_membership(db, org_id, assignee_user_id)
    if assignee is None:
        raise NotFoundError("member not found")
    data = ApiKeyCreate(
        name=name, description=description,
        policy=PolicyIn(max_budget_usd=max_budget_usd) if max_budget_usd is not None else None,
        model_permissions=list(model_permissions or []),
    )
    parts = keys_service.prepare_key_parts(
        db, data, caller_id, visible_org_ids=active_org_ids(db, caller_id),
        key_org_id=org_id,
    )
    _ = granter  # visibility (not code-grant) gates model scope per spec
    if org.max_spend is not None:
        new_budget = max_budget_usd or Decimal("0")
        if _allocated_budget(db, org_id) + new_budget > Decimal(str(org.max_spend)):
            raise ValidationError(
                f"org budget cap exceeded: allocated + {new_budget} > {org.max_spend}"
            )
    api_key, raw_key = keys_service.persist_key(
        db, parts, user_id=assignee_user_id, org_id=org_id, issued_by=caller_id,
    )
    db.flush()
    stored = db.scalar(_org_key_select().where(ApiKey.id == api_key.id))
    emit("key.issued", key_id=str(api_key.id), org_id=str(org_id),
         user_id=str(assignee_user_id), issued_by=str(caller_id))
    _audit(db, org_id, caller_id, "key.issued", key_id=str(api_key.id),
           user_id=str(assignee_user_id))
    db.commit()
    logger.info("org key issued: %s org=%s assignee=%s", api_key.id, org_id, assignee_user_id)
    return _read_org_key(db, stored), raw_key


def list_org_keys(db: Session, caller_id: uuid.UUID, org_id: uuid.UUID) -> list[OrgKeyRead]:
    """Metadata only — never hashes or raw key material."""
    from tollms.models.api_key import ApiKey

    org, mem = _member_org(db, org_id, caller_id)
    _require_perm(db, org, mem, caller_id, "Keys.Read")
    rows = db.scalars(
        _org_key_select()
        .where(ApiKey.org_id == org_id)
        .order_by(ApiKey.created_at.desc())
    ).all()
    return [_read_org_key(db, k) for k in rows]


def revoke_org_key(db: Session, caller_id: uuid.UUID, org_id: uuid.UUID,
                   key_id: uuid.UUID) -> None:
    """Revoke one org key: enabled=False + soft-delete. Never reactivates —
    re-issuance is always a new row."""
    from tollms.models.api_key import ApiKey
    from tollms.services.api_keys import keys as key_engine
    from tollms.services.observability.events import emit

    org, mem = _member_org(db, org_id, caller_id)
    _require_perm(db, org, mem, caller_id, "Keys.Revoke")
    key = db.scalar(
        _org_key_select().where(ApiKey.id == key_id, ApiKey.org_id == org_id)
    )
    if key is None:
        raise NotFoundError("api key not found")
    key_hash = key.key_hash
    key.enabled = False
    key.is_deleted = True
    key.deleted_at = datetime.now(timezone.utc)
    key.deleted_by = caller_id
    _audit(db, org_id, caller_id, "key.revoked", key_id=str(key_id),
           user_id=str(key.user_id))
    db.commit()
    key_engine.invalidate_context(key_hash)
    key_engine.write_tombstone(key_hash)
    emit("key.revoked", key_id=str(key_id), org_id=str(org_id), user_id=str(caller_id))
    logger.info("org key revoked: %s org=%s", key_id, org_id)


def _revoke_member_keys(db: Session, org_id: uuid.UUID, user_id: uuid.UUID, *,
                        reason: str, actor_id: uuid.UUID | None) -> None:
    """Revoke ALL live org keys assigned to `user_id` in `org_id`.

    Called from remove/suspend/leave. Resume/approve NEVER restore keys:
    re-issuance is always a new row. Other members' keys and the user's
    personal keys are untouched.
    """
    from tollms.models.api_key import ApiKey
    from tollms.services.api_keys import keys as key_engine
    from tollms.services.observability.events import emit

    rows = db.scalars(
        select(ApiKey).where(
            ApiKey.org_id == org_id, ApiKey.user_id == user_id,
            ApiKey.is_deleted.is_(False),
        )
    ).all()
    for key in rows:
        key_hash = key.key_hash
        key.enabled = False
        key.is_deleted = True
        key.deleted_at = datetime.now(timezone.utc)
        key.deleted_by = actor_id
        _audit(db, org_id, actor_id, "key.revoked", key_id=str(key.id),
               user_id=str(user_id), reason=reason)
        emit("key.revoked", key_id=str(key.id), org_id=str(org_id),
             user_id=str(user_id), reason=reason)
        try:
            key_engine.invalidate_context(key_hash)
            key_engine.write_tombstone(key_hash)
        except Exception:
            logger.warning("org key revocation cache cleanup failed: %s", key.id, exc_info=True)
    if rows:
        logger.info("org keys revoked on %s: user=%s count=%d", reason, user_id, len(rows))
    db.flush()


# --- Phase B: org providers -------------------------------------------------------


def create_org_provider(db: Session, caller_id: uuid.UUID, org_id: uuid.UUID,
                        data) -> object:
    """Create an org-scoped provider (org_id=org, user_id=caller for audit)."""
    from tollms.api.providers import service as provider_service
    from tollms.services.observability.events import emit

    org, mem = _member_org(db, org_id, caller_id)
    _require_perm(db, org, mem, caller_id, "Providers.Create")
    provider = provider_service.create_provider(db, data, caller_id, org_id=org_id)
    _audit(db, org_id, caller_id, "provider.created", provider_id=str(provider.id),
           provider_name=provider.name)
    emit("provider.created", provider_id=str(provider.id), org_id=str(org_id),
         user_id=str(caller_id))
    return provider


def list_org_providers(db: Session, caller_id: uuid.UUID, org_id: uuid.UUID) -> list:
    """Providers scoped to one org (config visible; secrets stay masked)."""
    from tollms.models.provider import Provider

    org, mem = _member_org(db, org_id, caller_id)
    _require_perm(db, org, mem, caller_id, "Providers.Read")
    stmt = (
        select(Provider)
        .where(Provider.org_id == org_id, Provider.is_deleted.is_(False))
        .order_by(Provider.created_at)
    )
    return list(db.scalars(stmt))


def update_org_provider(db: Session, caller_id: uuid.UUID, org_id: uuid.UUID,
                        provider_id: uuid.UUID, data) -> object:
    """Update an org provider: Providers.Update + same-org membership."""
    from tollms.api.providers import service as provider_service

    org, mem = _member_org(db, org_id, caller_id)
    _require_perm(db, org, mem, caller_id, "Providers.Update")
    provider = provider_service.get_provider(db, provider_id, caller_id)
    if provider.org_id != org_id:
        raise NotFoundError("provider not found")
    updated = provider_service.update_provider(db, provider_id, data, caller_id)
    _audit(db, org_id, caller_id, "provider.updated", provider_id=str(provider_id))
    db.commit()
    return updated


def delete_org_provider(db: Session, caller_id: uuid.UUID, org_id: uuid.UUID,
                        provider_id: uuid.UUID) -> None:
    """Delete an org provider: Providers.Delete + same-org membership."""
    from tollms.api.providers import service as provider_service
    from tollms.services.observability.events import emit

    org, mem = _member_org(db, org_id, caller_id)
    _require_perm(db, org, mem, caller_id, "Providers.Delete")
    provider = provider_service.get_provider(db, provider_id, caller_id)
    if provider.org_id != org_id:
        raise NotFoundError("provider not found")
    provider_service.delete_provider(db, provider_id, caller_id)
    _audit(db, org_id, caller_id, "provider.deleted", provider_id=str(provider_id))
    emit("provider.deleted", provider_id=str(provider_id), org_id=str(org_id),
         user_id=str(caller_id))


# --- Phase B: budgets ---------------------------------------------------------------


def get_budget(db: Session, caller_id: uuid.UUID, org_id: uuid.UUID) -> BudgetRead:
    """{max_spend, allocated, unallocated}. Gates: Budgets.Read/Update or
    Analytics.ViewUsage (strangers denied as 404)."""
    org, mem = _member_org(db, org_id, caller_id)
    perms = effective_permissions(db, org_id, caller_id)
    if not (mem.is_root or perms & {"Budgets.Read", "Budgets.Update", "Analytics.ViewUsage"}):
        raise NotFoundError(_ORG_NOT_FOUND)
    allocated = _allocated_budget(db, org_id)
    cap = Decimal(str(org.max_spend)) if org.max_spend is not None else None
    return BudgetRead(
        max_spend=cap, allocated=allocated,
        unallocated=(cap - allocated) if cap is not None else None,
    )


def set_budget_cap(db: Session, caller_id: uuid.UUID, org_id: uuid.UUID,
                   max_spend: Decimal | None) -> BudgetRead:
    """Set or clear the org spend cap. A cap below allocated is rejected (422)."""
    from tollms.services.observability.events import emit

    org, mem = _member_org(db, org_id, caller_id)
    _require_perm(db, org, mem, caller_id, "Budgets.Update")
    if max_spend is not None and max_spend < 0:
        raise ValidationError("max_spend must be >= 0")
    allocated = _allocated_budget(db, org_id)
    if max_spend is not None and Decimal(str(max_spend)) < allocated:
        raise ValidationError(
            f"cap {max_spend} is below allocated {allocated}: revoke keys first"
        )
    org.max_spend = max_spend
    _audit(db, org_id, caller_id, "budget.cap_changed",
           max_spend=str(max_spend) if max_spend is not None else None)
    emit("budget.cap_changed", org_id=str(org_id), user_id=str(caller_id),
         max_spend=str(max_spend) if max_spend is not None else None)
    db.commit()
    db.refresh(org)
    logger.info("org budget cap changed: org=%s max_spend=%s", org_id, max_spend)
    return get_budget(db, caller_id, org_id)


# --- Phase B: analytics ---------------------------------------------------------------
#
# Org usage ledger from request_logs + api_request_logs WHERE org_id=org.
# Metadata only — these tables never hold prompts or responses. Team-level
# scoping is explicitly OUT (teams UI is a placeholder); org level only.


def org_analytics_overview(db: Session, caller_id: uuid.UUID,
                           org_id: uuid.UUID) -> AnalyticsOverview:
    """Org usage overview. Gates: ACTIVE membership + Analytics.ViewUsage
    (strangers denied as 404). Cost fields are included only when the caller
    also holds Analytics.ViewCost, else null."""
    from tollms.models.api_key import ApiRequestLog
    from tollms.models.provider import Provider
    from tollms.models.registered_model import AIModel
    from tollms.models.request_log import RequestLog

    org, mem = _member_org(db, org_id, caller_id)
    perms = effective_permissions(db, org_id, caller_id)
    if "Analytics.ViewUsage" not in perms and not mem.is_root:
        raise NotFoundError(_ORG_NOT_FOUND)
    show_cost = bool(mem.is_root or "Analytics.ViewCost" in perms)

    def _money(value) -> Decimal | None:
        return Decimal(str(value or 0)) if show_cost else None

    in_app = db.execute(
        select(
            func.count(RequestLog.id),
            func.coalesce(func.sum(RequestLog.total_tokens), 0),
            func.coalesce(func.sum(RequestLog.total_cost), 0),
        ).where(RequestLog.org_id == org_id, RequestLog.status == "success")
    ).one()
    via_api = db.execute(
        select(
            func.count(ApiRequestLog.id),
            func.coalesce(func.sum(ApiRequestLog.total_tokens), 0),
            func.coalesce(func.sum(ApiRequestLog.cost), 0),
        ).where(ApiRequestLog.org_id == org_id, ApiRequestLog.status == "success")
    ).one()
    totals = AnalyticsTotals(
        requests=int(in_app[0] or 0) + int(via_api[0] or 0),
        tokens=int(in_app[1] or 0) + int(via_api[1] or 0),
        cost=_money(Decimal(str(in_app[2] or 0)) + Decimal(str(via_api[2] or 0))),
    )

    day_bucket_in = func.date_trunc("day", RequestLog.created_at)
    day_bucket_api = func.date_trunc("day", ApiRequestLog.created_at)
    day_rows_in = db.execute(
        select(
            day_bucket_in, func.count(RequestLog.id),
            func.coalesce(func.sum(RequestLog.total_tokens), 0),
            func.coalesce(func.sum(RequestLog.total_cost), 0),
        ).where(RequestLog.org_id == org_id, RequestLog.status == "success").group_by(day_bucket_in)
    ).all()
    day_rows_api = db.execute(
        select(
            day_bucket_api, func.count(ApiRequestLog.id),
            func.coalesce(func.sum(ApiRequestLog.total_tokens), 0),
            func.coalesce(func.sum(ApiRequestLog.cost), 0),
        ).where(ApiRequestLog.org_id == org_id, ApiRequestLog.status == "success").group_by(day_bucket_api)
    ).all()
    by_day_map: dict[str, dict] = {}
    for bucket, reqs, toks, cost in list(day_rows_in) + list(day_rows_api):
        day = bucket.date().isoformat() if hasattr(bucket, "date") else str(bucket)
        cell = by_day_map.setdefault(day, {"requests": 0, "tokens": 0, "cost": Decimal("0")})
        cell["requests"] += int(reqs or 0)
        cell["tokens"] += int(toks or 0)
        cell["cost"] += Decimal(str(cost or 0))
    by_day = [
        AnalyticsDayPoint(date=day, requests=cell["requests"], tokens=cell["tokens"],
                          cost=_money(cell["cost"]))
        for day, cell in sorted(by_day_map.items())
    ]

    model_rows_in = db.execute(
        select(
            AIModel.model_id, func.count(RequestLog.id),
            func.coalesce(func.sum(RequestLog.total_tokens), 0),
            func.coalesce(func.sum(RequestLog.total_cost), 0),
        ).join(AIModel, AIModel.id == RequestLog.model_id, isouter=True)
        .where(RequestLog.org_id == org_id, RequestLog.status == "success").group_by(AIModel.model_id)
    ).all()
    model_rows_api = db.execute(
        select(
            ApiRequestLog.model, func.count(ApiRequestLog.id),
            func.coalesce(func.sum(ApiRequestLog.total_tokens), 0),
            func.coalesce(func.sum(ApiRequestLog.cost), 0),
        ).where(ApiRequestLog.org_id == org_id, ApiRequestLog.status == "success").group_by(ApiRequestLog.model)
    ).all()
    by_model_map: dict[str, dict] = {}
    for label, reqs, toks, cost in list(model_rows_in) + list(model_rows_api):
        cell = by_model_map.setdefault(label or "unknown", {"requests": 0, "tokens": 0, "cost": Decimal("0")})
        cell["requests"] += int(reqs or 0)
        cell["tokens"] += int(toks or 0)
        cell["cost"] += Decimal(str(cost or 0))
    by_model = [
        AnalyticsModelRow(model=label, requests=cell["requests"], tokens=cell["tokens"],
                          cost=_money(cell["cost"]))
        for label, cell in sorted(by_model_map.items(), key=lambda kv: -kv[1]["requests"])
    ]

    prov_rows_in = db.execute(
        select(
            Provider.name, func.count(RequestLog.id),
            func.coalesce(func.sum(RequestLog.total_tokens), 0),
            func.coalesce(func.sum(RequestLog.total_cost), 0),
        ).join(Provider, Provider.id == RequestLog.provider_id, isouter=True)
        .where(RequestLog.org_id == org_id, RequestLog.status == "success").group_by(Provider.name)
    ).all()
    prov_rows_api = db.execute(
        select(
            ApiRequestLog.provider, func.count(ApiRequestLog.id),
            func.coalesce(func.sum(ApiRequestLog.total_tokens), 0),
            func.coalesce(func.sum(ApiRequestLog.cost), 0),
        ).where(ApiRequestLog.org_id == org_id, ApiRequestLog.status == "success").group_by(ApiRequestLog.provider)
    ).all()
    by_prov_map: dict[str, dict] = {}
    for label, reqs, toks, cost in list(prov_rows_in) + list(prov_rows_api):
        cell = by_prov_map.setdefault(label or "unknown", {"requests": 0, "tokens": 0, "cost": Decimal("0")})
        cell["requests"] += int(reqs or 0)
        cell["tokens"] += int(toks or 0)
        cell["cost"] += Decimal(str(cost or 0))
    by_provider = [
        AnalyticsProviderRow(provider=label, requests=cell["requests"], tokens=cell["tokens"],
                             cost=_money(cell["cost"]))
        for label, cell in sorted(by_prov_map.items(), key=lambda kv: -kv[1]["requests"])
    ]

    user_rows_in = db.execute(
        select(
            RequestLog.user_id, func.count(RequestLog.id),
            func.coalesce(func.sum(RequestLog.total_tokens), 0),
            func.coalesce(func.sum(RequestLog.total_cost), 0),
        ).where(RequestLog.org_id == org_id, RequestLog.status == "success").group_by(RequestLog.user_id)
    ).all()
    user_rows_api = db.execute(
        select(
            ApiRequestLog.user_id, func.count(ApiRequestLog.id),
            func.coalesce(func.sum(ApiRequestLog.total_tokens), 0),
            func.coalesce(func.sum(ApiRequestLog.cost), 0),
        ).where(ApiRequestLog.org_id == org_id, ApiRequestLog.status == "success").group_by(ApiRequestLog.user_id)
    ).all()
    by_user_map: dict[str | None, dict] = {}
    for uid, reqs, toks, cost in list(user_rows_in) + list(user_rows_api):
        cell = by_user_map.setdefault(str(uid) if uid else None, {"requests": 0, "tokens": 0, "cost": Decimal("0")})
        cell["requests"] += int(reqs or 0)
        cell["tokens"] += int(toks or 0)
        cell["cost"] += Decimal(str(cost or 0))
    by_user: list[AnalyticsUserRow] = []
    for uid_str, cell in sorted(by_user_map.items(), key=lambda kv: -kv[1]["requests"]):
        uid = uuid.UUID(uid_str) if uid_str else None
        user = db.get(User, uid) if uid else None
        live = (
            _live_membership(db, org_id, uid) is not None if uid is not None else False
        )
        by_user.append(AnalyticsUserRow(
            user_id=uid, email=user.email if user else None,
            removed_badge=bool(uid is not None and not live),
            requests=cell["requests"], tokens=cell["tokens"], cost=_money(cell["cost"]),
        ))

    return AnalyticsOverview(
        totals=totals, by_day=by_day, by_model=by_model,
        by_provider=by_provider, by_user=by_user,
    )


# --- Phase B: public invitation preview ----------------------------------------------


def preview_invitation(db: Session, token: str) -> InvitePreview:
    """Public invitation preview (no auth; caller rate-limits).

    Returns display metadata ONLY for pending + unexpired invitations
    (lazy-expiring due rows first). Invalid, expired and consumed tokens all
    raise the identical 404 body (no oracle).
    """
    _expire_due(db)
    try:
        db.commit()
    except Exception:
        db.rollback()
    inv = db.execute(
        select(Invitation).where(Invitation.token == token, Invitation.is_deleted.is_(False))
    ).scalars().first()
    if inv is None or inv.kind != InvitationKind.INVITE.value \
            or inv.status != InvitationStatus.PENDING.value \
            or inv.expires_at < datetime.now(timezone.utc):
        raise NotFoundError("invitation not found")
    org = db.get(Organization, inv.org_id)
    if org is None or org.is_deleted or org.status != OrgStatus.ACTIVE.value:
        raise NotFoundError("invitation not found")
    inviter = db.get(User, inv.invited_by) if inv.invited_by else None
    return InvitePreview(
        org_name=org.name, org_slug=org.slug, email=inv.email,
        invited_by=InviterRef(
            name=inviter.full_name if inviter else None,
            email=inviter.email if inviter else None,
        ),
        permission_sets=_set_summaries(db, list(inv.set_ids or [])),
        expires_at=inv.expires_at,
    )


# --- Phase B: public new-account invite accept / reject -----------------------

_INVITE_NOT_FOUND = "invitation not found"


class InviteAccountExistsError(ConflictError):
    """409 when the invited address already owns an account.

    Lives here (not in core) so the orgs package owns its wire code without
    touching the shared taxonomy: status stays 409, only `error.code`
    becomes INVITE_ACCOUNT_EXISTS so the client routes to login.
    """

    def to_payload(self) -> dict:
        payload = super().to_payload()
        payload["error"]["code"] = "INVITE_ACCOUNT_EXISTS"
        return payload


def _load_public_invitation(db: Session, token: str) -> tuple[Invitation, Organization]:
    """Public by-token gate: kind=invite, pending, unexpired, org live.

    Unknown, tampered, consumed, rejected and expired tokens (and dead orgs)
    all raise the IDENTICAL 404 body (no existence oracle).
    """
    _expire_due(db)
    try:
        db.commit()
    except Exception:
        db.rollback()
    inv = db.execute(
        select(Invitation).where(Invitation.token == token, Invitation.is_deleted.is_(False))
    ).scalars().first()
    if inv is None or inv.kind != InvitationKind.INVITE.value \
            or inv.status != InvitationStatus.PENDING.value \
            or inv.expires_at < datetime.now(timezone.utc):
        raise NotFoundError(_INVITE_NOT_FOUND)
    org = db.get(Organization, inv.org_id)
    if org is None or org.is_deleted or org.status != OrgStatus.ACTIVE.value:
        raise NotFoundError(_INVITE_NOT_FOUND)
    return inv, org


def _live_invite_set_ids(db: Session, org_id: uuid.UUID, set_ids: list[str]) -> list[uuid.UUID]:
    """Invitation sets that are still assignable: live custom sets of the same
    org plus live system sets. Deleted/foreign/garbage ids are silently
    skipped — invitation-time validation already gated them; sets deleted
    since are gone, never a reason to fail the accept."""
    live: set[uuid.UUID] = set()
    for raw in set_ids or []:
        try:
            sid = uuid.UUID(str(raw))
        except (ValueError, TypeError, AttributeError):
            continue
        row = db.get(PermissionSet, sid)
        if row is None or row.is_deleted:
            continue
        if row.org_id is not None and row.org_id != org_id:
            continue
        live.add(row.id)
    return sorted(live)


async def accept_new_invitation(
    db: Session, token: str, *, full_name: str, password: str, email: str | None,
    user_agent: str | None = None, ip: str | None = None,
) -> tuple[AcceptNewResponse, str | None, str | None]:
    """Atomic public accept: create the account, join the org, consume the invite.

    Single commit covers user + membership + sets + invitation + audit; the
    login session is issued only AFTER the commit via login's exact issuance
    path. Returns (response, access_token, refresh_token) — tokens are None
    with session_issued=False when the Valkey session write failed post-commit
    (account exists, invite consumed: the client logs in normally).
    """
    inv, org = _load_public_invitation(db, token)
    invite_email = auth_service.normalize_email(inv.email)
    if email is not None and auth_service.normalize_email(email) != invite_email:
        raise ValidationError("email does not match the invitation")
    if _find_user_by_email(db, invite_email) is not None:
        # No state changed: the caller already owns an account and must use
        # the login-then-accept path instead.
        raise InviteAccountExistsError(
            "an account with this email already exists; log in to accept the invitation"
        )
    user = User(email=invite_email, full_name=(full_name or "").strip() or None)
    auth_service.set_local_identity(user)
    auth_service.set_password(user, password)  # exact signup strength policy (422 on weak)
    # Token possession proves mailbox control at least as strongly as the
    # verification link (single-use secret, 7-day TTL, emailed to this
    # address): no separate verification round-trip is needed.
    user.email_verified = True
    user.last_login_at = datetime.now(timezone.utc)
    db.add(user)
    db.flush()
    inv.user_id = user.id
    mem = _live_membership(db, org.id, user.id)
    if mem is None:
        # A brand-new user cannot hold a membership yet; this branch always
        # wins outside of races. Reuse (never duplicate) if one somehow does.
        mem = Membership(org_id=org.id, user_id=user.id, is_root=False,
                         state=MembershipState.ACTIVE.value)
        db.add(mem)
        db.flush()
        for sid in _live_invite_set_ids(db, org.id, list(inv.set_ids or [])):
            db.add(MembershipPermissionSet(membership_id=mem.id, set_id=sid))
    inv.status = InvitationStatus.ACCEPTED.value
    _audit(db, org.id, user.id, "member.accepted", email=inv.email, invitation_id=str(inv.id))
    for approver_id in _approver_ids(db, org.id):
        if approver_id != user.id:
            _notify(db, approver_id, "invitation.accepted", f"{inv.email} joined {org.name}",
                    org_id=org.id, invitation_id=str(inv.id))
    db.commit()
    db.refresh(user)
    logger.info("invitation accepted by new account: org_id=%s user_id=%s", org.id, user.id)
    try:
        refresh_jti = security.generate_refresh_jti()
        session_id = await security.create_session(
            user.id, user.email, "password", user_agent=user_agent, ip=ip,
            refresh_jti=refresh_jti,
        )
    except Exception:
        # Degradation, never rollback: the atomic commit above already created
        # the user + membership and consumed the invite. The client must log in
        # normally (flagged below); nothing is lost.
        logger.warning("accept-new session issuance failed after commit: user_id=%s",
                       user.id, exc_info=True)
        return (
            AcceptNewResponse(user=auth_service.read_user(user), org_id=org.id,
                              access_token=None, refresh_token=None, session_issued=False),
            None, None,
        )
    access = security.create_access_token(user.id, user.email, session_id)
    refresh = security.create_refresh_token(user.id, session_id, refresh_jti)
    return (
        AcceptNewResponse(user=auth_service.read_user(user), org_id=org.id,
                          access_token=access, refresh_token=refresh, session_issued=True),
        access, refresh,
    )


def reject_new_invitation(db: Session, token: str) -> RejectNewResponse:
    """Public invite decline: same pending gate + identical 404 oracle as the
    accept path. Consumes the invitation only — creates NO user, NO
    membership. The inviter is notified via the existing rejected notifier."""
    inv, _org = _load_public_invitation(db, token)
    inv.status = InvitationStatus.REJECTED.value
    _audit(db, inv.org_id, None, "member.rejected_invite", email=inv.email,
           invitation_id=str(inv.id))
    if inv.invited_by:
        _notify(db, inv.invited_by, "invitation.rejected", f"{inv.email} declined to join",
                org_id=inv.org_id, invitation_id=str(inv.id))
    db.commit()
    return RejectNewResponse()
