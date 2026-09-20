"""Settings request/response models: preferences, profile, password, sessions."""

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, EmailStr, Field, field_validator

AccentName = Literal["green", "blue", "purple", "orange", "red", "cyan", "pink", "custom"]
EnterBehavior = Literal["send", "newline"]

DEFAULT_PREFERENCES: dict[str, Any] = {
    "accent": "green",
    "accent_color": None,
    "enter_behavior": "send",
    "default_thinking_level": None,
    "auto_scroll": True,
    "stream_animations": True,
}


class PreferencesRead(BaseModel):
    accent: AccentName = "green"
    accent_color: str | None = None
    enter_behavior: EnterBehavior = "send"
    default_thinking_level: str | None = None
    auto_scroll: bool = True
    stream_animations: bool = True


class PreferencesUpdate(BaseModel):
    accent: AccentName | None = None
    accent_color: str | None = None
    enter_behavior: EnterBehavior | None = None
    default_thinking_level: str | None = Field(default=None, max_length=32)
    auto_scroll: bool | None = None
    stream_animations: bool | None = None

    @field_validator("accent_color")
    @classmethod
    def _hex_color(cls, value: str | None) -> str | None:
        if value is None:
            return None
        text = value.strip()
        if not text:
            return None
        if len(text) != 7 or not text.startswith("#"):
            raise ValueError("accent_color must be a #rrggbb hex value")
        try:
            int(text[1:], 16)
        except ValueError:
            raise ValueError("accent_color must be a #rrggbb hex value") from None
        return text.lower()


class ProfileUpdate(BaseModel):
    full_name: str | None = Field(default=None, max_length=255)
    username: str | None = Field(default=None, max_length=30)
    email: EmailStr | None = None
    avatar_url: str | None = Field(default=None, max_length=2048)

    @field_validator("full_name")
    @classmethod
    def _name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.strip() or None

    @field_validator("username")
    @classmethod
    def _username(cls, value: str | None) -> str | None:
        if value is None:
            return None
        text = value.strip().lower()
        if not text:
            return None
        if not (3 <= len(text) <= 30) or not all(c.isalnum() or c in "_-." for c in text):
            raise ValueError("username must be 3-30 characters (letters, numbers, _ - .)")
        return text

    @field_validator("avatar_url")
    @classmethod
    def _avatar(cls, value: str | None) -> str | None:
        if value is None:
            return None
        text = value.strip()
        if not text:
            return None
        if not (text.startswith("http://") or text.startswith("https://")):
            raise ValueError("avatar_url must be an http(s) URL")
        return text


class PasswordChange(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)


class SessionRead(BaseModel):
    """One live login session, enriched with durable usage aggregates."""

    id: str
    current: bool
    device: str
    browser: str
    os: str
    ip: str | None
    login_method: str
    created_at: datetime | None
    last_seen: datetime | None
    requests: int = 0
    tokens: int = 0


class SessionsRead(BaseModel):
    sessions: list[SessionRead]
    total: int


class RevokeOthersRead(BaseModel):
    revoked: int


class RevokedRead(BaseModel):
    status: str = "revoked"
    session_id: str | None = None
