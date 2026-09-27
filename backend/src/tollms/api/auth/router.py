"""Auth endpoints only. Public (no login required). Cookies are the
browser contract; Bearer tokens serve API clients."""

import logging

from fastapi import APIRouter, Depends, Query, Request, Response
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from tollms.api.auth import service
from tollms.api.auth.schemas import (
    AuthResponse,
    ForgotPasswordRequest,
    GenericSuccess,
    LoginRequest,
    ResendVerificationResponse,
    ResetPasswordRequest,
    ResetPasswordResponse,
    ResetValidationResponse,
    RefreshRequest,
    RefreshResponse,
    RestoreRequest,
    SignupRequest,
    UserRead,
    VerifyResponse,
)
from tollms.core import security
from tollms.core import rate_limit
from tollms.core.config import get_settings
from tollms.core.deps import get_db
from tollms.core.security import ACCESS_COOKIE, REFRESH_COOKIE, SESSION_COOKIE, get_current_user
from tollms.models.user import User
from tollms.services.observability.events import emit

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
    data: SignupRequest, response: Response, request: Request, db: Session = Depends(get_db),
    _: None = Depends(rate_limit.limit("auth:signup")),
) -> AuthResponse:
    user, verify_token = await service.signup(db, str(data.email), data.password, data.full_name)
    refresh_jti = security.generate_refresh_jti()
    session_id = await security.create_session(
        user.id, user.email, "password", **security.client_meta(request),
        refresh_jti=refresh_jti,
    )
    access = security.create_access_token(user.id, user.email, session_id)
    refresh_tok = security.create_refresh_token(user.id, session_id, refresh_jti)
    _set_session_cookies(response, access, refresh_tok)
    return AuthResponse(
        user=service.read_user(user),
        access_token=access,
        debug_verification_token=_debug_token(verify_token),
    )


@router.get("/verify", response_model=VerifyResponse)
async def verify(
    token: str = Query(...), db: Session = Depends(get_db),
    _: None = Depends(rate_limit.limit("auth:verify")),
) -> VerifyResponse:
    user = await service.verify_email(db, token)
    return VerifyResponse(user=service.read_user(user))


@router.post("/resend-verification", response_model=ResendVerificationResponse)
async def resend_verification(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    _: None = Depends(rate_limit.limit("auth:resend")),
) -> ResendVerificationResponse:
    """Re-send the verification email. Unverified users only; verified is idempotent."""
    sent, cooldown = await service.resend_verification(db, user)
    return ResendVerificationResponse(sent=sent, cooldown_seconds=cooldown)


@router.post("/login", response_model=AuthResponse)
async def login(
    data: LoginRequest, response: Response, request: Request, db: Session = Depends(get_db),
    _: None = Depends(rate_limit.limit("auth:login")),
) -> AuthResponse:
    user, access, refresh, _ = await service.login(db, str(data.email), data.password, **security.client_meta(request))
    _set_session_cookies(response, access, refresh)
    return AuthResponse(user=service.read_user(user), access_token=access)


@router.get("/google/login")
async def google_login(
    request: Request,
    _: None = Depends(rate_limit.limit("auth:google-login")),
) -> RedirectResponse:
    url, _ = await service.google_login_url(**security.client_meta(request))
    logger.info("google oauth login initiated")
    emit("oauth.initiate", provider="google")
    return RedirectResponse(url)


@router.get("/google/callback")
async def google_callback(
    request: Request,
    code: str | None = Query(None),
    state: str | None = Query(None),
    error: str | None = Query(None),
    db: Session = Depends(get_db),
    _: None = Depends(rate_limit.limit("auth:google-callback")),
) -> RedirectResponse:
    if error is not None:
        # User denied at Google (e.g. ?error=access_denied): audit + exact
        # frontend contract. Never 422 for denials. Consume state single-use
        # when present, but never fail the denial path on it.
        from tollms.services.cache import keys as cache_keys
        from tollms.services.cache.manager import get_manager

        if state:
            try:
                await get_manager().delete(cache_keys.oauth_state(state))
            except Exception:
                logger.warning("google oauth denial state cleanup failed", exc_info=True)
        logger.info("google oauth denied by user: error=%s", error or "unknown")
        emit("oauth.deny", reason="user_denied", provider="google")
        frontend = get_settings().frontend_url.rstrip("/")
        return RedirectResponse(f"{frontend}/login?oauth_error=cancelled")
    if not code or not state:
        from tollms.core.exceptions import ValidationError

        raise ValidationError("missing oauth code or state")
    user, access, refresh, _ = await service.handle_google_callback(
        db, code, state, **security.client_meta(request)
    )
    redirect = RedirectResponse(f"{get_settings().frontend_url.rstrip('/')}/auth/callback")
    _set_session_cookies(redirect, access, refresh)
    logger.info("google oauth complete: %s", user.id)
    return redirect


@router.post("/refresh", response_model=RefreshResponse)
async def refresh(request: Request, response: Response, data: RefreshRequest | None = None,
                  db: Session = Depends(get_db),
                  _: None = Depends(rate_limit.limit("auth:refresh"))) -> RefreshResponse:
    token = (data.refresh_token if data else None) or request.cookies.get(REFRESH_COOKIE)
    if not token:
        from tollms.core.exceptions import AuthenticationError

        raise AuthenticationError("missing refresh token")
    user, access, new_refresh = await service.refresh(db, token)
    flags = _cookie_flags()
    response.set_cookie(ACCESS_COOKIE, access,
                        max_age=get_settings().access_token_minutes * 60, **flags)
    response.set_cookie(REFRESH_COOKIE, new_refresh,
                        max_age=get_settings().refresh_token_days * 86400, **flags)
    return RefreshResponse(
        user=service.read_user(user), access_token=access, refresh_token=new_refresh
    )


@router.post("/logout")
async def logout(
    request: Request, response: Response, data: RefreshRequest | None = None
) -> dict[str, str]:
    access = request.cookies.get(ACCESS_COOKIE)
    if access is None:
        auth = request.headers.get("authorization", "")
        if auth.lower().startswith("bearer "):
            access = auth[7:].strip() or None
    # Refresh fallback: derive the session even when the access token is
    # missing or expired. Cookies are always cleared — logout never fails.
    refresh_tok = (data.refresh_token if data else None) or request.cookies.get(REFRESH_COOKIE)
    await service.logout_with_tokens(access, refresh_tok)
    _clear_session_cookies(response)
    return {"status": "logged out"}


@router.get("/me", response_model=UserRead)
async def me(user: User = Depends(get_current_user)) -> UserRead:
    return service.read_user(user)


@router.post("/restore", response_model=UserRead)
async def restore(
    data: RestoreRequest, request: Request, db: Session = Depends(get_db),
    # get_current_user only: pending accounts are denied by
    # require_active_user, but restore must stay reachable while pending.
    user: User = Depends(get_current_user),
) -> UserRead:
    """Cancel a pending account deletion. 409 when nothing is pending."""
    restored = await service.restore_account(
        db, user, data.current_password,
        current_session_id=security.get_current_session_id(request),
    )
    return service.read_user(restored)


def _client_ip(request: Request) -> str | None:
    return request.client.host if request.client else None


@router.post("/forgot-password", response_model=GenericSuccess)
async def forgot_password(
    data: ForgotPasswordRequest, request: Request, db: Session = Depends(get_db),
    _: None = Depends(rate_limit.limit("auth:forgot-password")),
) -> GenericSuccess:
    """Request a reset link. Always succeeds; OAuth accounts are never emailed."""
    await service.forgot_password(db, data.email, ip=_client_ip(request))
    return GenericSuccess()


@router.get("/reset-password/validate", response_model=ResetValidationResponse)
def validate_reset_password(
    token: str = Query(min_length=16, max_length=256), db: Session = Depends(get_db),
    _: None = Depends(rate_limit.limit("auth:reset-validate")),
) -> ResetValidationResponse:
    return ResetValidationResponse.model_validate(service.validate_reset_token(db, token))


@router.post("/reset-password", response_model=ResetPasswordResponse)
async def reset_password(
    data: ResetPasswordRequest, db: Session = Depends(get_db),
    _: None = Depends(rate_limit.limit("auth:reset-password")),
) -> ResetPasswordResponse:
    user = await service.reset_password(db, data.token, data.password)
    return ResetPasswordResponse(email=user.email)
