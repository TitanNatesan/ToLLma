"""Authentication: signup, email verification, password + Google login,
JWT pairs, Valkey sessions, logout. PostgreSQL owns users; Valkey owns
sessions and one-time tokens."""

import hashlib
import logging
import secrets
import uuid
from datetime import datetime, timedelta, timezone

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from tollms.core import security
from tollms.core.config import get_settings
from tollms.core.exceptions import AuthenticationError, NotFoundError, ValidationError
from tollms.models.password_reset import PasswordResetToken
from tollms.models.user import AuthProvider, User
from tollms.services.cache import keys as cache_keys
from tollms.services.cache.manager import get_manager
from tollms.services.email import send_password_reset_email, send_verification_email

logger = logging.getLogger(__name__)

_VERIFY_TTL = 86400  # 24h, mirrors verification_token_hours default
_OAUTH_STATE_TTL = 600


def normalize_email(email: str) -> str:
    return email.strip().lower()


def get_by_email(db: Session, email: str) -> User | None:
    return db.scalar(
        select(User).where(User.email == normalize_email(email), User.is_deleted.is_(False))
    )


def _read(user: User):
    from tollms.api.auth.schemas import UserRead

    return UserRead(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        username=user.username,
        email_verified=user.email_verified,
        auth_provider=user.auth_provider,
        provider=user.provider,
        has_password=user.has_password,
        avatar_url=user.avatar_url,
        created_at=user.created_at,
    )


# --- identity + password helpers --------------------------------------------
# `provider`/`provider_user_id` are authoritative for provider-aware behaviour;
# the legacy auth_provider/google_id columns stay in sync for existing readers.


def set_local_identity(user: User) -> None:
    user.provider = "local"
    user.auth_provider = AuthProvider.EMAIL


def set_google_identity(user: User, google_id: str) -> None:
    user.provider = "google"
    user.provider_user_id = google_id
    user.auth_provider = AuthProvider.GOOGLE
    user.google_id = google_id


def link_google_identity(user: User, google_id: str) -> None:
    """Attach Google to an existing local account (keeps local password login)."""
    user.provider_user_id = google_id
    user.google_id = google_id


def set_password(user: User, password: str) -> None:
    """Single write path for local passwords (policy + has_password mirror)."""
    security.validate_password_strength(password)
    user.password_hash = security.hash_password(password)
    user.has_password = True


def is_local_user(user: User) -> bool:
    return user.provider == "local" and user.has_password


def read_user(user: User):
    return _read(user)


async def signup(db: Session, email: str, password: str, full_name: str | None) -> tuple[User, str]:
    """Create an UNVERIFIED user and dispatch the verification email.
    Returns (user, verification_token)."""
    address = normalize_email(email)
    if get_by_email(db, address) is not None:
        raise ValidationError("email already registered")
    user = User(
        email=address,
        full_name=(full_name or "").strip() or None,
    )
    set_local_identity(user)
    set_password(user, password)
    db.add(user)
    db.commit()
    db.refresh(user)
    token = await issue_verification(db, user)
    logger.info("user signed up: %s", user.id)
    return user, token


async def issue_verification(db: Session, user: User) -> str:
    """Mint a one-time verification token, store its hash in Valkey, email the link."""
    token = security.create_verification_token(user.id, user.email)
    digest = hashlib.sha256(token.encode()).hexdigest()
    await get_manager().set(cache_keys.verify_email(digest), {"user_id": str(user.id)}, ttl=_VERIFY_TTL)
    url = f"{get_settings().frontend_url.rstrip('/')}/verify?token={token}"
    send_verification_email(user.email, url)
    return token


async def verify_email(db: Session, token: str) -> User:
    """Consume a verification token: activate the account. Single-use, 24h."""
    payload = security.decode_token(token)
    if payload is None or payload.get("type") != "verify_email":
        raise ValidationError("invalid or expired verification link")
    manager = get_manager()
    key = cache_keys.verify_email(hashlib.sha256(token.encode()).hexdigest())
    stored = await manager.get(key)
    if not isinstance(stored, dict) or stored.get("user_id") != payload.get("sub"):
        # Idempotent replay: a valid link for an already-verified address
        # still succeeds (email scanners pre-fetch; StrictMode double-fires).
        try:
            user_id = uuid.UUID(str(payload["sub"]))
        except ValueError:
            raise ValidationError("invalid verification link") from None
        user = db.get(User, user_id)
        if (
            user is not None
            and not user.is_deleted
            and user.email_verified
            and user.email == str(payload.get("email", "")).strip().lower()
        ):
            return user
        raise ValidationError("verification link already used or expired")
    try:
        user_id = uuid.UUID(str(payload["sub"]))
    except ValueError:
        raise ValidationError("invalid verification link") from None
    user = db.get(User, user_id)
    if user is None or user.is_deleted:
        raise NotFoundError("account not found")
    user.email_verified = True
    db.commit()
    await manager.delete(key)
    logger.info("user verified: %s", user.id)
    return user


async def login(
    db: Session,
    email: str,
    password: str,
    *,
    user_agent: str | None = None,
    ip: str | None = None,
) -> tuple[User, str, str, str]:
    """Password login. Returns (user, access_token, refresh_token, session_id)."""
    user = get_by_email(db, email)
    if user is None or not user.is_active:
        raise AuthenticationError("invalid email or password")
    if not security.verify_password(password, user.password_hash):
        raise AuthenticationError("invalid email or password")
    user.last_login_at = datetime.now(timezone.utc)
    db.commit()
    session_id = await security.create_session(
        user.id, user.email, "password", user_agent=user_agent, ip=ip
    )
    logger.info("user logged in: %s (password)", user.id)
    return (
        user,
        security.create_access_token(user.id, user.email, session_id),
        security.create_refresh_token(user.id, session_id),
        session_id,
    )


async def refresh(db: Session, refresh_token: str) -> tuple[User, str]:
    """Exchange a live refresh token for a new access token (same session)."""
    payload = security.decode_token(refresh_token)
    if payload is None or payload.get("type") != "refresh":
        raise AuthenticationError("invalid or expired refresh token")
    try:
        user_id = uuid.UUID(str(payload["sub"]))
    except ValueError:
        raise AuthenticationError("invalid refresh token") from None
    session = await security.get_session(str(payload.get("sid", "")))
    if session is None or session.get("user_id") != str(user_id):
        raise AuthenticationError("session expired")
    user = db.get(User, user_id)
    if user is None or user.is_deleted or not user.is_active:
        raise AuthenticationError("account unavailable")
    await security.touch_session(str(payload["sid"]))
    return user, security.create_access_token(user.id, user.email, str(payload["sid"]))


async def logout(session_id: str) -> None:
    """Invalidate the session: kills access + refresh tokens at once."""
    await security.destroy_session(session_id)


# --- Google OAuth ----------------------------------------------------------


def _google_config() -> tuple[str, str, str]:
    settings = get_settings()
    if not (settings.google_client_id and settings.google_client_secret and settings.google_redirect_uri):
        raise ValidationError("google login is not configured")
    return settings.google_client_id, settings.google_client_secret, settings.google_redirect_uri


async def google_login_url() -> tuple[str, str]:
    """Authorization URL + state (state lives in Valkey for 10 minutes)."""
    client_id, _, redirect_uri = _google_config()
    state = secrets.token_urlsafe(24)
    await get_manager().set(cache_keys.oauth_state(state), {"created": True}, ttl=_OAUTH_STATE_TTL)
    url = (
        "https://accounts.google.com/o/oauth2/v2/auth"
        f"?client_id={client_id}&redirect_uri={redirect_uri}"
        "&response_type=code&scope=openid%20email%20profile&access_type=online"
        f"&state={state}"
    )
    return url, state


async def exchange_google_code(code: str) -> dict:
    """Code -> Google tokens. Split for test monkeypatching."""
    _, secret, redirect_uri = _google_config()
    settings = get_settings()
    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.post(
            "https://oauth2.googleapis.com/token",
            data={
                "code": code,
                "client_id": settings.google_client_id,
                "client_secret": secret,
                "redirect_uri": redirect_uri,
                "grant_type": "authorization_code",
            },
        )
    if response.status_code != 200:
        logger.warning("google token exchange failed: %s", response.status_code)
        raise AuthenticationError("google login failed")
    return response.json()


async def fetch_google_userinfo(access_token: str) -> dict:
    """Google access token -> profile. Split for test monkeypatching."""
    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.get(
            "https://www.googleapis.com/oauth2/v3/userinfo",
            headers={"Authorization": f"Bearer {access_token}"},
        )
    if response.status_code != 200:
        raise AuthenticationError("google login failed")
    return response.json()


async def handle_google_callback(
    db: Session, code: str, state: str, *, user_agent: str | None = None, ip: str | None = None
) -> tuple[User, str, str, str]:
    """Validate state, resolve the Google identity, find-or-create the user,
    and open a session. Returns (user, access, refresh, session_id)."""
    manager = get_manager()
    state_key = cache_keys.oauth_state(state)
    if await manager.get(state_key) is None:
        raise AuthenticationError("invalid oauth state")
    await manager.delete(state_key)
    tokens = await exchange_google_code(code)
    profile = await fetch_google_userinfo(str(tokens.get("access_token", "")))
    google_id = str(profile.get("sub", ""))
    email = normalize_email(str(profile.get("email", "")))
    if not google_id or not email:
        raise AuthenticationError("google login failed")
    user = db.scalar(
        select(User).where(User.google_id == google_id, User.is_deleted.is_(False))
    )
    if user is None:
        user = get_by_email(db, email)
        if user is not None and profile.get("email_verified"):
            link_google_identity(user, google_id)  # Google proved the address
            if user.provider == "local":
                user.email_verified = True
            else:
                set_google_identity(user, google_id)
        elif user is None:
            user = User(
                email=email,
                password_hash=None,
                full_name=str(profile.get("name") or "") or None,
                email_verified=bool(profile.get("email_verified", True)),
                avatar_url=str(profile.get("picture") or "") or None,
            )
            set_google_identity(user, google_id)
            db.add(user)
        else:
            raise AuthenticationError("email already registered with password login")
    user.last_login_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(user)
    session_id = await security.create_session(
        user.id, user.email, "google", user_agent=user_agent, ip=ip
    )
    logger.info("user logged in: %s (google)", user.id)
    return (
        user,
        security.create_access_token(user.id, user.email, session_id),
        security.create_refresh_token(user.id, session_id),
        session_id,
    )


# --- password reset ----------------------------------------------------------


def _reset_ttl_seconds() -> int:
    return max(1, get_settings().password_reset_ttl_minutes) * 60


def _reset_token_row(db: Session, token: str) -> PasswordResetToken | None:
    """Look up a usable token: exists, unused and unexpired."""
    if not token:
        return None
    row = db.scalar(
        select(PasswordResetToken).where(
            PasswordResetToken.token_hash == security.hash_reset_token(token)
        )
    )
    if row is None or row.used_at is not None:
        return None
    if row.expires_at <= datetime.now(timezone.utc):
        return None
    return row


def mask_email(email: str) -> str:
    """`jane.doe@example.com` -> `j***e@example.com` (never a full address)."""
    local, _, domain = email.partition("@")
    if not domain:
        return "***"
    if len(local) <= 2:
        masked = local[:1] + "***"
    else:
        masked = f"{local[0]}***{local[-1]}"
    return f"{masked}@{domain}"


async def forgot_password(db: Session, email: str, *, ip: str | None = None) -> None:
    """Request a reset link. Always a no-op success (no account enumeration).

    Reset emails are only sent to local accounts that actually have a password;
    Google-only accounts silently receive nothing.
    """
    user = get_by_email(db, normalize_email(email))
    if user is None or not is_local_user(user):
        logger.info("password reset requested for unknown or OAuth account")
        return

    token = security.generate_reset_token()
    ttl = _reset_ttl_seconds()
    db.add(
        PasswordResetToken(
            user_id=user.id,
            token_hash=security.hash_reset_token(token),
            expires_at=datetime.now(timezone.utc) + timedelta(seconds=ttl),
            request_ip=ip,
        )
    )
    db.commit()
    minutes = ttl // 60
    expires_in = "1 hour" if minutes == 60 else (f"{minutes} minutes" if minutes < 60 else f"{minutes // 60} hours")
    url = f"{get_settings().frontend_url.rstrip('/')}/auth/reset-password?token={token}"
    send_password_reset_email(user.email, url, expires_in)
    logger.info("password reset email queued for user %s", user.id)


def validate_reset_token(db: Session, token: str) -> dict:
    """Public token check for the reset page (no side effects)."""
    row = _reset_token_row(db, token)
    if row is None:
        return {"valid": False, "email": None}
    user = db.get(User, row.user_id)
    if user is None or user.is_deleted:
        return {"valid": False, "email": None}
    return {"valid": True, "email": mask_email(user.email)}


async def reset_password(db: Session, token: str, password: str) -> User:
    """Consume a reset token, set the password and invalidate every session."""
    row = _reset_token_row(db, token)
    if row is None:
        raise ValidationError("invalid or expired reset token")
    user = db.get(User, row.user_id)
    if user is None or user.is_deleted:
        raise ValidationError("invalid or expired reset token")
    if not is_local_user(user):
        raise ValidationError("this account does not use a local password")

    security.validate_password_strength(password)
    now = datetime.now(timezone.utc)
    set_password(user, password)
    row.used_at = now
    # Any other outstanding links are dead the moment one is used.
    for other in db.scalars(
        select(PasswordResetToken).where(
            PasswordResetToken.user_id == user.id,
            PasswordResetToken.used_at.is_(None),
            PasswordResetToken.id != row.id,
        )
    ):
        other.used_at = now
    db.commit()
    db.refresh(user)

    if get_settings().password_reset_invalidate_sessions:
        # keep_session_id="" revokes every session: force re-login everywhere.
        revoked = await security.revoke_other_sessions(user.id, "")
        logger.info("password reset for user %s (%d sessions revoked)", user.id, revoked)
    else:
        logger.info("password reset for user %s (sessions kept)", user.id)
    return user
