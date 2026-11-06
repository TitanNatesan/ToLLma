"""Privacy endpoints only. No business logic."""

import uuid

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from tollms.api.privacy import schemas, service
from tollms.api.privacy.schemas import (
    ConsentRead,
    DSRRead,
    ErasureRead,
    RetentionRead,
)
from tollms.core.dependencies import get_current_user, require_active_user
from tollms.core.deps import get_db
from tollms.models.user import User

router = APIRouter(prefix="/api/v1/privacy", tags=["privacy"])


def _consent_read(row: object) -> ConsentRead:
    return ConsentRead(
        id=row.id,  # type: ignore[attr-defined]
        category=row.category,  # type: ignore[attr-defined]
        status=row.status,  # type: ignore[attr-defined]
        version=row.version,  # type: ignore[attr-defined]
        granted_at=row.granted_at,  # type: ignore[attr-defined]
        withdrawn_at=row.withdrawn_at,  # type: ignore[attr-defined]
        updated_at=row.updated_at,  # type: ignore[attr-defined]
    )


def _retention_read(row: object) -> RetentionRead:
    return RetentionRead(
        id=row.id,  # type: ignore[attr-defined]
        data_category=row.data_category,  # type: ignore[attr-defined]
        retention_days=row.retention_days,  # type: ignore[attr-defined]
        zero_retention=row.zero_retention,  # type: ignore[attr-defined]
        org_id=row.org_id,  # type: ignore[attr-defined]
        version=row.version,  # type: ignore[attr-defined]
        updated_at=row.updated_at,  # type: ignore[attr-defined]
    )


def _dsr_read(row: object) -> DSRRead:
    return DSRRead(
        id=row.id,  # type: ignore[attr-defined]
        type=row.type,  # type: ignore[attr-defined]
        status=row.status,  # type: ignore[attr-defined]
        reason_code=row.reason_code,  # type: ignore[attr-defined]
        detail=row.detail,  # type: ignore[attr-defined]
        due_at=row.due_at,  # type: ignore[attr-defined]
        fulfilled_at=row.fulfilled_at,  # type: ignore[attr-defined]
        created_at=row.created_at,  # type: ignore[attr-defined]
        events=[
            schemas.DSREventRead(
                id=e.id,
                from_status=e.from_status,
                to_status=e.to_status,
                note=e.note,
                created_at=e.created_at,
            )
            for e in row.events  # type: ignore[attr-defined]
        ],
    )


@router.get("/consents", response_model=list[ConsentRead])
def list_consents(
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> list[ConsentRead]:
    return [_consent_read(row) for row in service.list_consents(db, user.id)]


@router.put("/consents", response_model=ConsentRead)
def set_consent(
    data: schemas.ConsentSetRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> ConsentRead:
    return _consent_read(service.set_consent(db, user.id, data))


@router.get("/retention", response_model=list[RetentionRead])
def list_retention(
    org_id: uuid.UUID | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> list[RetentionRead]:
    return [_retention_read(row) for row in service.list_retention(db, user.id, org_id)]


@router.put("/retention", response_model=RetentionRead)
def set_retention(
    data: schemas.RetentionSetRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> RetentionRead:
    return _retention_read(service.set_retention(db, user.id, data))


@router.post("/dsr", response_model=DSRRead)
def submit_dsr(
    data: schemas.DSRSubmitRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> DSRRead:
    return _dsr_read(service.submit_dsr(db, user.id, data))


@router.get("/dsr", response_model=list[DSRRead])
def list_dsrs(
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> list[DSRRead]:
    return [_dsr_read(row) for row in service.list_dsrs(db, user.id)]


@router.get("/dsr/{dsr_id}", response_model=DSRRead)
def get_dsr(
    dsr_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> DSRRead:
    return _dsr_read(service.get_dsr(db, user.id, dsr_id))


@router.patch("/dsr/{dsr_id}", response_model=DSRRead)
def transition_dsr(
    dsr_id: uuid.UUID,
    data: schemas.DSRTransitionRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> DSRRead:
    return _dsr_read(service.transition_dsr(db, user.id, dsr_id, data))


@router.get("/export")
def full_export(
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> dict:
    return service.full_account_export(db, user.id)


@router.post("/erasure", response_model=ErasureRead)
async def request_erasure(
    data: schemas.ErasureRequest,
    request: Request,
    db: Session = Depends(get_db),
    # get_current_user (NOT require_active_user): pending accounts must reach
    # this endpoint for the idempotent re-request/status path.
    user: User = Depends(get_current_user),
) -> ErasureRead:
    from tollms.core.dependencies import get_current_session_id

    return await service.request_erasure(
        db, user, data, current_session_id=get_current_session_id(request)
    )
