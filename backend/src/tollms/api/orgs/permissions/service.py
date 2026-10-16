"""Org permission sets: CRUD, clone, member assignment."""

import uuid
from datetime import datetime, timezone

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from tollms.api.orgs.common.audit import _audit
from tollms.api.orgs.common.guards import (
    PERMISSION_CATALOG,
    _check_grantable,
    _live_membership,
    _clamp_limit,
    _clamp_offset,
    _member_org,
    _require_perm,
    _resolve_sets,
    _search_like,
    _set_codes,
)
from tollms.api.orgs.members.service import read_member
from tollms.api.orgs.schemas import MemberRead, PermissionSetRead
from tollms.core.exceptions import ConflictError, NotFoundError, ValidationError
from tollms.models.organization import (
    Membership,
    MembershipPermissionSet,
    PermissionSet,
    PermissionSetPermission,
    Team,
    TeamPermissionSet,
)


def _read_set(db: Session, row: PermissionSet) -> PermissionSetRead:
    return PermissionSetRead(
        id=row.id, name=row.name, description=row.description, is_system=row.is_system,
        permissions=_set_codes(db, row.id), created_at=row.created_at,
    )



def list_sets(db: Session, user_id: uuid.UUID, org_id: uuid.UUID, *,
              search: str | None = None, limit: int | None = None,
              offset: int = 0) -> list[PermissionSetRead]:
    """Org + system sets with per-set member/team counts. ?search= matches the
    name (case-insensitive); limit/offset paginate (absent limit = full list,
    the historical default)."""
    org, mem = _member_org(db, org_id, user_id)
    _require_perm(db, org, mem, user_id, "PermissionSets.Read")
    stmt = select(PermissionSet).where(
        or_(PermissionSet.org_id == org_id, PermissionSet.org_id.is_(None)),
        PermissionSet.is_deleted.is_(False),
    )
    like = _search_like(search)
    if like is not None:
        stmt = stmt.where(func.lower(PermissionSet.name).like(like))
    stmt = stmt.order_by(PermissionSet.is_system.desc(), PermissionSet.name)
    lim = _clamp_limit(limit, None)
    if lim is not None:
        stmt = stmt.limit(lim)
    off = _clamp_offset(offset)
    if off:
        stmt = stmt.offset(off)
    rows = list(db.execute(stmt).scalars().all())
    if not rows:
        return []
    ids = [r.id for r in rows]
    code_rows = db.execute(
        select(PermissionSetPermission.set_id, PermissionSetPermission.code)
        .where(PermissionSetPermission.set_id.in_(ids))
    ).all()
    codes: dict[uuid.UUID, list[str]] = {i: [] for i in ids}
    for sid, code in code_rows:
        codes.setdefault(sid, []).append(code)
    # member_count counts live memberships holding the set (suspended members
    # keep their sets, so they count; removed memberships are soft-deleted and
    # drop out via the join). team_count counts live teams with it attached.
    member_counts = dict(db.execute(
        select(MembershipPermissionSet.set_id, func.count(func.distinct(MembershipPermissionSet.membership_id)))
        .join(Membership, Membership.id == MembershipPermissionSet.membership_id)
        .where(MembershipPermissionSet.set_id.in_(ids), Membership.is_deleted.is_(False))
        .group_by(MembershipPermissionSet.set_id)
    ).all())
    team_counts = dict(db.execute(
        select(TeamPermissionSet.set_id, func.count(func.distinct(TeamPermissionSet.team_id)))
        .join(Team, Team.id == TeamPermissionSet.team_id)
        .where(TeamPermissionSet.set_id.in_(ids), Team.is_deleted.is_(False))
        .group_by(TeamPermissionSet.set_id)
    ).all())
    return [
        PermissionSetRead(
            id=r.id, name=r.name, description=r.description, is_system=r.is_system,
            permissions=sorted(codes.get(r.id, [])), created_at=r.created_at,
            member_count=int(member_counts.get(r.id, 0)), team_count=int(team_counts.get(r.id, 0)),
        )
        for r in rows
    ]



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

