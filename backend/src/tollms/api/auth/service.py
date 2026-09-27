"""Authentication: signup, email verification, password + Google login,
JWT pairs, Valkey sessions, logout. PostgreSQL owns users; Valkey owns
sessions and one-time tokens."""

import base64
import hashlib
import logging
import secrets
import uuid
from datetime import datetime, timedelta, timezone

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from tollms.core import rate_limit as auth_limits
from tollms.core import security
from tollms.core.config import get_settings
from tollms.core.exceptions import (
    AuthenticationError,
    ConflictError,
    ForbiddenError,
    NotFoundError,
    TooManyRequestsError,
    ValidationError,
)
from tollms.models.password_reset import PasswordResetToken
from tollms.models.user import AuthProvider, User
from tollms.services.cache import keys as cache_keys
from tollms.services.cache.manager import get_manager
from tollms.services.email import (
    send_account_restored,
    send_email_change_notice,
    send_password_reset_email,
    send_verification_email,
)
from tollms.services.observability.events import emit

logger = logging.getLogger(__name__)

_OAUTH_STATE_TTL = 600


def _verify_ttl_seconds() -> int:
    """Single source of truth: mirrors `verification_token_hours` (JWT exp)."""
    return max(1, get_settings().verification_token_hours) * 3600


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
        platform_role=user.platform_role.value,
        auth_provider=user.auth_provider,
        provider=user.provider,
        has_password=user.has_password,
        pending_email=user.pending_email,
        avatar_url=user.avatar_url,
        created_at=user.created_at,
        deletion_requested_at=user.deletion_requested_at,
        deletion_scheduled_for=user.deletion_scheduled_for,
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
    await get_manager().set(
        cache_keys.verify_email(digest), {"user_id": str(user.id)}, ttl=_verify_ttl_seconds()
    )
    url = f"{get_settings().frontend_url.rstrip('/')}/verify?token={token}"
    send_verification_email(user.email, url)
    return token


async def issue_email_change_verification(db: Session, user: User, new_address: str) -> str:
    """Mint a change-verification token bound to the NEW address and email it there.

    The token's `email` claim is the pending address (never the old one), so
    `verify_email` can require token-email == pending_email. No DB write here:
    callers stage pending_email/requested_at themselves.
    """
    address = normalize_email(new_address)
    token = security.create_verification_token(user.id, address)
    digest = hashlib.sha256(token.encode()).hexdigest()
    await get_manager().set(
        cache_keys.verify_email(digest), {"user_id": str(user.id)}, ttl=_verify_ttl_seconds()
    )
    url = f"{get_settings().frontend_url.rstrip('/')}/verify?token={token}"
    send_verification_email(address, url)
    return token


def send_email_change_notice_to_old(user_email: str, new_address: str, requested_at: datetime) -> None:
    """Fact-only notice to the OLD address. Never carries tokens or links."""
    send_email_change_notice(
        user_email,
        normalize_email(new_address),
        requested_at.astimezone(timezone.utc).isoformat(),
    )


async def verify_email(db: Session, token: str) -> User:
    """Consume a verification token: activate the account. Single-use, 24h.

    Change-verification (user.pending_email set): the token email must equal
    the pending address and the request must be unexpired (24h verification
    TTL from pending_email_requested_at); success swaps the email, clears the
    pending fields and marks verified. Signup-verification (no pending) keeps
    the historical behavior.
    """
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
    if user.pending_email:
        pending = normalize_email(user.pending_email)
        if str(payload.get("email", "")).strip().lower() != pending:
            raise ValidationError("invalid or expired verification link")
        requested_at = user.pending_email_requested_at
        if requested_at is None:
            raise ValidationError("invalid or expired verification link")
        if requested_at.tzinfo is None:
            requested_at = requested_at.replace(tzinfo=timezone.utc)
        if (datetime.now(timezone.utc) - requested_at).total_seconds() > _verify_ttl_seconds():
            raise ValidationError("verification link expired")
        user.email = pending
        user.pending_email = None
        user.pending_email_requested_at = None
        user.email_verified = True
        db.commit()
        await manager.delete(key)
        logger.info("user email changed via verification: %s", user.id)
        return user
    user.email_verified = True
    db.commit()
    await manager.delete(key)
    logger.info("user verified: %s", user.id)
    return user


async def resend_verification(db: Session, user: User) -> tuple[bool, int]:
    """Re-send the verification email with a per-user Valkey cooldown.

    Returns (sent, cooldown_seconds). Already-verified is idempotent
    (no email). Raises 429 while cooling, 503 when Valkey is down.
    Audit logs carry user_id + outcome only, never tokens or emails.

    While an email change is pending the link re-sends to the PENDING
    address (even for already-verified users whose current address is
    verified) — the current address needs no proof.
    """
    if user.pending_email:
        pending = normalize_email(user.pending_email)
        cooldown = max(1, get_settings().verification_resend_cooldown_seconds)
        try:
            await auth_limits.check_fixed_window(
                key=cache_keys.auth_rate_limit("auth:resend-cooldown", str(user.id)),
                limit=1,
                window_seconds=cooldown,
                scope="auth:resend-cooldown",
            )
        except TooManyRequestsError as exc:
            logger.warning(
                "verification resend cooldown (pending change): user_id=%s retry_after=%s",
                user.id, exc.retry_after,
            )
            raise
        await issue_email_change_verification(db, user, pending)
        logger.info(
            "verification resend sent (pending change): user_id=%s masked=%s cooldown=%ds",
            user.id, mask_email(pending), cooldown,
        )
        return True, cooldown
    if user.email_verified:
        logger.info("verification resend skipped (already verified): user_id=%s", user.id)
        return False, 0
    cooldown = max(1, get_settings().verification_resend_cooldown_seconds)
    try:
        await auth_limits.check_fixed_window(
            key=cache_keys.auth_rate_limit("auth:resend-cooldown", str(user.id)),
            limit=1,
            window_seconds=cooldown,
            scope="auth:resend-cooldown",
        )
    except TooManyRequestsError as exc:
        logger.warning(
            "verification resend cooldown: user_id=%s retry_after=%s", user.id, exc.retry_after
        )
        raise
    await issue_verification(db, user)
    logger.info(
        "verification resend sent: user_id=%s masked=%s cooldown=%ds",
        user.id, mask_email(user.email), cooldown,
    )
    return True, cooldown


async def login(
    db: Session,
    email: str,
    password: str,
    *,
    user_agent: str | None = None,
    ip: str | None = None,
) -> tuple[User, str, str, str]:
    """Password login. Returns (user, access_token, refresh_token, session_id).

    Failed attempts are tracked per email+IP in Valkey with a temporary
    lockout (429 while locked, 503 when Valkey is down — fail closed).
    Audit logs carry the masked email only, never passwords or tokens.
    """
    address = normalize_email(email)
    await auth_limits.check_login_lockout(address, ip)
    user = get_by_email(db, address)
    if user is None or not user.is_active or not security.verify_password(password, user.password_hash):
        await auth_limits.record_failed_login(address, ip)
        logger.warning("login failed for %s", mask_email(address))
        emit("auth.login_failed", method="password")
        raise AuthenticationError("invalid email or password")
    await auth_limits.clear_failed_logins(address, ip)
    user.last_login_at = datetime.now(timezone.utc)
    db.commit()
    refresh_jti = security.generate_refresh_jti()
    session_id = await security.create_session(
        user.id, user.email, "password", user_agent=user_agent, ip=ip,
        refresh_jti=refresh_jti,
    )
    logger.info("user logged in: %s (password)", user.id)
    emit("auth.login", user_id=str(user.id), method="password")
    return (
        user,
        security.create_access_token(user.id, user.email, session_id),
        security.create_refresh_token(user.id, session_id, refresh_jti),
        session_id,
    )


async def refresh(db: Session, refresh_token: str) -> tuple[User, str, str]:
    """Rotate a live refresh token: invalidates the presented jti, issues new pair.

    Reuse (stale jti, or any unexpired refresh for an unknown session) revokes
    the entire family and denies. Absolute lifetime + idle timeout deny with
    re-login. Returns (user, new_access_token, new_refresh_token).
    """
    payload = security.decode_token(refresh_token)
    if payload is None or payload.get("type") != "refresh":
        raise AuthenticationError("invalid or expired refresh token")
    try:
        user_id = uuid.UUID(str(payload["sub"]))
    except ValueError:
        raise AuthenticationError("invalid refresh token") from None
    sid = str(payload.get("sid", ""))
    presented_jti = payload.get("jti")
    session = await security.get_session(sid)
    if session is None or session.get("user_id") != str(user_id):
        # Orphaned but decodable refresh (rotated-out, logged-out, revoked):
        # never resurrect; treat as reuse-suspect and kill the family.
        await security.revoke_all_user_sessions(user_id)
        logger.warning("refresh reuse suspected (unknown session): user_id=%s", user_id)
        emit("auth.refresh_reuse", user_id=str(user_id), outcome="revoked")
        raise AuthenticationError("session expired")
    if security.session_bounds_error(session) is not None:
        await security.destroy_session(sid)
        raise AuthenticationError("session expired")
    stored_jti = session.get("refresh_jti")
    if (
        isinstance(stored_jti, str)
        and stored_jti
        and isinstance(presented_jti, str)
        and presented_jti
        and presented_jti != stored_jti
    ):
        revoked = await security.revoke_all_user_sessions(user_id)
        logger.warning(
            "refresh token reuse detected: user_id=%s sessions_revoked=%d", user_id, revoked
        )
        emit("auth.refresh_reuse", user_id=str(user_id), sessions_revoked=revoked)
        raise AuthenticationError("session expired")
    user = db.get(User, user_id)
    if user is None or user.is_deleted or not user.is_active:
        raise AuthenticationError("account unavailable")
    new_jti = await security.rotate_session_refresh(sid, session)
    emit("auth.refresh", user_id=str(user_id))
    return (
        user,
        security.create_access_token(user.id, user.email, sid),
        security.create_refresh_token(user.id, sid, new_jti),
    )


async def logout(session_id: str) -> None:
    """Invalidate the session: kills access + refresh tokens at once."""
    await security.destroy_session(session_id)


async def logout_with_tokens(access_token: str | None, refresh_token: str | None) -> int:
    """Destroy sessions referenced by either token. Returns sessions revoked.

    Refresh fallback: when the access token is missing or expired its `sid`
    is unrecoverable, so a live refresh token (cookie or body) is decoded for
    the same purpose. Unknown/expired tokens are skipped; logout never fails.
    Stale refreshes (old jti after rotation) only destroy by `sid` — they
    never resurrect a session and never trigger family revocation here.
    """
    revoked = 0
    for token in (access_token, refresh_token):
        if not token:
            continue
        try:
            payload = security.decode_token(token)
        except Exception:
            logger.warning("logout token decode failed", exc_info=True)
            continue
        if payload is None or payload.get("type") not in ("access", "refresh"):
            continue
        sid = payload.get("sid")
        if not sid:
            continue
        try:
            await security.destroy_session(str(sid))
            revoked += 1
        except Exception:
            logger.exception("logout session destroy failed")
    emit("auth.logout", sessions_revoked=revoked)
    return revoked


# --- Google OAuth ----------------------------------------------------------


def _google_config() -> tuple[str, str, str]:
    settings = get_settings()
    if not (settings.google_client_id and settings.google_client_secret and settings.google_redirect_uri):
        raise ValidationError("google login is not configured")
    return settings.google_client_id, settings.google_client_secret, settings.google_redirect_uri


_MAX_OAUTH_NAME_LEN = 255
_MAX_OAUTH_SUB_LEN = 255
_MAX_OAUTH_AVATAR_LEN = 2048


def _hash_user_agent(user_agent: str | None) -> str:
    """SHA-256 of the UA for state binding. Hash only — never the raw UA."""
    return hashlib.sha256((user_agent or "").encode("utf-8")).hexdigest()


def _state_digest(state: str) -> str:
    """Short non-reversible id for audit logs (never the raw state)."""
    return hashlib.sha256(state.encode("utf-8")).hexdigest()[:16]


def _generate_code_verifier() -> str:
    """PKCE verifier: 86 chars, inside the RFC 7636 43-128 window."""
    return secrets.token_urlsafe(64)


def _code_challenge(verifier: str) -> str:
    """S256 challenge for the authorization URL (Google-compliant)."""
    digest = hashlib.sha256(verifier.encode("utf-8")).digest()
    return base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")


def _sanitize_oauth_name(value: object) -> str | None:
    """Display name: stripped, truncated to 255, never crashes."""
    if not isinstance(value, str):
        return None
    text = value.strip()
    if not text:
        return None
    return text[:_MAX_OAUTH_NAME_LEN]


def _sanitize_oauth_avatar(value: object) -> str | None:
    """Avatar URL: https-only + max 2048. Violations are omitted, never crash."""
    if not isinstance(value, str):
        return None
    text = value.strip()
    if not text or len(text) > _MAX_OAUTH_AVATAR_LEN:
        return None
    if not text.startswith("https://"):
        return None
    return text


async def google_login_url(
    user_agent: str | None = None, ip: str | None = None
) -> tuple[str, str]:
    """Authorization URL + state (state lives in Valkey for 10 minutes).

    The state record binds the flow: separate nonce, UA hash, IP,
    creation time and the PKCE verifier. Fail-closed: the callback
    re-checks UA/IP equality and consumes the record single-use.
    """
    client_id, _, redirect_uri = _google_config()
    state = secrets.token_urlsafe(24)
    nonce = secrets.token_urlsafe(24)
    verifier = _generate_code_verifier()
    challenge = _code_challenge(verifier)
    record = {
        "nonce": nonce,
        "ua_hash": _hash_user_agent(user_agent),
        "ip": ip or "",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "code_verifier": verifier,
    }
    await get_manager().set(cache_keys.oauth_state(state), record, ttl=_OAUTH_STATE_TTL)
    url = (
        "https://accounts.google.com/o/oauth2/v2/auth"
        f"?client_id={client_id}&redirect_uri={redirect_uri}"
        "&response_type=code&scope=openid%20email%20profile&access_type=online"
        f"&state={state}"
        f"&code_challenge={challenge}&code_challenge_method=S256"
    )
    return url, state


async def exchange_google_code(code: str, code_verifier: str | None = None) -> dict:
    """Code -> Google tokens. Split for test monkeypatching."""
    _, secret, redirect_uri = _google_config()
    settings = get_settings()
    data = {
        "code": code,
        "client_id": settings.google_client_id,
        "client_secret": secret,
        "redirect_uri": redirect_uri,
        "grant_type": "authorization_code",
    }
    if code_verifier:
        data["code_verifier"] = code_verifier
    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.post(
            "https://oauth2.googleapis.com/token",
            data=data,
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
    stored = await manager.get(state_key)
    if not isinstance(stored, dict):
        raise AuthenticationError("invalid oauth state")
    # Single-use: consume before any further check so replays always fail.
    await manager.delete(state_key)
    digest = _state_digest(state)
    if stored.get("ua_hash") != _hash_user_agent(user_agent):
        logger.warning("google oauth ua mismatch: state_hash=%s", digest)
        emit("oauth.deny", reason="ua_mismatch")
        raise ForbiddenError("oauth session mismatch, please re-initiate login")
    if not isinstance(stored.get("ip"), str) or stored.get("ip") != (ip or ""):
        logger.warning("google oauth ip mismatch: state_hash=%s", digest)
        emit("oauth.deny", reason="ip_mismatch")
        raise ForbiddenError("oauth session mismatch, please re-initiate login")
    verifier = stored.get("code_verifier")
    if not isinstance(verifier, str) or not 43 <= len(verifier) <= 128:
        logger.warning("google oauth missing verifier: state_hash=%s", digest)
        emit("oauth.deny", reason="verifier")
        raise AuthenticationError("invalid oauth state")
    try:
        tokens = await exchange_google_code(code, verifier)
    except TypeError:
        # Legacy single-arg monkeypatch in older tests: retry without verifier.
        tokens = await exchange_google_code(code)  # type: ignore[call-arg]
    profile = await fetch_google_userinfo(str(tokens.get("access_token", "")))
    raw_sub = profile.get("sub", "")
    google_id = raw_sub.strip() if isinstance(raw_sub, str) else ""
    raw_email = profile.get("email", "")
    email = normalize_email(raw_email) if isinstance(raw_email, str) else ""
    if not google_id or len(google_id) > _MAX_OAUTH_SUB_LEN or not email:
        raise AuthenticationError("google login failed")
    email_verified = bool(profile.get("email_verified", False))
    full_name = _sanitize_oauth_name(profile.get("name"))
    avatar_url = _sanitize_oauth_avatar(profile.get("picture"))
    user = db.scalar(
        select(User).where(User.google_id == google_id, User.is_deleted.is_(False))
    )
    if user is None:
        user = get_by_email(db, email)
        if user is not None and email_verified:
            link_google_identity(user, google_id)  # Google proved the address
            if user.provider == "local":
                user.email_verified = True
            else:
                set_google_identity(user, google_id)
        elif user is None:
            user = User(
                email=email,
                password_hash=None,
                full_name=full_name,
                email_verified=email_verified,
                avatar_url=avatar_url,
            )
            set_google_identity(user, google_id)
            db.add(user)
        else:
            # Approved conservative collision posture: never link or merge on an
            # UNVERIFIED Google email — the claimant may not own the address.
            # Linking happens only above, on Google-verified email. Flow
            # unchanged on purpose; only the message explains the recovery.
            raise AuthenticationError(
                "email already registered with password login: "
                "verify your Google email, or log in with your password first "
                "and link Google from settings"
            )
    user.last_login_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(user)
    refresh_jti = security.generate_refresh_jti()
    session_id = await security.create_session(
        user.id, user.email, "google", user_agent=user_agent, ip=ip,
        refresh_jti=refresh_jti,
    )
    logger.info("user logged in: %s (google)", user.id)
    emit("auth.login", user_id=str(user.id), method="google")
    emit("oauth.callback", user_id=str(user.id), result="success")
    return (
        user,
        security.create_access_token(user.id, user.email, session_id),
        security.create_refresh_token(user.id, session_id, refresh_jti),
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

    Reset emails are only sent to accounts that actually have a password
    (`has_password`) — local accounts and Google users who later set one.
    Passwordless (OAuth-only) accounts silently receive nothing.
    """
    user = get_by_email(db, normalize_email(email))
    if user is None or not user.has_password:
        logger.info("password reset requested for unknown or passwordless account")
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
    # `has_password` (not provider): Google users who set a password reset it
    # here; passwordless accounts never hold a usable token for this path.
    if not user.has_password:
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
        emit("password.reset", user_id=str(user.id), sessions_revoked=revoked)
    else:
        logger.info("password reset for user %s (sessions kept)", user.id)
        emit("password.reset", user_id=str(user.id), sessions_revoked=0)
    return user


async def restore_account(
    db: Session, user: User, current_password: str | None, *, current_session_id: str | None = None
) -> User:
    """Cancel a pending account deletion. 409 when nothing is pending.

    Same fresh re-auth as delete-request, then clear all three deletion
    columns. API keys disabled at request time stay deleted (AR3) — restore
    never resurrects credentials. Mails the restored notice; audit log
    carries user_id only.
    """
    if user.deletion_scheduled_for is None:
        raise ConflictError("no pending account deletion")
    await security.require_fresh_confirmation(user, current_password, current_session_id)
    user.deletion_requested_at = None
    user.deletion_scheduled_for = None
    user.deletion_notice_stage = 0
    db.commit()
    db.refresh(user)
    # AR3: keys soft-deleted + invalidated at delete-request time stay
    # deleted — restoring access must mint new keys, never revive old ones.
    send_account_restored(user.email)
    logger.info("account deletion cancelled: user_id=%s", user.id)
    emit("account.restored", user_id=str(user.id))
    return user
