"""Governance endpoints only. No business logic, no services.* imports."""

import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from tollms.api.governance import service
from tollms.api.governance.schemas import (
    AbuseAppeal,
    AbuseReportCreate,
    AbuseReportRead,
    AbuseStatusPatch,
    ProviderPolicyCreate,
    ProviderPolicyRead,
    ProviderPolicyUpdate,
)
from tollms.core.deps import get_db
from tollms.core.security import platform_admin_required, require_active_user
from tollms.models.user import User

router = APIRouter(prefix="/api/v1/governance", tags=["governance"])


@router.get("/provider-policies", response_model=list[ProviderPolicyRead])
def list_policies(
    provider_key: str | None = None,
    scope: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> list[ProviderPolicyRead]:
    return service.list_policies(db, user.id, provider_key=provider_key, scope=scope)


@router.get("/provider-policies/stale", response_model=list[ProviderPolicyRead])
def stale_policies(
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> list[ProviderPolicyRead]:
    return service.list_policies(db, user.id, stale_only=True)


@router.post("/provider-policies", response_model=ProviderPolicyRead, status_code=201)
def create_policy(
    data: ProviderPolicyCreate,
    db: Session = Depends(get_db),
    user: User = Depends(platform_admin_required),
) -> ProviderPolicyRead:
    return service.create_policy(db, user.id, data)


@router.get("/provider-policies/{policy_id}", response_model=ProviderPolicyRead)
def get_policy(
    policy_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> ProviderPolicyRead:
    return service.get_policy(db, user.id, policy_id)


@router.patch("/provider-policies/{policy_id}", response_model=ProviderPolicyRead)
def update_policy(
    policy_id: uuid.UUID,
    data: ProviderPolicyUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(platform_admin_required),
) -> ProviderPolicyRead:
    return service.update_policy(db, user.id, policy_id, data)


@router.delete("/provider-policies/{policy_id}", status_code=204)
def delete_policy(
    policy_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(platform_admin_required),
) -> None:
    service.delete_policy(db, user.id, policy_id)


@router.post("/abuse-reports", response_model=AbuseReportRead, status_code=201)
def submit_report(
    data: AbuseReportCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> AbuseReportRead:
    return service.submit_report(db, user.id, data)


@router.get("/abuse-reports", response_model=list[AbuseReportRead])
def list_reports(
    status: str | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> list[AbuseReportRead]:
    return service.list_reports(db, user.id, status=status, limit=limit)


@router.get("/abuse-reports/{report_id}", response_model=AbuseReportRead)
def get_report(
    report_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> AbuseReportRead:
    return service.get_report(db, user.id, report_id)


@router.patch("/abuse-reports/{report_id}/status", response_model=AbuseReportRead)
def set_report_status(
    report_id: uuid.UUID,
    data: AbuseStatusPatch,
    db: Session = Depends(get_db),
    user: User = Depends(platform_admin_required),
) -> AbuseReportRead:
    return service.set_report_status(
        db, user.id, report_id, data.status, data.resolution_note, data.assignee)


@router.post("/abuse-reports/{report_id}/appeal", response_model=AbuseReportRead)
def file_appeal(
    report_id: uuid.UUID,
    data: AbuseAppeal,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> AbuseReportRead:
    return service.file_appeal(db, user.id, report_id, data.appeal_note)
