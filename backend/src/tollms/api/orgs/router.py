"""Organizations Phase A endpoints (member-scoped; cross-org reads are 404)."""

import uuid

from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy.orm import Session

from tollms.api.auth.router import _set_session_cookies as _set_auth_cookies
from tollms.api.orgs import service
from tollms.api.orgs.schemas import (
    AcceptNewRequest,
    AcceptNewResponse,
    AnalyticsOverview,
    AssignSets,
    AuditRead,
    BudgetRead,
    BudgetUpdate,
    InvitationRead,
    InviteCreate,
    InvitePreview,
    MemberRead,
    OrgCard,
    OrgCreate,
    OrgKeyCreate,
    OrgKeyCreated,
    OrgKeyRead,
    OrgRead,
    OrgUpdate,
    PermissionSetCreate,
    PermissionSetRead,
    PermissionSetUpdate,
    RejectNewResponse,
)
from tollms.api.providers.router import _read as _read_provider
from tollms.api.providers.schemas import ProviderCreate, ProviderRead, ProviderUpdate
from tollms.core import rate_limit
from tollms.core.deps import get_db
from tollms.core.security import client_meta, require_active_user
from tollms.models.user import User

router = APIRouter(prefix="/api/v1/orgs", tags=["organizations"])


@router.post("", response_model=OrgRead, status_code=201)
def create_org(data: OrgCreate, db: Session = Depends(get_db), user: User = Depends(require_active_user)):
    return service.create_organization(
        db, user.id, name=data.name, description=data.description, website=data.website,
        industry=data.industry, location=data.location, size=data.size,
    )


@router.get("", response_model=list[OrgRead])
def my_orgs(db: Session = Depends(get_db), user: User = Depends(require_active_user)):
    return service.list_my_organizations(db, user.id)


@router.get("/permissions/catalog")
def permission_catalog(user: User = Depends(require_active_user)) -> list[dict]:
    return service.permission_catalog()


@router.get("/search", response_model=list[OrgCard])
def search_orgs(q: str = Query(min_length=1, max_length=120), limit: int = 20,
                db: Session = Depends(get_db), user: User = Depends(require_active_user)):
    return service.search_organizations(db, q, limit)


@router.get("/invitations/mine", response_model=list[InvitationRead])
def my_invitations(db: Session = Depends(get_db), user: User = Depends(require_active_user)):
    return service.my_invitations(db, user.id)


@router.get("/invitations/preview/{token}", response_model=InvitePreview)
def preview_invitation(token: str, db: Session = Depends(get_db),
                       _: None = Depends(rate_limit.limit("auth:verify"))):
    """Public invitation preview (no auth; rate-limited like auth:verify)."""
    return service.preview_invitation(db, token)


@router.get("/{org_id}", response_model=OrgRead)
def get_org(org_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(require_active_user)):
    return service._read_org(db, service._member_org(db, org_id, user.id)[0], user.id)


@router.patch("/{org_id}", response_model=OrgRead)
def update_org(org_id: uuid.UUID, data: OrgUpdate, db: Session = Depends(get_db),
               user: User = Depends(require_active_user)):
    return service.update_organization(db, user.id, org_id, **data.model_dump(exclude_unset=True))


@router.get("/{org_id}/members", response_model=list[MemberRead])
def list_members(org_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(require_active_user)):
    return service.list_members(db, user.id, org_id)


@router.post("/{org_id}/members/{target_user_id}/suspend", response_model=MemberRead)
def suspend_member(org_id: uuid.UUID, target_user_id: uuid.UUID, db: Session = Depends(get_db),
                   user: User = Depends(require_active_user)):
    return service.suspend_member(db, user.id, org_id, target_user_id)


@router.post("/{org_id}/members/{target_user_id}/resume", response_model=MemberRead)
def resume_member(org_id: uuid.UUID, target_user_id: uuid.UUID, db: Session = Depends(get_db),
                  user: User = Depends(require_active_user)):
    return service.resume_member(db, user.id, org_id, target_user_id)


@router.delete("/{org_id}/members/{target_user_id}", status_code=204)
def remove_member(org_id: uuid.UUID, target_user_id: uuid.UUID, db: Session = Depends(get_db),
                  user: User = Depends(require_active_user)):
    service.remove_member(db, user.id, org_id, target_user_id)


@router.post("/{org_id}/leave", status_code=204)
def leave(org_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(require_active_user)):
    service.leave_organization(db, user.id, org_id)


@router.post("/{org_id}/members/{target_user_id}/sets", response_model=MemberRead)
def assign_sets(org_id: uuid.UUID, target_user_id: uuid.UUID, data: AssignSets,
                db: Session = Depends(get_db), user: User = Depends(require_active_user)):
    return service.assign_sets(db, user.id, org_id, target_user_id, data.set_ids)


@router.get("/{org_id}/sets", response_model=list[PermissionSetRead])
def list_sets(org_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(require_active_user)):
    return service.list_sets(db, user.id, org_id)


@router.post("/{org_id}/sets", response_model=PermissionSetRead, status_code=201)
def create_set(org_id: uuid.UUID, data: PermissionSetCreate, db: Session = Depends(get_db),
               user: User = Depends(require_active_user)):
    return service.create_set(db, user.id, org_id, name=data.name, description=data.description,
                              permissions=data.permissions)


@router.patch("/{org_id}/sets/{set_id}", response_model=PermissionSetRead)
def update_set(org_id: uuid.UUID, set_id: uuid.UUID, data: PermissionSetUpdate,
               db: Session = Depends(get_db), user: User = Depends(require_active_user)):
    return service.update_set(db, user.id, org_id, set_id, name=data.name,
                              description=data.description, permissions=data.permissions)


@router.delete("/{org_id}/sets/{set_id}", status_code=204)
def delete_set(org_id: uuid.UUID, set_id: uuid.UUID, db: Session = Depends(get_db),
               user: User = Depends(require_active_user)):
    service.delete_set(db, user.id, org_id, set_id)


@router.post("/{org_id}/sets/{set_id}/clone", response_model=PermissionSetRead, status_code=201)
def clone_set(org_id: uuid.UUID, set_id: uuid.UUID, data: PermissionSetCreate,
              db: Session = Depends(get_db), user: User = Depends(require_active_user)):
    return service.clone_set(db, user.id, org_id, set_id, name=data.name)


@router.post("/{org_id}/invitations", response_model=InvitationRead, status_code=201)
def invite(org_id: uuid.UUID, data: InviteCreate, db: Session = Depends(get_db),
           user: User = Depends(require_active_user)):
    return service.invite_user(db, user.id, org_id, email=data.email, set_ids=data.set_ids)


@router.get("/{org_id}/invitations", response_model=list[InvitationRead])
def list_invitations(org_id: uuid.UUID, status: str | None = None, db: Session = Depends(get_db),
                     user: User = Depends(require_active_user)):
    return service.list_invitations(db, user.id, org_id, status)


@router.delete("/{org_id}/invitations/{invitation_id}", status_code=204)
def cancel_invitation(org_id: uuid.UUID, invitation_id: uuid.UUID, db: Session = Depends(get_db),
                      user: User = Depends(require_active_user)):
    service.cancel_invitation(db, user.id, org_id, invitation_id)


@router.post("/{org_id}/invitations/{invitation_id}/resend", response_model=InvitationRead)
def resend_invitation(org_id: uuid.UUID, invitation_id: uuid.UUID, db: Session = Depends(get_db),
                      user: User = Depends(require_active_user)):
    return service.resend_invitation(db, user.id, org_id, invitation_id)


@router.post("/{org_id}/requests", response_model=InvitationRead, status_code=201)
def request_join(org_id: uuid.UUID, db: Session = Depends(get_db),
                 user: User = Depends(require_active_user)):
    return service.request_join(db, user.id, org_id)


@router.get("/{org_id}/requests", response_model=list[InvitationRead])
def list_requests(org_id: uuid.UUID, db: Session = Depends(get_db),
                  user: User = Depends(require_active_user)):
    return service.list_requests(db, user.id, org_id)


@router.post("/{org_id}/requests/{invitation_id}/approve", response_model=MemberRead)
def approve_request(org_id: uuid.UUID, invitation_id: uuid.UUID, data: AssignSets,
                    db: Session = Depends(get_db), user: User = Depends(require_active_user)):
    return service.approve_request(db, user.id, org_id, invitation_id, data.set_ids)


@router.post("/{org_id}/requests/{invitation_id}/reject", status_code=204)
def reject_request(org_id: uuid.UUID, invitation_id: uuid.UUID, db: Session = Depends(get_db),
                   user: User = Depends(require_active_user)):
    service.reject_request(db, user.id, org_id, invitation_id)


@router.get("/{org_id}/audit", response_model=list[AuditRead])
def get_audit(org_id: uuid.UUID, limit: int = 100, db: Session = Depends(get_db),
              user: User = Depends(require_active_user)):
    return service.get_audit(db, user.id, org_id, limit)


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


@router.post("/{org_id}/keys", response_model=OrgKeyCreated, status_code=201)
def issue_org_key(org_id: uuid.UUID, data: OrgKeyCreate, db: Session = Depends(get_db),
                  user: User = Depends(require_active_user)):
    """Issue an org-scoped key to an ACTIVE member. `raw_key` shown once."""
    key, raw_key = service.create_org_key(
        db, user.id, org_id, assignee_user_id=data.assignee_user_id, name=data.name,
        description=data.description, max_budget_usd=data.max_budget_usd,
        model_permissions=data.model_permissions,
    )
    return OrgKeyCreated(key=key, raw_key=raw_key)


@router.get("/{org_id}/keys", response_model=list[OrgKeyRead])
def list_org_keys(org_id: uuid.UUID, db: Session = Depends(get_db),
                  user: User = Depends(require_active_user)):
    return service.list_org_keys(db, user.id, org_id)


@router.delete("/{org_id}/keys/{key_id}", status_code=204)
def revoke_org_key(org_id: uuid.UUID, key_id: uuid.UUID, db: Session = Depends(get_db),
                   user: User = Depends(require_active_user)):
    service.revoke_org_key(db, user.id, org_id, key_id)


# --- Phase B: org providers -------------------------------------------------------


@router.post("/{org_id}/providers", response_model=ProviderRead, status_code=201)
def create_org_provider(org_id: uuid.UUID, data: ProviderCreate,
                        db: Session = Depends(get_db),
                        user: User = Depends(require_active_user)):
    return _read_provider(service.create_org_provider(db, user.id, org_id, data))


@router.get("/{org_id}/providers", response_model=list[ProviderRead])
def list_org_providers(org_id: uuid.UUID, db: Session = Depends(get_db),
                       user: User = Depends(require_active_user)):
    return [_read_provider(p) for p in service.list_org_providers(db, user.id, org_id)]


@router.patch("/{org_id}/providers/{provider_id}", response_model=ProviderRead)
def update_org_provider(org_id: uuid.UUID, provider_id: uuid.UUID, data: ProviderUpdate,
                        db: Session = Depends(get_db),
                        user: User = Depends(require_active_user)):
    return _read_provider(service.update_org_provider(db, user.id, org_id, provider_id, data))


@router.delete("/{org_id}/providers/{provider_id}", status_code=204)
def delete_org_provider(org_id: uuid.UUID, provider_id: uuid.UUID,
                        db: Session = Depends(get_db),
                        user: User = Depends(require_active_user)):
    service.delete_org_provider(db, user.id, org_id, provider_id)


# --- Phase B: budgets ---------------------------------------------------------------


@router.get("/{org_id}/budget", response_model=BudgetRead)
def get_budget(org_id: uuid.UUID, db: Session = Depends(get_db),
               user: User = Depends(require_active_user)):
    return service.get_budget(db, user.id, org_id)


@router.patch("/{org_id}/budget", response_model=BudgetRead)
def set_budget_cap(org_id: uuid.UUID, data: BudgetUpdate, db: Session = Depends(get_db),
                   user: User = Depends(require_active_user)):
    return service.set_budget_cap(db, user.id, org_id, data.max_spend)


# --- Phase B: org analytics ---------------------------------------------------------------


@router.get("/{org_id}/analytics/overview", response_model=AnalyticsOverview)
def analytics_overview(org_id: uuid.UUID, db: Session = Depends(get_db),
                       user: User = Depends(require_active_user)):
    return service.org_analytics_overview(db, user.id, org_id)
