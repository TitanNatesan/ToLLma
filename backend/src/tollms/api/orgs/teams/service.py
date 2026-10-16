"""Org teams: CRUD, roster, set attachment."""

import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from tollms.api.orgs.common.audit import _audit
from tollms.api.orgs.common.guards import (
    PERMISSION_CATALOG,
    _any_membership,
    _check_grantable,
    _clamp_limit,
    _clamp_offset,
    _live_membership,
    _member_org,
    _require_perm,
    _resolve_sets,
    _search_like,
    _set_codes,
)
from tollms.api.orgs.schemas import TeamDetail, TeamMemberRead, TeamRead, TeamSetRead
from tollms.core.exceptions import ConflictError, NotFoundError, ValidationError
from tollms.models.organization import (
    Membership,
    PermissionSet,
    PermissionSetPermission,
    Team,
    TeamMembership,
    TeamPermissionSet,
)
from tollms.models.user import User

logger = logging.getLogger(__name__)


def _parse_include(include: str | None) -> tuple[bool, bool]:
    """Parse ?include= comma list. Unknown tokens are ignored (documented),
    so include=banana behaves exactly like the stripped default."""
    if not include:
        return False, False
    parts = {p.strip().lower() for p in include.split(",") if p.strip()}
    return "members" in parts, "sets" in parts



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



def list_teams(db: Session, user_id: uuid.UUID, org_id: uuid.UUID, *,
               include: str | None = None, search: str | None = None,
               limit: int | None = None, offset: int = 0) -> list[TeamRead]:
    """Team roster listing. Default returns the stripped TeamRead shape (the
    members/sets keys are left unset, so with response_model_exclude_unset the
    JSON is identical to the old behavior); ?include=members,sets populates
    those sections. Unknown include tokens are ignored. ?search= matches the
    team name; limit/offset paginate (absent limit = full list)."""
    org, mem = _member_org(db, org_id, user_id)
    _require_perm(db, org, mem, user_id, "Teams.Read")
    want_members, want_sets = _parse_include(include)
    stmt = select(Team).where(Team.org_id == org_id, Team.is_deleted.is_(False))
    like = _search_like(search)
    if like is not None:
        stmt = stmt.where(func.lower(Team.name).like(like))
    stmt = stmt.order_by(Team.name)
    lim = _clamp_limit(limit, None)
    if lim is not None:
        stmt = stmt.limit(lim)
    off = _clamp_offset(offset)
    if off:
        stmt = stmt.offset(off)
    rows = list(db.execute(stmt).scalars().all())
    if not rows:
        return []
    tids = [t.id for t in rows]
    code_rows = db.execute(
        select(TeamPermissionSet.team_id, PermissionSetPermission.code)
        .join(PermissionSet, PermissionSet.id == TeamPermissionSet.set_id)
        .join(PermissionSetPermission, PermissionSetPermission.set_id == TeamPermissionSet.set_id)
        .where(TeamPermissionSet.team_id.in_(tids), PermissionSet.is_deleted.is_(False))
    ).all()
    codes: dict[uuid.UUID, set[str]] = {t: set() for t in tids}
    for tid, code in code_rows:
        codes.setdefault(tid, set()).add(code)
    counts = dict(db.execute(
        select(TeamMembership.team_id, func.count(TeamMembership.membership_id))
        .where(TeamMembership.team_id.in_(tids))
        .group_by(TeamMembership.team_id)
    ).all())
    members_by_team: dict[uuid.UUID, list[TeamMemberRead]] = {}
    if want_members:
        links = db.execute(
            select(TeamMembership).where(TeamMembership.team_id.in_(tids))
            .order_by(TeamMembership.created_at)
        ).scalars().all()
        by_team_links: dict[uuid.UUID, list] = {t: [] for t in tids}
        for link in links:
            by_team_links.setdefault(link.team_id, []).append(link)
        mids = list({link.membership_id for link in links})
        mem_rows = {m.id: m for m in db.execute(
            select(Membership).where(Membership.id.in_(mids))).scalars().all()} if mids else {}
        uids = list({m.user_id for m in mem_rows.values()})
        users = {u.id: u for u in db.execute(
            select(User).where(User.id.in_(uids))).scalars().all()} if uids else {}
        for t in tids:
            items: list[TeamMemberRead] = []
            for link in by_team_links.get(t, []):
                membership = mem_rows.get(link.membership_id)
                if membership is None or membership.is_deleted:
                    continue
                user = users.get(membership.user_id)
                items.append(TeamMemberRead(
                    membership_id=membership.id, user_id=membership.user_id,
                    email=user.email if user else "", full_name=user.full_name if user else None,
                    state=membership.state,
                ))
            members_by_team[t] = items
    sets_by_team: dict[uuid.UUID, list[TeamSetRead]] = {}
    if want_sets:
        set_rows = db.execute(
            select(TeamPermissionSet.team_id, PermissionSet)
            .join(PermissionSet, PermissionSet.id == TeamPermissionSet.set_id)
            .where(TeamPermissionSet.team_id.in_(tids), PermissionSet.is_deleted.is_(False))
            .order_by(PermissionSet.name)
        ).all()
        sids = list({r.id for _, r in set_rows})
        set_codes: dict[uuid.UUID, list[str]] = {s: [] for s in sids}
        if sids:
            for sid, code in db.execute(
                select(PermissionSetPermission.set_id, PermissionSetPermission.code)
                .where(PermissionSetPermission.set_id.in_(sids))
            ).all():
                set_codes.setdefault(sid, []).append(code)
        grouped: dict[uuid.UUID, list[TeamSetRead]] = {t: [] for t in tids}
        for tid, ps in set_rows:
            grouped.setdefault(tid, []).append(
                TeamSetRead(id=ps.id, name=ps.name, codes=sorted(set_codes.get(ps.id, []))))
        sets_by_team = grouped
    out: list[TeamRead] = []
    for t in rows:
        extra: dict = {}
        if want_members:
            extra["members"] = members_by_team.get(t.id, [])
        if want_sets:
            extra["sets"] = sets_by_team.get(t.id, [])
        out.append(TeamRead(
            id=t.id, name=t.name, description=t.description,
            member_count=int(counts.get(t.id, 0)), codes=sorted(codes.get(t.id, set())),
            created_at=t.created_at, **extra,
        ))
    return out



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

