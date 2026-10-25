"""Org key endpoints (metadata only — raw key shown once at issuance)."""

import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from tollms.api.orgs.keys import service
from tollms.api.orgs.schemas import OrgKeyCreate, OrgKeyCreated, OrgKeyRead
from tollms.api.keys.schemas import ApiKeyUpdate, IpRuleIn, ModelPermissionIn, PolicyIn
from tollms.core.deps import get_db
from tollms.core.security import require_active_user
from tollms.models.user import User

router = APIRouter()


@router.post("/{org_id}/keys", response_model=OrgKeyCreated, status_code=201)
def issue_org_key(org_id: uuid.UUID, data: OrgKeyCreate, db: Session = Depends(get_db),
                  user: User = Depends(require_active_user)):
    """Issue an org-scoped key to an ACTIVE member. `raw_key` shown once."""
    key, raw_key = service.create_org_key(
        db, user.id, org_id, assignee_user_id=data.assignee_user_id, name=data.name,
        description=data.description, max_budget_usd=data.max_budget_usd,
        policy=data.policy, ip_rules=data.ip_rules,
        expires_at=data.expires_at, model_permissions=data.model_permissions,
    )
    return OrgKeyCreated(key=key, raw_key=raw_key)



@router.get("/{org_id}/keys", response_model=list[OrgKeyRead])
def list_org_keys(org_id: uuid.UUID, search: str | None = Query(default=None, max_length=120),
                  limit: int | None = None, offset: int = 0,
                  db: Session = Depends(get_db),
                  user: User = Depends(require_active_user)):
    return service.list_org_keys(db, user.id, org_id, search=search, limit=limit, offset=offset)



@router.delete("/{org_id}/keys/{key_id}", status_code=204)
def revoke_org_key(org_id: uuid.UUID, key_id: uuid.UUID, db: Session = Depends(get_db),
                   user: User = Depends(require_active_user)):
    service.revoke_org_key(db, user.id, org_id, key_id)


@router.patch("/{org_id}/keys/{key_id}", response_model=OrgKeyRead)
def update_org_key(org_id: uuid.UUID, key_id: uuid.UUID, data: ApiKeyUpdate,
                   db: Session = Depends(get_db),
                   user: User = Depends(require_active_user)):
    """Edit org key metadata (name/description/enabled/expires_at).

    Never touches the secret — use rotate for a new one."""
    return service.update_org_key(db, user.id, org_id, key_id, data)


@router.put("/{org_id}/keys/{key_id}/policy", response_model=OrgKeyRead)
def put_org_key_policy(org_id: uuid.UUID, key_id: uuid.UUID, data: PolicyIn,
                       db: Session = Depends(get_db),
                       user: User = Depends(require_active_user)):
    """Full-replace the org key policy. Absent fields become NULL (unlimited)."""
    return service.put_org_key_policy(db, user.id, org_id, key_id, data)


@router.put("/{org_id}/keys/{key_id}/ip-rules", response_model=OrgKeyRead)
def put_org_key_ip_rules(org_id: uuid.UUID, key_id: uuid.UUID, rules: list[IpRuleIn],
                         db: Session = Depends(get_db),
                         user: User = Depends(require_active_user)):
    """Replace every IP rule on the org key (`[]` clears restrictions)."""
    return service.put_org_key_ip_rules(db, user.id, org_id, key_id, rules)


@router.put("/{org_id}/keys/{key_id}/model-permissions", response_model=OrgKeyRead)
def put_org_key_model_permissions(org_id: uuid.UUID, key_id: uuid.UUID,
                                 permissions: list[ModelPermissionIn],
                                 db: Session = Depends(get_db),
                                 user: User = Depends(require_active_user)):
    """Replace the org key allow-list (`[]` = unrestricted)."""
    return service.put_org_key_model_permissions(db, user.id, org_id, key_id, permissions)


@router.post("/{org_id}/keys/{key_id}/rotate", response_model=OrgKeyCreated)
def rotate_org_key(org_id: uuid.UUID, key_id: uuid.UUID, db: Session = Depends(get_db),
                   user: User = Depends(require_active_user)):
    """Replace the stored hash/prefix: the old raw key stops authenticating."""
    key, raw_key = service.rotate_org_key(db, user.id, org_id, key_id)
    return OrgKeyCreated(key=key, raw_key=raw_key)

