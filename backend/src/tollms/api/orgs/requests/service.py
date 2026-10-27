"""Org join-request queue: file, list, approve, reject.

Shares the invitation-row helpers from invitations/service.py (same table,
same lifecycle); the routers stay path-shaped (/requests/* vs /invitations/*).
"""

import logging
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from tollms.api.orgs.common.audit import _audit, _notify
from tollms.api.orgs.common.guards import (
    PERMISSION_CATALOG,
    _ORG_NOT_FOUND,
    _VALID_STATUSES,
    _check_grantable,
    _clamp_limit,
    _clamp_offset,
    _get_org,
    _live_membership,
    _member_org,
    _resolve_sets,
    _search_like,
    _set_codes,
    effective_permissions,
)
from tollms.api.orgs.invitations.service import (
    _activate_membership,
    _approver_ids,
    _expire_due,
    _read_invitation,
)
from tollms.api.orgs.members.service import read_member
from tollms.api.orgs.schemas import InvitationRead, MemberRead
from tollms.core.exceptions import ConflictError, NotFoundError, ValidationError
from tollms.models.organization import Invitation, InvitationKind, InvitationStatus
from tollms.models.user import User
from tollms.services.email.service import route_email

logger = logging.getLogger(__name__)


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



def list_requests(db: Session, user_id: uuid.UUID, org_id: uuid.UUID, *,
                  status: str | None = None, search: str | None = None,
                  limit: int | None = None, offset: int = 0) -> list[InvitationRead]:
    """Join-request queue. Default status is pending (the historical
    behavior); any valid invitation status narrows to it, while an unknown
    status is ignored (all request statuses, documented) instead of 422.
    ?search= matches the requester email; limit/offset paginate."""
    org, mem = _member_org(db, org_id, user_id)
    perms = effective_permissions(db, org_id, user_id)
    if not (mem.is_root or perms & {"Members.Approve", "Members.Update"}):
        raise NotFoundError(_ORG_NOT_FOUND)
    _expire_due(db, org_id)
    db.commit()
    stmt = select(Invitation).where(
        Invitation.org_id == org_id, Invitation.kind == InvitationKind.REQUEST.value,
        Invitation.is_deleted.is_(False)).order_by(Invitation.created_at.desc())
    if status is None:
        stmt = stmt.where(Invitation.status == InvitationStatus.PENDING.value)
    elif status in _VALID_STATUSES:
        stmt = stmt.where(Invitation.status == status)
    # Unknown status: filter ignored (documented) — all request statuses.
    like = _search_like(search)
    if like is not None:
        stmt = stmt.where(func.lower(Invitation.email).like(like, escape="\\"))
    lim = _clamp_limit(limit, None)
    if lim is not None:
        stmt = stmt.limit(lim)
    off = _clamp_offset(offset)
    if off:
        stmt = stmt.offset(off)
    rows = db.execute(stmt).scalars().all()
    return [_read_invitation(db, i, org.name) for i in rows]



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

