"""Auth endpoints only. Public (no login required). Cookies are the
browser contract; Bearer tokens serve API clients."""

import logging

from fastapi import APIRouter, Depends, Query, Request, Response
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from tollms.api.auth import service
from tollms.api.auth.schemas import (
    AuthResponse,
    LoginRequest,
    RefreshRequest,
    RefreshResponse,
    SignupRequest,
    UserRead,
    VerifyResponse,
)
from tollms.core import security
from tollms.core.config import get_settings
from tollms.core.deps import get_db
from tollms.core.security import ACCESS_COOKIE, REFRESH_COOKIE, SESSION_COOKIE, get_current_user
from tollms.models.user import User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])


def _cookie_flags() -> dict:
    secure = get_settings().environment == "prod"
    return {"httponly": True, "samesite": "lax", "secure": secure, "path": "/"}


def _set_session_cookies(response: Response, access: str, refresh: str) -> None:
    settings = get_settings()
    flags = _cookie_flags()
    response.set_cookie(ACCESS_COOKIE, access, max_age=settings.access_token_minutes * 60, **flags)
    response.set_cookie(REFRESH_COOKIE, refresh, max_age=settings.refresh_token_days * 86400, **flags)
    response.set_cookie(SESSION_COOKIE, "1", max_age=settings.refresh_token_days * 86400,
                        samesite="lax", secure=flags["secure"], path="/")


def _clear_session_cookies(response: Response) -> None:
    for name in (ACCESS_COOKIE, REFRESH_COOKIE, SESSION_COOKIE):
        response.delete_cookie(name, path="/")


def _debug_token(token: str) -> str | None:
    if get_settings().environment != "prod":
        return token
    return None


@router.post("/signup", response_model=AuthResponse)
async def signup(
    data: SignupRequest, response: Response, request: Request, db: Session = Depends(get_db)
) -> AuthResponse:
    user, verify_token = await service.signup(db, str(data.email), data.password, data.full_name)
    session_id = await security.create_session(user.id, user.email, "password", **security.client_meta(request))
    access = security.create_access_token(user.id, user.email, session_id)
    refresh_tok = security.create_refresh_token(user.id, session_id)
    _set_session_cookies(response, access, refresh_tok)
    return AuthResponse(
        user=service.read_user(user),
        access_token=access,
        debug_verification_token=_debug_token(verify_token),
    )


@router.get("/verify", response_model=VerifyResponse)
async def verify(token: str = Query(...), db: Session = Depends(get_db)) -> VerifyResponse:
    user = await service.verify_email(db, token)
    return VerifyResponse(user=service.read_user(user))


@router.post("/login", response_model=AuthResponse)
async def login(
    data: LoginRequest, response: Response, request: Request, db: Session = Depends(get_db)
) -> AuthResponse:
    user, access, refresh, _ = await service.login(db, str(data.email), data.password, **security.client_meta(request))
    _set_session_cookies(response, access, refresh)
    return AuthResponse(user=service.read_user(user), access_token=access)


@router.get("/google/login")
async def google_login() -> RedirectResponse:
    url, _ = await service.google_login_url()
    return RedirectResponse(url)


@router.get("/google/callback")
async def google_callback(request: Request, code: str = Query(...), state: str = Query(...),
                          db: Session = Depends(get_db)) -> RedirectResponse:
    user, access, refresh, _ = await service.handle_google_callback(
        db, code, state, **security.client_meta(request)
    )
    redirect = RedirectResponse(f"{get_settings().frontend_url.rstrip('/')}/auth/callback")
    _set_session_cookies(redirect, access, refresh)
    logger.info("google oauth complete: %s", user.id)
    return redirect


@router.post("/refresh", response_model=RefreshResponse)
async def refresh(request: Request, response: Response, data: RefreshRequest | None = None,
                  db: Session = Depends(get_db)) -> RefreshResponse:
    token = (data.refresh_token if data else None) or request.cookies.get(REFRESH_COOKIE)
    if not token:
        from tollms.core.exceptions import AuthenticationError

        raise AuthenticationError("missing refresh token")
    user, access = await service.refresh(db, token)
    response.set_cookie(ACCESS_COOKIE, access,
                        max_age=get_settings().access_token_minutes * 60, **_cookie_flags())
    return RefreshResponse(user=service.read_user(user), access_token=access)


@router.post("/logout")
async def logout(request: Request, response: Response) -> dict[str, str]:
    token = request.cookies.get(ACCESS_COOKIE)
    if token is None:
        auth = request.headers.get("authorization", "")
        if auth.lower().startswith("bearer "):
            token = auth[7:].strip() or None
    if token:
        payload = security.decode_token(token)
        if payload is not None and payload.get("sid"):
            await service.logout(str(payload["sid"]))
    _clear_session_cookies(response)
    return {"status": "logged out"}


@router.get("/me", response_model=UserRead)
async def me(user: User = Depends(get_current_user)) -> UserRead:
    return service.read_user(user)
