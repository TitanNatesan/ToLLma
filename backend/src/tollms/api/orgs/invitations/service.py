"""Org invitations, org-managed queues, and public by-token flows."""

import logging
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from tollms.api.auth import service as auth_service
from tollms.api.orgs.common.audit import _audit, _notify
from tollms.api.orgs.common.guards import (
    PERMISSION_CATALOG,
    _VALID_KINDS,
    _any_membership,
    _check_grantable,
    _clamp_limit,
    _clamp_offset,
    _get_org,
    effective_permissions,
    _live_membership,
    _member_org,
    _require_perm,
    _resolve_sets,
    _search_like,
    _set_codes,
)
from tollms.api.orgs.overview.service import _read_org
from tollms.api.orgs.schemas import (
    AcceptNewResponse,
    InvitationRead,
    OrgRead,
    InvitePreview,
    InviterRef,
    PermissionSetSummary,
    RejectNewResponse,
)
from tollms.core import security
from tollms.core.config import get_settings
from tollms.core.exceptions import ConflictError, NotFoundError, ValidationError
from tollms.models.organization import (
    Invitation,
    InvitationKind,
    InvitationStatus,
    Membership,
    MembershipPermissionSet,
    MembershipState,
    Organization,
    OrgStatus,
    PermissionSet,
)
from tollms.models.user import User
from tollms.services.email.service import route_email

logger = logging.getLogger(__name__)


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
                     status: str | None = None, kind: str | None = None,
                     search: str | None = None, limit: int | None = None,
                     offset: int = 0) -> list[InvitationRead]:
    """Org-managed invitation queue. Default (no kind) lists invites only (the
    historical behavior). kind=invite|request narrows to one queue; an unknown
    kind is ignored (both queues, documented) instead of 422. ?search=
    matches the recipient email; limit/offset paginate (absent limit = full
    list)."""
    org, mem = _member_org(db, org_id, user_id)
    _require_perm(db, org, mem, user_id, "Members.Read")
    _expire_due(db, org_id)
    db.commit()
    stmt = select(Invitation).where(
        Invitation.org_id == org_id, Invitation.is_deleted.is_(False)).order_by(Invitation.created_at.desc())
    if kind is None:
        stmt = stmt.where(Invitation.kind == InvitationKind.INVITE.value)
    elif kind in _VALID_KINDS:
        stmt = stmt.where(Invitation.kind == kind)
    # Unknown kind: filter ignored (documented) — both queues returned.
    if status:
        stmt = stmt.where(Invitation.status == status)
    like = _search_like(search)
    if like is not None:
        stmt = stmt.where(func.lower(Invitation.email).like(like))
    lim = _clamp_limit(limit, None)
    if lim is not None:
        stmt = stmt.limit(lim)
    off = _clamp_offset(offset)
    if off:
        stmt = stmt.offset(off)
    return [_read_invitation(db, i, org.name) for i in db.execute(stmt).scalars().all()]



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
    try:
        from tollms.api.keys import service as keys_service

        keys_service.ensure_primary_key(db, user.id)
    except Exception:
        logger.exception("primary key provisioning failed")
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

