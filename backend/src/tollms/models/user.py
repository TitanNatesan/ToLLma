"""User identity table. Foundation for organizations/teams/RBAC/billing —
ownership columns on user-owned tables reference this."""

import enum
import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, Enum, Index, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from tollms.db.base import SoftDeleteMixin, TimestampedModel

if TYPE_CHECKING:
    from tollms.models.conversation import Conversation
    from tollms.models.provider import Provider


class AuthProvider(str, enum.Enum):
    EMAIL = "EMAIL"
    GOOGLE = "GOOGLE"


class User(SoftDeleteMixin, TimestampedModel):
    __tablename__ = "users"
    __table_args__ = (
        # Email unique among live rows (lets deleted accounts free the address).
        Index("uq_users_email_live", "email", unique=True, postgresql_where=text("is_deleted = false")),
        Index("uq_users_google_id", "google_id", unique=True),
        # Username handle unique among live, non-null rows.
        Index(
            "uq_users_username_live", "username", unique=True,
            postgresql_where=text("is_deleted = false AND username IS NOT NULL"),
        ),
        Index("ix_users_created", "created_at"),
        # One identity per (provider, provider_user_id): a Google subject maps
        # to exactly one live account.
        Index(
            "uq_users_provider_identity", "provider", "provider_user_id", unique=True,
            postgresql_where=text("provider_user_id IS NOT NULL AND is_deleted = false"),
        ),
    )

    email: Mapped[str] = mapped_column(String(320), nullable=False)
    password_hash: Mapped[str | None] = mapped_column(Text, nullable=True)  # null for OAuth-only users
    # Auth identity (authoritative for provider-aware UI/API decisions).
    # "local" = email + password, "google" = Google OAuth.
    provider: Mapped[str] = mapped_column(
        String(16), nullable=False, default="local", server_default="local", index=True
    )
    provider_user_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Mirrors password_hash for provider-aware UI; maintained by auth helpers.
    has_password: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    full_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    username: Mapped[str | None] = mapped_column(String(30), nullable=True)
    email_verified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    auth_provider: Mapped[AuthProvider] = mapped_column(
        Enum(AuthProvider, name="auth_provider"), default=AuthProvider.EMAIL, nullable=False
    )
    google_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    avatar_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Per-user UI/chat preferences (accent, enter behavior, thinking default,
    # auto-scroll, animations). JSONB so new preferences ship without a migration.
    preferences: Mapped[dict] = mapped_column(
        "preferences", JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb")
    )

    providers: Mapped[list["Provider"]] = relationship(back_populates="owner")
    conversations: Mapped[list["Conversation"]] = relationship(back_populates="owner")
