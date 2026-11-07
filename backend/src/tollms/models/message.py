"""Message table + Role enum. Usage/cost stored per assistant message."""

import enum
import uuid
from datetime import datetime
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, CheckConstraint, DateTime, Enum, Float, ForeignKey, Index, Numeric, String, Text, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from tollms.db.base import SoftDeleteMixin, TimestampedModel

if TYPE_CHECKING:
    from tollms.models.api_key import ApiKey
    from tollms.models.attachment import Attachment


class Role(str, enum.Enum):
    SYSTEM = "system"
    USER = "user"
    ASSISTANT = "assistant"


class MessageStatus(str, enum.Enum):
    """Backend-owned generation lifecycle for assistant messages.

    The generation IS the assistant message row: generation_id == message id.
    User messages are always COMPLETED. Only the generation engine (plus the
    startup sweep) transitions these states — never the frontend.
    """

    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    CANCELLED = "cancelled"
    FAILED = "failed"


TERMINAL_STATUSES = frozenset({MessageStatus.COMPLETED, MessageStatus.CANCELLED, MessageStatus.FAILED})


class Message(SoftDeleteMixin, TimestampedModel):
    __tablename__ = "messages"
    __table_args__ = (
        Index("ix_messages_conversation", "conversation_id"),
        Index("ix_messages_created", "created_at"),
        Index("ix_messages_role", "role"),
        Index("ix_messages_user", "user_id"),
        Index("ix_messages_api_key", "api_key_id"),
        Index("ix_messages_status", "status"),
        # Analytics: user-scoped time-range scans (always filtered to role=ASSISTANT).
        Index("ix_messages_user_role_created", "user_id", "role", "created_at"),
        # Platform-admin aggregations (time + route dimensions).
        Index("ix_messages_created_status", "created_at", "status"),
        Index("ix_messages_provider_created", "provider_id", "created_at"),
        Index("ix_messages_model_created", "model_id", "created_at"),
        Index(
            "ix_messages_session_id", "session_id",
            postgresql_where=text("session_id IS NOT NULL"),
        ),
        # Identity safeguards (generation lifecycle):
        # - one live assistant message per conversation — a second insert
        #   fails instead of duplicating (IntegrityError -> 409 adopt).
        # - one row per (user, client_key) — same-key retries adopt.
        Index(
            "ix_one_active_assistant", "conversation_id", unique=True,
            postgresql_where=text(
                "role = 'ASSISTANT' AND status IN ('QUEUED', 'RUNNING') AND is_deleted IS FALSE"
            ),
        ),
        Index(
            "ix_messages_client_key", "user_id", "client_key", unique=True,
            postgresql_where=text("client_key IS NOT NULL"),
        ),
        # Versioned branching tree (spec sections 2-7, 11): every message has
        # at most one parent; siblings order by version_number. The unique
        # constraint cannot enforce root sequencing (PostgreSQL treats NULL
        # parent ids as distinct), so root versioning is service-sequenced
        # per conversation (see next_sibling_version).
        UniqueConstraint(
            "conversation_id", "parent_message_id", "version_number",
            name="uq_messages_sibling_version",
        ),
        CheckConstraint("version_number >= 1", name="ck_messages_version_positive"),
        CheckConstraint(
            "parent_message_id IS NULL OR parent_message_id != id",
            name="ck_messages_no_self_parent",
        ),
        Index("ix_messages_parent", "parent_message_id"),
        Index("ix_messages_conv_parent", "conversation_id", "parent_message_id"),
        Index(
            "ix_messages_roots", "conversation_id",
            postgresql_where=text("parent_message_id IS NULL"),
        ),
    )

    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False
    )
    role: Mapped[Role] = mapped_column(Enum(Role, name="message_role"), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False, default="")
    provider_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("providers.id"), nullable=True)
    # Attributing key for gateway-originated messages (NULL = web UI / legacy).
    api_key_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("api_keys.id", ondelete="SET NULL"), nullable=True
    )
    model_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("models.id"), nullable=True)
    # Branching tree: the message this node responds to (NULL = conversation
    # root; Rule B edits create additional roots). SET NULL keeps children
    # readable when a parent is hard-deleted; soft-deletes never cascade.
    parent_message_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("messages.id", ondelete="SET NULL", name="fk_messages_parent_message"),
        nullable=True,
        default=None,
    )
    # 1-based position among siblings sharing (conversation_id, parent).
    version_number: Mapped[int] = mapped_column(nullable=False, default=1, server_default="1")
    status: Mapped[MessageStatus] = mapped_column(
        Enum(MessageStatus, name="message_status"), nullable=False,
        default=MessageStatus.COMPLETED, server_default=MessageStatus.COMPLETED.name,
    )
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Structured error taxonomy (core.exceptions.ErrorCode) for actionable UI.
    error_code: Mapped[str | None] = mapped_column(String(48), nullable=True)
    # Generation details for media messages (generation_type/status/model/...).
    metadata_: Mapped[dict] = mapped_column("metadata", JSONB, default=dict, nullable=False)
    # Client idempotency key for the send that created this row. Same-key
    # retries adopt the existing generation instead of duplicating rows.
    client_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Auth session (JWT sid) that produced this row. Durable per-session
    # usage/activity for the session-management UI; null for legacy rows.
    session_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # Time to first streamed token (ms). None for non-streaming calls.
    ttfb_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    # True when usage/cost was estimated from text length instead of
    # provider-reported numbers — analytics reports data quality with this.
    usage_estimated: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    # Wall-clock duration of the normalized <think> phase, measured by the
    # generation engine (provider-agnostic). None when no reasoning streamed.
    thinking_ms: Mapped[int | None] = mapped_column(nullable=True)

    prompt_tokens: Mapped[int | None] = mapped_column(nullable=True)
    completion_tokens: Mapped[int | None] = mapped_column(nullable=True)
    total_tokens: Mapped[int | None] = mapped_column(nullable=True)
    cache_read_tokens: Mapped[int | None] = mapped_column(nullable=True)
    cache_write_tokens: Mapped[int | None] = mapped_column(nullable=True)
    reasoning_tokens: Mapped[int | None] = mapped_column(nullable=True)
    input_cost: Mapped[Decimal | None] = mapped_column(Numeric(12, 8), nullable=True)
    output_cost: Mapped[Decimal | None] = mapped_column(Numeric(12, 8), nullable=True)
    total_cost: Mapped[Decimal | None] = mapped_column(Numeric(12, 8), nullable=True)
    cache_read_cost: Mapped[Decimal | None] = mapped_column(Numeric(12, 8), nullable=True)
    cache_write_cost: Mapped[Decimal | None] = mapped_column(Numeric(12, 8), nullable=True)
    reasoning_cost: Mapped[Decimal | None] = mapped_column(Numeric(12, 8), nullable=True)
    latency_ms: Mapped[float | None] = mapped_column(Float, nullable=True)

    conversation: Mapped["Conversation"] = relationship(
        back_populates="messages", foreign_keys="Message.conversation_id"
    )
    parent: Mapped["Message | None"] = relationship(
        "Message", remote_side="Message.id",
        foreign_keys="Message.parent_message_id",
        back_populates="children",
    )
    children: Mapped[list["Message"]] = relationship(
        "Message", back_populates="parent",
        foreign_keys="Message.parent_message_id",
        order_by="Message.version_number",
        cascade="save-update, merge",
    )
    api_key: Mapped["ApiKey | None"] = relationship(back_populates="messages")
    attachments: Mapped[list["Attachment"]] = relationship(
        back_populates="message", cascade="all, delete-orphan", order_by="Attachment.created_at"
    )
