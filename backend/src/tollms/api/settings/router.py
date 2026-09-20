"""Settings endpoints only. No business logic."""

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from tollms.api.auth import service as auth_service
from tollms.api.auth.schemas import UserRead
from tollms.api.settings import service
from tollms.api.settings.schemas import (
    PasswordChange,
    PreferencesRead,
    PreferencesUpdate,
    ProfileUpdate,
    RevokeOthersRead,
    RevokedRead,
    SessionsRead,
)
from tollms.core.deps import get_db
from tollms.core.security import get_current_session_id, get_current_user
from tollms.models.user import User

router = APIRouter(prefix="/api/v1/settings", tags=["settings"])


@router.get("/preferences", response_model=PreferencesRead)
def read_preferences(
    db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> PreferencesRead:
    return service.get_preferences(db, user)


@router.patch("/preferences", response_model=PreferencesRead)
def write_preferences(
    data: PreferencesUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> PreferencesRead:
    return service.update_preferences(db, user, data)


@router.patch("/profile", response_model=UserRead)
async def write_profile(
    data: ProfileUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> UserRead:
    updated = await service.update_profile(db, user, data)
    return auth_service.read_user(updated)


@router.post("/password")
async def change_password(
    data: PasswordChange,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, object]:
    revoked = await service.change_password(
        db, user, data, keep_session_id=get_current_session_id(request)
    )
    return {"status": "password changed", "revoked_sessions": revoked}


@router.get("/sessions", response_model=SessionsRead)
async def list_sessions(
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> SessionsRead:
    return await service.list_sessions(db, user.id, get_current_session_id(request))


@router.delete("/sessions/{session_id}", response_model=RevokedRead)
async def revoke_session(
    session_id: str,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> RevokedRead:
    await service.revoke_session(db, user.id, session_id, get_current_session_id(request))
    return RevokedRead(session_id=session_id)


@router.post("/sessions/revoke-others", response_model=RevokeOthersRead)
async def revoke_other_sessions(
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> RevokeOthersRead:
    revoked = await service.revoke_other_sessions(user.id, get_current_session_id(request))
    return RevokeOthersRead(revoked=revoked)
