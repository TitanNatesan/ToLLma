"""Conversation table. Message table lives in message.py."""

import uuid
from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, Index, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from tollms.db.base import SoftDeleteMixin, TimestampedModel

if TYPE_CHECKING:
    from tollms.models.attachment import Attachment
    from tollms.models.message import Message
    from tollms.models.prompt_logging import PromptLog
    from tollms.models.user import User


class Conversation(SoftDeleteMixin, TimestampedModel):
    __tablename__ = "conversations"
    __table_args__ = (
        Index("ix_conversations_updated", "updated_at"),
        Index("ix_conversations_created", "created_at"),
        Index("ix_conversations_pinned", "is_pinned"),
        Index("ix_conversations_user", "user_id"),
        # Newest-first per-user listing (created_at desc, id desc).
        Index("ix_conversations_user_created", "user_id", "created_at"),
        Index("ix_conversations_active_leaf", "active_leaf_message_id"),
    )

    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    title: Mapped[str] = mapped_column(String(255), default="New conversation", nullable=False)
    is_pinned: Mapped[bool] = mapped_column(default=False, nullable=False, server_default="false")
    provider_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("providers.id"), nullable=True)
    model_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("models.id"), nullable=True)
    # Branching: a branch is a full conversation forked from a message of its parent.
    parent_conversation_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("conversations.id", ondelete="SET NULL"), nullable=True, index=True
    )
    branch_from_message_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey(
            "messages.id", ondelete="SET NULL", use_alter=True, name="fk_conversations_branch_message"
        ), nullable=True
    )
    branch_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    # Versioned branching tree: the selected node of the active path (Rules
    # C/D). New sends attach under it; switching repoints it. Circular with
    # messages.conversation_id, hence use_alter + post_update; noload keeps
    # conversation reads cheap (resolved explicitly where needed).
    active_leaf_message_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "messages.id", ondelete="SET NULL",
            use_alter=True, name="fk_conversations_active_leaf",
        ),
        nullable=True,
        default=None,
    )

    messages: Mapped[list["Message"]] = relationship(
        back_populates="conversation", cascade="all, delete-orphan", order_by="Message.created_at",
        foreign_keys="Message.conversation_id",
    )
    active_leaf: Mapped["Message | None"] = relationship(
        "Message", foreign_keys="Conversation.active_leaf_message_id",
        post_update=True, lazy="noload",
    )
    owner: Mapped["User | None"] = relationship(back_populates="conversations")
    prompt_logs: Mapped[list["PromptLog"]] = relationship(back_populates="conversation")
    attachments: Mapped[list["Attachment"]] = relationship(
        back_populates="conversation", cascade="all, delete-orphan", order_by="Attachment.created_at"
    )
    branches: Mapped[list["Conversation"]] = relationship(
        "Conversation", back_populates="parent", remote_side="Conversation.parent_conversation_id",
        foreign_keys=[parent_conversation_id],
    )
    parent: Mapped["Conversation | None"] = relationship(
        "Conversation", back_populates="branches", remote_side="Conversation.id",
        foreign_keys=[parent_conversation_id],
    )
