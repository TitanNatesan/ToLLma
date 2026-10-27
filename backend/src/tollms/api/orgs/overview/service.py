"""Organization CRUD, search, and system permission seeds."""

import logging
import re
import uuid

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from tollms.api.orgs.common.audit import _audit
from tollms.api.orgs.common.guards import (
    PERMISSION_GROUPS,
    SYSTEM_SET_DEFS,
    _escape_like,
    _live_membership,
    _member_org,
    _require_perm,
    effective_permissions,
)
from tollms.api.orgs.schemas import OrgCard, OrgRead
from tollms.models.organization import (
    Membership,
    MembershipState,
    Organization,
    OrgStatus,
    PermissionSet,
    PermissionSetPermission,
)

logger = logging.getLogger(__name__)


def _read_org(db: Session, org: Organization, user_id: uuid.UUID) -> OrgRead:
    mem = _live_membership(db, org.id, user_id)
    perms = effective_permissions(db, org.id, user_id) if mem else set()
    return OrgRead(
        id=org.id, name=org.name, slug=org.slug, description=org.description, website=org.website,
        industry=org.industry, location=org.location, size=org.size, status=org.status,
        is_root=bool(mem and mem.is_root), permissions=sorted(perms), created_at=org.created_at,
    )



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
    # LIKE wildcards (%, _, \) match literally — user input is escaped.
    q = f"%{_escape_like(query.strip().lower())}%"
    rows = db.execute(
        select(Organization).where(
            Organization.is_deleted.is_(False), Organization.status == OrgStatus.ACTIVE.value,
            or_(func.lower(Organization.name).like(q, escape="\\"), func.lower(Organization.slug).like(q, escape="\\")),
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
    # Slug stays immutable (URLs/bookmarks); name is freely editable.
    for key in ("name", "description", "website", "industry", "location", "size"):
        if key in fields and fields[key] is not None:
            setattr(org, key, fields[key])
            changed[key] = fields[key]
    _audit(db, org.id, user_id, "org.updated", **{k: str(v) for k, v in changed.items()})
    db.commit()
    db.refresh(org)
    return _read_org(db, org, user_id)


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

