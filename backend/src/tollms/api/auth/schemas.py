"""Auth request/response models. Tokens travel via httpOnly cookies in
browsers; the same endpoints accept/return Bearer tokens for API clients."""

import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr, Field

from tollms.models.user import AuthProvider


class SignupRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    full_name: str | None = Field(default=None, max_length=255)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class RefreshRequest(BaseModel):
    refresh_token: str | None = None  # falls back to the refresh_token cookie


class UserRead(BaseModel):
    id: uuid.UUID
    email: str
    full_name: str | None
    username: str | None = None
    email_verified: bool
    platform_role: str = "user"
    auth_provider: AuthProvider
    # Provider-aware surface: "local" shows password management, "google" does not.
    provider: str = "local"
    has_password: bool = False
    pending_email: str | None = None
    avatar_url: str | None
    created_at: datetime
    deletion_requested_at: datetime | None = None
    deletion_scheduled_for: datetime | None = None


class AuthResponse(BaseModel):
    user: UserRead
    access_token: str | None = None
    # Whether the verification email was accepted for delivery. False means
    # SMTP failed — the account/session still exist, the user just got no mail.
    verification_sent: bool
    # Non-prod only: lets e2e/dev complete verification without an inbox.
    debug_verification_token: str | None = None


class VerifyResponse(BaseModel):
    user: UserRead
    message: str = "email verified"


class ResendVerificationResponse(BaseModel):
    sent: bool
    cooldown_seconds: int = 0


class RefreshResponse(BaseModel):
    user: UserRead
    access_token: str | None = None
    # Rotated refresh token for non-cookie API clients (cookies carry it too).
    refresh_token: str | None = None


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str = Field(min_length=16, max_length=256)
    password: str = Field(min_length=8, max_length=128)


class GenericSuccess(BaseModel):
    """Always returned by forgot-password: never reveals whether the account exists."""

    success: bool = True


class ResetValidationResponse(BaseModel):
    valid: bool
    email: str | None = None


class ResetPasswordResponse(BaseModel):
    success: bool = True
    email: str
    message: str = "Password updated successfully."


class RestoreRequest(BaseModel):
    """Cancel a pending account deletion. Re-auth mirrors delete-request:
    local-with-password accounts pass `current_password`; passwordless
    accounts rely on a recent Google-method session instead."""

    current_password: str | None = Field(default=None, min_length=1, max_length=128)
