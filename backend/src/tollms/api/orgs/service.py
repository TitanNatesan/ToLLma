"""Organizations Phase A service: orgs, permission sets, invitations,
join-requests, members, audit, search. Cross-org reads raise NotFoundError
(404 oracle, never 403)."""

import logging
import re
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from tollms.api.orgs.schemas import (
    AuditRead,
    InvitationRead,
    MemberRead,
    OrgCard,
    OrgRead,
    PermissionSetRead,
)
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
    of assigned live sets (custom org sets + assigned system sets). Everyone
    else (suspended/removed/stranger) evaluates to empty."""
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
    if assigned:
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
    return f"{get_settings().frontend_url.rstrip('/')}/organizations/invites?token={token}"


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


def _read_invitation(db: Session, inv: Invitation, org_name: str = "",
                     include_token: bool = False) -> InvitationRead:
    name = org_name
    slug = ""
    org = db.get(Organization, inv.org_id)
    if org is not None:
        slug = org.slug
        if not name:
            name = org.name
    return InvitationRead(
        id=inv.id, org_id=inv.org_id, org_name=name, email=inv.email, kind=inv.kind, status=inv.status,
        expires_at=inv.expires_at, invited_by=inv.invited_by, set_ids=list(inv.set_ids or []),
        created_at=inv.created_at, token=inv.token if include_token else None, org_slug=slug,
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
    Effective permissions evaluate to empty (only ACTIVE memberships count)."""
    org, mem = _member_org(db, org_id, actor_id)
    _require_perm(db, org, mem, actor_id, "Members.Suspend")
    target = _live_membership(db, org_id, target_user_id)
    if target is None:
        raise NotFoundError("member not found")
    if target.is_root:
        raise ConflictError("cannot suspend the root")
    target.state = MembershipState.SUSPENDED.value
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
