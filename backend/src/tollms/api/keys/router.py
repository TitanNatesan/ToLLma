"""API-key management endpoints only. No business logic."""

import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from tollms.api.keys import service
from tollms.api.keys.schemas import (
    ApiKeyCreate,
    ApiKeyUpdate,
    IpRuleIn,
    IpRuleRead,
    KeyAnalytics,
    KeyCreated,
    KeyRead,
    ModelPermissionIn,
    ModelPermissionRead,
    PolicyIn,
    PolicyRead,
)
from tollms.core.deps import get_db
from tollms.core.security import get_current_user
from tollms.models.api_key import ApiKey
from tollms.models.user import User

router = APIRouter(prefix="/api/v1/keys", tags=["keys"])


def _read(key: ApiKey) -> KeyRead:
    """ORM -> public view. Deterministic child ordering; never the hash."""
    return KeyRead(
        id=key.id,
        name=key.name,
        description=key.description,
        key_prefix=key.key_prefix,
        masked=service.masked_prefix(key.key_prefix),
        enabled=key.enabled,
        expires_at=key.expires_at,
        last_used_at=key.last_used_at,
        rotation_count=key.rotation_count,
        policy=PolicyRead.model_validate(key.policy) if key.policy is not None else None,
        ip_rules=[
            IpRuleRead.model_validate(rule)
            for rule in sorted(key.ip_rules, key=lambda rule: (rule.type.value, rule.cidr))
        ],
        model_permissions=[
            ModelPermissionRead.model_validate(perm)
            for perm in sorted(
                key.model_permissions,
                key=lambda perm: (str(perm.provider_id or ""), str(perm.model_id or "")),
            )
        ],
        created_at=key.created_at,
        updated_at=key.updated_at,
    )


@router.post("", response_model=KeyCreated, status_code=201)
def create(
    data: ApiKeyCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> KeyCreated:
    """Create a key. `raw_key` in the response is shown exactly once."""
    key, raw_key = service.create_key(db, data, user.id)
    return KeyCreated(key=_read(key), raw_key=raw_key)


@router.get("", response_model=list[KeyRead])
def list_all(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> list[KeyRead]:
    return [_read(key) for key in service.list_keys(db, user.id)]


@router.get("/{key_id}", response_model=KeyRead)
def get(
    key_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> KeyRead:
    return _read(service.get_key(db, key_id, user.id))


@router.patch("/{key_id}", response_model=KeyRead)
def update(
    key_id: uuid.UUID,
    data: ApiKeyUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> KeyRead:
    return _read(service.update_key(db, key_id, data, user.id))


@router.delete("/{key_id}", status_code=204)
def delete(
    key_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> None:
    service.delete_key(db, key_id, user.id)


@router.post("/{key_id}/rotate", response_model=KeyCreated)
def rotate(
    key_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> KeyCreated:
    """Replace the stored hash: the old raw key stops working immediately."""
    key, raw_key = service.rotate_key(db, key_id, user.id)
    return KeyCreated(key=_read(key), raw_key=raw_key)


@router.put("/{key_id}/policy", response_model=KeyRead)
def put_policy(
    key_id: uuid.UUID,
    data: PolicyIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> KeyRead:
    """Upsert the policy. Every field nullable = unlimited; omitted = NULL."""
    return _read(service.put_policy(db, key_id, data, user.id))


@router.put("/{key_id}/ip-rules", response_model=KeyRead)
def put_ip_rules(
    key_id: uuid.UUID,
    rules: list[IpRuleIn],
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> KeyRead:
    """Replace every IP rule; body is the new array (`[]` clears restrictions)."""
    return _read(service.put_ip_rules(db, key_id, rules, user.id))


@router.put("/{key_id}/model-permissions", response_model=KeyRead)
def put_model_permissions(
    key_id: uuid.UUID,
    permissions: list[ModelPermissionIn],
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> KeyRead:
    """Replace every model permission; body is the new array (`[]` = unrestricted)."""
    return _read(service.put_model_permissions(db, key_id, permissions, user.id))


@router.get("/{key_id}/analytics", response_model=KeyAnalytics)
def analytics(
    key_id: uuid.UUID,
    preset: str = Query(default="last_7d", description="today | last_7d | last_30d | last_90d | this_month"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> KeyAnalytics:
    return service.get_analytics(db, key_id, user.id, preset)
