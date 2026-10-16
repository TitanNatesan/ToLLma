"""Invitation endpoints (org-managed queue + public by-token flows)."""

import uuid

from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy.orm import Session

from tollms.api.auth.router import _set_session_cookies as _set_auth_cookies
from tollms.api.orgs.invitations import service
from tollms.api.orgs.schemas import (
    AcceptNewRequest,
    AcceptNewResponse,
    InvitationRead,
    InviteCreate,
    InvitePreview,
    OrgRead,
    RejectNewResponse,
)
from tollms.core import rate_limit
from tollms.core.deps import get_db
from tollms.core.security import client_meta, require_active_user
from tollms.models.user import User

router = APIRouter()


@router.get("/invitations/mine", response_model=list[InvitationRead])
def my_invitations(db: Session = Depends(get_db), user: User = Depends(require_active_user)):
    return service.my_invitations(db, user.id)



@router.get("/invitations/preview/{token}", response_model=InvitePreview)
def preview_invitation(token: str, db: Session = Depends(get_db),
                       _: None = Depends(rate_limit.limit("auth:verify"))):
    """Public invitation preview (no auth; rate-limited like auth:verify)."""
    return service.preview_invitation(db, token)



@router.post("/{org_id}/invitations", response_model=InvitationRead, status_code=201)
def invite(org_id: uuid.UUID, data: InviteCreate, db: Session = Depends(get_db),
           user: User = Depends(require_active_user)):
    return service.invite_user(db, user.id, org_id, email=data.email, set_ids=data.set_ids)



@router.get("/{org_id}/invitations", response_model=list[InvitationRead])
def list_invitations(org_id: uuid.UUID, status: str | None = None, kind: str | None = None,
                     search: str | None = Query(default=None, max_length=320),
                     limit: int | None = None, offset: int = 0,
                     db: Session = Depends(get_db),
                     user: User = Depends(require_active_user)):
    return service.list_invitations(db, user.id, org_id, status, kind=kind, search=search,
                                    limit=limit, offset=offset)



@router.delete("/{org_id}/invitations/{invitation_id}", status_code=204)
def cancel_invitation(org_id: uuid.UUID, invitation_id: uuid.UUID, db: Session = Depends(get_db),
                      user: User = Depends(require_active_user)):
    service.cancel_invitation(db, user.id, org_id, invitation_id)



@router.post("/{org_id}/invitations/{invitation_id}/resend", response_model=InvitationRead)
def resend_invitation(org_id: uuid.UUID, invitation_id: uuid.UUID, db: Session = Depends(get_db),
                      user: User = Depends(require_active_user)):
    return service.resend_invitation(db, user.id, org_id, invitation_id)



@router.post("/invitations/by-token/{token}/accept", response_model=OrgRead)
def accept_invitation(token: str, db: Session = Depends(get_db),
                      user: User = Depends(require_active_user)):
    return service.accept_invitation(db, user.id, token)



@router.post("/invitations/by-token/{token}/reject", status_code=204)
def reject_invitation(token: str, db: Session = Depends(get_db),
                      user: User = Depends(require_active_user)):
    service.reject_invitation(db, user.id, token)



@router.post("/invitations/by-token/{token}/accept-new", response_model=AcceptNewResponse)
async def accept_new(token: str, data: AcceptNewRequest, request: Request, response: Response,
                     db: Session = Depends(get_db),
                     _: None = Depends(rate_limit.limit("auth:verify"))):
    """Public atomic signup+accept: creates the account, joins the org and
    consumes the invite in one commit, then opens a login session (cookies +
    tokens, same shape as login plus org_id). Unknown, tampered, consumed and
    expired tokens all get the identical 404 body. Degraded 201 (no session)
    when the session write fails after commit — the account still exists."""
    meta = client_meta(request)
    body, access, refresh = await service.accept_new_invitation(
        db, token, full_name=data.full_name, password=data.password, email=data.email,
        user_agent=meta["user_agent"], ip=meta["ip"],
    )
    if access and refresh:
        _set_auth_cookies(response, access, refresh)
    else:
        response.status_code = 201
    return body



@router.post("/invitations/by-token/{token}/reject-new", response_model=RejectNewResponse)
def reject_new(token: str, db: Session = Depends(get_db),
               _: None = Depends(rate_limit.limit("auth:verify"))):
    """Public invite decline (no auth): same pending gate + identical 404
    oracle as accept-new. Creates no user and no membership."""
    return service.reject_new_invitation(db, token)

