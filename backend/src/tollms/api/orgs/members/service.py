"""Org membership roster: listing, suspension, removal, leave."""

import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from tollms.api.orgs.common.audit import _audit, _notify
from tollms.api.orgs.common.guards import (
    PERMISSION_CATALOG,
    _VALID_STATES,
    _any_membership,
    _clamp_limit,
    _clamp_offset,
    _live_membership,
    _member_org,
    _require_perm,
    _search_like,
)
from tollms.api.orgs.keys.service import _revoke_member_keys
from tollms.api.orgs.schemas import MemberRead, TeamRef
from tollms.core.exceptions import ConflictError, NotFoundError
from tollms.models.organization import (
    Membership,
    MembershipPermissionSet,
    MembershipState,
    Organization,
    PermissionSet,
    PermissionSetPermission,
    Team,
    TeamMembership,
    TeamPermissionSet,
)
from tollms.models.user import User

logger = logging.getLogger(__name__)


def _read_members_batch(db: Session, org: Organization, mems: list[Membership]) -> list[MemberRead]:
    """Batched member enrichment: one teams join, one direct-sets join, one
    key-count group, one codes lookup — no per-member queries. Single-member
    callers (suspend/resume/assign/approve) reuse this with a one-item list."""
    from tollms.models.api_key import ApiKey

    if not mems:
        return []
    mem_ids = [m.id for m in mems]
    user_ids = list({m.user_id for m in mems})
    users = {u.id: u for u in db.execute(
        select(User).where(User.id.in_(user_ids))).scalars().all()} if user_ids else {}
    mps_rows = db.execute(
        select(MembershipPermissionSet.membership_id, MembershipPermissionSet.set_id)
        .where(MembershipPermissionSet.membership_id.in_(mem_ids))
    ).all()
    direct: dict[uuid.UUID, set[uuid.UUID]] = {m.id: set() for m in mems}
    for mid, sid in mps_rows:
        direct.setdefault(mid, set()).add(sid)
    live_direct_ids = {s for v in direct.values() for s in v}
    live_names: dict[uuid.UUID, str] = {}
    if live_direct_ids:
        live_names = dict(db.execute(
            select(PermissionSet.id, PermissionSet.name)
            .where(PermissionSet.id.in_(live_direct_ids), PermissionSet.is_deleted.is_(False))
        ).all())
    team_rows = db.execute(
        select(TeamMembership.membership_id, Team.id, Team.name)
        .join(Team, Team.id == TeamMembership.team_id)
        .where(TeamMembership.membership_id.in_(mem_ids),
               Team.org_id == org.id, Team.is_deleted.is_(False))
        .order_by(Team.name)
    ).all()
    teams_by_mem: dict[uuid.UUID, list[tuple[uuid.UUID, str]]] = {m.id: [] for m in mems}
    for mid, tid, tname in team_rows:
        teams_by_mem.setdefault(mid, []).append((tid, tname))
    team_ids = list({tid for pairs in teams_by_mem.values() for tid, _ in pairs})
    team_sets: dict[uuid.UUID, set[uuid.UUID]] = {}
    if team_ids:
        for tid, sid in db.execute(
            select(TeamPermissionSet.team_id, TeamPermissionSet.set_id)
            .join(PermissionSet, PermissionSet.id == TeamPermissionSet.set_id)
            .where(TeamPermissionSet.team_id.in_(team_ids), PermissionSet.is_deleted.is_(False))
        ).all():
            team_sets.setdefault(tid, set()).add(sid)
    code_set_ids = set(live_names) | {s for v in team_sets.values() for s in v}
    codes_by_set: dict[uuid.UUID, set[str]] = {}
    if code_set_ids:
        for sid, code in db.execute(
            select(PermissionSetPermission.set_id, PermissionSetPermission.code)
            .where(PermissionSetPermission.set_id.in_(sorted(code_set_ids)))
        ).all():
            codes_by_set.setdefault(sid, set()).add(code)
    key_counts: dict[uuid.UUID, int] = {}
    if user_ids:
        key_counts = dict(db.execute(
            select(ApiKey.user_id, func.count(ApiKey.id))
            .where(ApiKey.org_id == org.id, ApiKey.user_id.in_(user_ids),
                   ApiKey.is_deleted.is_(False))
            .group_by(ApiKey.user_id)
        ).all())
    out: list[MemberRead] = []
    for m in mems:
        sids = sorted(s for s in direct.get(m.id, set()) if s in live_names)
        team_list = teams_by_mem.get(m.id, [])
        if m.is_root:
            perms = set(PERMISSION_CATALOG)
        elif m.state != MembershipState.ACTIVE.value:
            # Mirrors effective_permissions: only ACTIVE memberships evaluate;
            # suspend empties the permission leg while roster rows are kept.
            perms = set()
        else:
            union_ids = set(sids)
            for tid, _ in team_list:
                union_ids |= team_sets.get(tid, set())
            perms = {c for sid in union_ids for c in codes_by_set.get(sid, set())}
        user = users.get(m.user_id)
        out.append(MemberRead(
            user_id=m.user_id, email=user.email if user else "", is_root=m.is_root, state=m.state,
            permission_sets=sorted(live_names[s] for s in sids), permissions=sorted(perms),
            teams=[TeamRef(id=tid, name=tname) for tid, tname in team_list],
            team_ids=[tid for tid, _ in team_list], set_ids=sids,
            joined_at=m.created_at, key_count=int(key_counts.get(m.user_id, 0)),
        ))
    return out



def read_member(db: Session, org: Organization, mem: Membership) -> MemberRead:
    return _read_members_batch(db, org, [mem])[0]



def list_members(db: Session, user_id: uuid.UUID, org_id: uuid.UUID, *,
                 search: str | None = None, state: str | None = None,
                 limit: int | None = None, offset: int = 0) -> list[MemberRead]:
    """Org roster with enrichment. ?search= matches member email/full name
    (case-insensitive); ?state= filters by membership state — unknown states
    are ignored (documented), so a typo degrades to the full list instead of
    422. limit/offset paginate (absent limit = full list, the default)."""
    org, mem = _member_org(db, org_id, user_id)
    _require_perm(db, org, mem, user_id, "Members.Read")
    stmt = select(Membership).where(Membership.org_id == org_id, Membership.is_deleted.is_(False))
    if state in _VALID_STATES:
        stmt = stmt.where(Membership.state == state)
    like = _search_like(search)
    if like is not None:
        stmt = stmt.join(User, User.id == Membership.user_id).where(
            or_(func.lower(User.email).like(like, escape="\\"), func.lower(User.full_name).like(like, escape="\\")))
    stmt = stmt.order_by(Membership.is_root.desc(), Membership.created_at)
    lim = _clamp_limit(limit, None)
    if lim is not None:
        stmt = stmt.limit(lim)
    off = _clamp_offset(offset)
    if off:
        stmt = stmt.offset(off)
    rows = list(db.execute(stmt).scalars().all())
    return _read_members_batch(db, org, rows)



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

