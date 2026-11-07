"""Message intelligence: edit-with-history, regeneration history, branches."""

import logging
import uuid
from datetime import timedelta

from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from tollms.api.conversations.schemas import MessageRead
from tollms.api.conversations.service import (
    add_message,
    get_conversation,
    get_message,
    list_messages,
    retarget_leaf_after_delete,
)
from tollms.api.conversations import service as conv_service
from tollms.api.gateway.service import start_regeneration, validate_key_for_model
from tollms.api.conversations.schemas import BranchRead
from tollms.api.messages.schemas import (
    GenerationRunRead,
    MessageHistoryRead,
    MessageVersionRead,
)
from tollms.core.exceptions import ConflictError, NotFoundError, ValidationError
from tollms.models.attachment import Attachment
from tollms.models.conversation import Conversation
from tollms.models.message import Message, MessageStatus, Role
from tollms.models.message_history import GenerationRun, MessageVersion
from tollms.models.provider import Provider
from tollms.models.registered_model import AIModel
from tollms.services import search as search_engine
from tollms.services.cache import keys as cache_keys
from tollms.services.cache.manager import cache_delete_sync, cache_invalidate_sync

logger = logging.getLogger(__name__)


def _invalidate_conversation_caches(conversation_id: uuid.UUID, user_id: uuid.UUID | None) -> None:
    """Drop usage/aggregate/search caches after a message mutation.

    usage_totals is keyed per (conversation, user) and deleted exactly;
    analytics + search-results use the existing pattern namespaces.
    Best-effort: cache failures never fail the mutation.
    """
    try:
        cache_delete_sync(cache_keys.usage_totals(conversation_id, user_id))
    except Exception:
        logger.warning("usage_totals invalidation failed: %s", conversation_id, exc_info=True)
    if user_id is None:
        return
    try:
        cache_invalidate_sync(
            cache_keys.analytics_pattern(user_id),
            cache_keys.search_pattern(user_id),
        )
    except Exception:
        logger.warning("aggregate cache invalidation failed: %s", conversation_id, exc_info=True)


def _versions(db: Session, message_id: uuid.UUID) -> list[MessageVersion]:
    return list(
        db.execute(
            select(MessageVersion)
            .where(MessageVersion.message_id == message_id)
            .order_by(MessageVersion.version_number.asc())
        ).scalars()
    )


def _runs(db: Session, message_id: uuid.UUID) -> list[GenerationRun]:
    return list(
        db.execute(
            select(GenerationRun)
            .where(GenerationRun.message_id == message_id)
            .order_by(GenerationRun.generation_number.asc())
        ).scalars()
    )


def _names(db: Session, runs: list[GenerationRun]) -> dict[uuid.UUID, tuple[str | None, str | None]]:
    provider_ids = {run.provider_id for run in runs if run.provider_id}
    model_ids = {run.model_id for run in runs if run.model_id}
    providers = dict(
        db.execute(select(Provider.id, Provider.name).where(Provider.id.in_(provider_ids or [None]))).all()
    )
    models = dict(
        db.execute(select(AIModel.id, AIModel.name).where(AIModel.id.in_(model_ids or [None]))).all()
    )
    return {run.id: (providers.get(run.provider_id), models.get(run.model_id)) for run in runs}


def run_reads(db: Session, runs: list[GenerationRun]) -> list[GenerationRunRead]:
    names = _names(db, runs)
    return [
        GenerationRunRead(
            id=run.id,
            generation_number=run.generation_number,
            provider_id=run.provider_id,
            model_id=run.model_id,
            provider_name=names[run.id][0],
            model_name=names[run.id][1],
            content=run.content,
            status=run.status,
            is_active=run.is_active,
            total_tokens=run.total_tokens,
            total_cost=run.total_cost,
            latency_ms=float(run.latency_ms) if run.latency_ms is not None else None,
            error=run.error,
            created_at=run.created_at,
        )
        for run in runs
    ]


def message_history(db: Session, message_id: uuid.UUID, user_id: uuid.UUID | None) -> MessageHistoryRead:
    message = get_message(db, message_id, user_id)
    versions = _versions(db, message.id)
    runs = _runs(db, message.id)
    return MessageHistoryRead(
        message_id=message.id,
        role=message.role.value,
        current_content=message.content,
        current_version=versions[-1].version_number if versions else 1,
        versions=[MessageVersionRead.model_validate(row) for row in versions],
        generations=run_reads(db, runs),
        active_generation_id=next((run.id for run in runs if run.is_active), None),
    )


async def edit_message(
    db: Session,
    message_id: uuid.UUID,
    content: str,
    user_id: uuid.UUID | None,
    *,
    key_id: uuid.UUID | None = None,
    transport=None,
    session_factory=None,
    session_id: str | None = None,
    client_ip: str | None = None,
) -> tuple[Message, list[MessageVersion], Message | None]:
    """Branching edit (Rule B): new user sibling + new assistant child.

    The edited node stays untouched (no MessageVersion snapshots — the node
    itself is new, so legacy per-node history is left alone). The sibling
    takes the edited node's parent (NULL root included: Rule B multi-root),
    the child hangs under the sibling, and the active leaf moves to the
    child. The key gate runs BEFORE any mutation, so a denied regeneration
    leaves no sibling behind; the original subtree is untouched either way.
    """
    # Deferred: gateway.service imports conversations.service at module load.
    from tollms.api.gateway.service import start_child_assistant

    message = get_message(db, message_id, user_id)
    if message.role != Role.USER:
        raise ValidationError("only user messages can be edited")
    cleaned = content.strip()
    if not cleaned:
        raise ValidationError("message content must not be blank")

    conv_id = message.conversation_id
    # Inherit only from an assistant that actually descends from the edited
    # node (parent-chain walk in memory) — never a time-ordered stranger
    # from another branch. Falls back to the conversation default below.
    by_id = {m.id: m for m in list_messages(db, conv_id, user_id)}

    def _descends_from(node: Message) -> bool:
        seen, cur, guard = {node.id}, node, 0
        while cur.parent_message_id is not None and guard < 10_000:
            if cur.parent_message_id == message.id:
                return True
            if cur.parent_message_id in seen:
                return False
            seen.add(cur.parent_message_id)
            cur = by_id.get(cur.parent_message_id)
            if cur is None:
                return False
            guard += 1
        return False

    following = next(
        (
            cand
            for cand in sorted(
                (
                    m
                    for m in by_id.values()
                    if m.role == Role.ASSISTANT
                    and m.created_at > message.created_at
                    and m.provider_id is not None
                    and m.model_id is not None
                ),
                key=lambda m: (m.created_at, m.id),
            )
            if _descends_from(cand)
        ),
        None,
    )
    if (
        following is not None
        and following.status in (MessageStatus.COMPLETED, MessageStatus.CANCELLED, MessageStatus.FAILED)
        and following.provider_id is not None
        and following.model_id is not None
    ):
        target_provider_id, target_model_id = following.provider_id, following.model_id
    else:
        conv = get_conversation(db, conv_id, user_id)
        target_provider_id = conv.provider_id or message.provider_id
        target_model_id = conv.model_id or message.model_id
    if target_provider_id is None or target_model_id is None:
        raise ValidationError("message has no model to regenerate with")
    validate_key_for_model(db, key_id, user_id, target_model_id)

    try:
        edited = add_message(
            db, conv_id, Role.USER, cleaned,
            provider_id=target_provider_id, model_id=target_model_id,
            user_id=user_id, session_id=session_id,
            parent_message_id=message.parent_message_id, use_active_leaf=False,
        )
    except IntegrityError as exc:
        # Sibling-version race under the edited node's parent: no orphan,
        # no leaf move — the caller retries on the winning branch.
        # Anything else re-raises so DB safeguards stay loud.
        db.rollback()
        if conv_service._sibling_version_conflict(exc):
            raise ConflictError("message version conflict, retry the edit")
        raise
    child = await start_child_assistant(
        db, prompt_msg=edited, parent_id=edited.id,
        user_id=user_id, provider_id=target_provider_id, model_id=target_model_id,
        key_id=key_id, transport=transport, session_factory=session_factory,
        session_id=session_id, client_ip=client_ip,
    )
    return edited, [], child


async def regenerate_message(
    db: Session,
    message_id: uuid.UUID,
    user_id: uuid.UUID | None,
    *,
    provider_id: uuid.UUID | None = None,
    model_id: uuid.UUID | None = None,
    key_id: uuid.UUID | None = None,
    reasoning_level: str | None = None,
    transport=None,
    session_factory=None,
    session_id: str | None = None,
    client_ip: str | None = None,
):
    # Fail-closed ownership check + drop stale aggregates up front; the
    # generation engine re-invalidates on completion for the final totals.
    # Key-gated exactly like chat send (422 when a session user omits it).
    message = get_message(db, message_id, user_id)
    _invalidate_conversation_caches(message.conversation_id, user_id)
    return await start_regeneration(
        db,
        message_id,
        user_id=user_id,
        provider_id=provider_id,
        model_id=model_id,
        key_id=key_id,
        reasoning_level=reasoning_level,
        transport=transport,
        session_factory=session_factory,
        session_id=session_id,
        client_ip=client_ip,
    )


def activate_generation(
    db: Session, message_id: uuid.UUID, run_id: uuid.UUID, user_id: uuid.UUID | None
) -> tuple[Message, GenerationRun]:
    """Switch the visible response to a previous generation (history stays intact)."""
    message = get_message(db, message_id, user_id)
    if message.role != Role.ASSISTANT:
        raise ValidationError("only assistant messages have generations")
    run = db.get(GenerationRun, run_id)
    if run is None or run.message_id != message.id:
        raise NotFoundError("generation not found")
    if run.status != MessageStatus.COMPLETED.value:
        raise ValidationError("only completed generations can be activated")

    for other in _runs(db, message.id):
        other.is_active = other.id == run.id
    message.content = run.content
    message.prompt_tokens = run.prompt_tokens
    message.completion_tokens = run.completion_tokens
    message.total_tokens = run.total_tokens
    message.total_cost = run.total_cost
    message.latency_ms = float(run.latency_ms) if run.latency_ms is not None else None
    message.status = MessageStatus.COMPLETED
    message.error = None
    message.error_code = None
    if run.provider_id:
        message.provider_id = run.provider_id
    if run.model_id:
        message.model_id = run.model_id
    db.commit()
    db.refresh(message)
    search_engine.index_message(db, message)
    db.commit()
    _invalidate_conversation_caches(message.conversation_id, user_id)
    return message, run


def delete_message(db: Session, message_id: uuid.UUID, user_id: uuid.UUID | None) -> None:
    from sqlalchemy import delete as sql_delete

    from tollms.models.search_index import ConversationSearchEntry

    message = get_message(db, message_id, user_id)
    conversation_id = message.conversation_id
    message.is_deleted = True
    db.execute(sql_delete(ConversationSearchEntry).where(ConversationSearchEntry.message_id == message.id))
    db.commit()
    search_engine._invalidate(message.user_id)
    _invalidate_conversation_caches(conversation_id, user_id)
    retarget_leaf_after_delete(db, conversation_id, message, user_id)


def create_branch(
    db: Session,
    conversation_id: uuid.UUID,
    message_id: uuid.UUID,
    user_id: uuid.UUID | None,
    branch_name: str | None = None,
) -> Conversation:
    """Fork a conversation at a message: copy everything up to it, keep lineage."""
    source = db.get(Conversation, conversation_id)
    if source is None or source.is_deleted or (user_id is not None and source.user_id != user_id):
        raise NotFoundError("conversation not found")
    cutoff = get_message(db, message_id, user_id)
    if cutoff.conversation_id != source.id:
        raise NotFoundError("conversation not found")

    branch = Conversation(
        user_id=source.user_id,
        title=f"{source.title} (branch)"[:255],
        provider_id=cutoff.provider_id or source.provider_id,
        model_id=cutoff.model_id or source.model_id,
        parent_conversation_id=source.id,
        branch_from_message_id=cutoff.id,
        branch_name=(branch_name or f"Branch from message {cutoff.created_at:%Y-%m-%d %H:%M}")[:120],
    )
    db.add(branch)
    db.flush()

    # Copy policy: fork every non-deleted source message up to AND including
    # the cutoff, ordered deterministically by (created_at, id). Attachments
    # are re-linked to the new message ids and share the same storage_path
    # bytes (no byte duplication). message_versions + generation_runs are
    # copied with their original version/generation numbers. New rows get
    # fresh ids/timestamps; client_key is never copied (unique per user).
    ordered = sorted(
        list_messages(db, source.id, user_id),
        key=lambda m: (m.created_at, m.id),
    )
    position = next((i for i, m in enumerate(ordered) if m.id == cutoff.id), None)
    if position is None:
        raise NotFoundError("conversation not found")
    copied = ordered[: position + 1]

    old_ids = [message.id for message in copied]
    attachments_by_message: dict[uuid.UUID, list[Attachment]] = {}
    for row in db.execute(
        select(Attachment)
        .where(Attachment.message_id.in_(old_ids), Attachment.is_deleted.is_(False))
        .order_by(Attachment.created_at, Attachment.id)
    ).scalars():
        if row.message_id is not None:
            attachments_by_message.setdefault(row.message_id, []).append(row)
    versions_by_message: dict[uuid.UUID, list[MessageVersion]] = {}
    for row in db.execute(
        select(MessageVersion)
        .where(MessageVersion.message_id.in_(old_ids))
        .order_by(MessageVersion.version_number.asc())
    ).scalars():
        versions_by_message.setdefault(row.message_id, []).append(row)
    runs_by_message: dict[uuid.UUID, list[GenerationRun]] = {}
    for row in db.execute(
        select(GenerationRun)
        .where(GenerationRun.message_id.in_(old_ids))
        .order_by(GenerationRun.generation_number.asc())
    ).scalars():
        runs_by_message.setdefault(row.message_id, []).append(row)

    id_map: dict[uuid.UUID, uuid.UUID] = {}
    old_parents: dict[uuid.UUID, uuid.UUID | None] = {
        message.id: message.parent_message_id for message in copied
    }
    for position, message in enumerate(copied):
        # Explicit created_at: one transaction shares a single now(), so ties
        # would fall back to UUID order and scramble history. Source time plus
        # a monotonic microsecond offset keeps fidelity and the resolved order.
        fresh = Message(
            user_id=message.user_id,
            conversation_id=branch.id,
            created_at=message.created_at + timedelta(microseconds=position),
            role=message.role,
            parent_message_id=None,
            version_number=message.version_number or 1,
            content=message.content,
            provider_id=message.provider_id,
            model_id=message.model_id,
            status=message.status,
            started_at=message.started_at,
            completed_at=message.completed_at,
            thinking_ms=message.thinking_ms,
            prompt_tokens=message.prompt_tokens,
            completion_tokens=message.completion_tokens,
            total_tokens=message.total_tokens,
            input_cost=message.input_cost,
            output_cost=message.output_cost,
            total_cost=message.total_cost,
            latency_ms=message.latency_ms,
        )
        db.add(fresh)
        db.flush()
        id_map[message.id] = fresh.id
    for old_id, new_id in id_map.items():
        old_parent = old_parents[old_id]
        if old_parent is not None and old_parent in id_map:
            db.execute(
                update(Message).where(Message.id == new_id).values(
                    parent_message_id=id_map[old_parent]
                )
            )
    branch.active_leaf_message_id = id_map[cutoff.id]
    for old_id, rows in attachments_by_message.items():
        for position, row in enumerate(rows):
            db.add(
                Attachment(
                    user_id=row.user_id,
                    conversation_id=branch.id,
                    message_id=id_map[old_id],
                    # Same tie-break as messages: explicit timestamp keeps the
                    # per-message attachment order stable on read.
                    created_at=row.created_at + timedelta(microseconds=position),
                    filename=row.filename,
                    mime_type=row.mime_type,
                    kind=row.kind,
                    file_size=row.file_size,
                    storage_path=row.storage_path,
                    extracted_text=row.extracted_text,
                )
            )
    for old_id, rows in versions_by_message.items():
        for row in rows:
            db.add(
                MessageVersion(
                    message_id=id_map[old_id],
                    user_id=row.user_id,
                    version_number=row.version_number,
                    content=row.content,
                    edited_by=row.edited_by,
                )
            )
    for old_id, rows in runs_by_message.items():
        for row in rows:
            db.add(
                GenerationRun(
                    message_id=id_map[old_id],
                    user_id=row.user_id,
                    generation_number=row.generation_number,
                    provider_id=row.provider_id,
                    model_id=row.model_id,
                    content=row.content,
                    status=row.status,
                    is_active=row.is_active,
                    prompt_tokens=row.prompt_tokens,
                    completion_tokens=row.completion_tokens,
                    total_tokens=row.total_tokens,
                    total_cost=row.total_cost,
                    latency_ms=row.latency_ms,
                    error=row.error,
                )
            )
    db.commit()
    db.refresh(branch)
    search_engine.index_conversation(db, branch)
    db.commit()
    _invalidate_conversation_caches(source.id, user_id)
    logger.info("branch created: %s from %s at message %s", branch.id, source.id, cutoff.id)
    return branch


def message_siblings(
    db: Session, message_id: uuid.UUID, user_id: uuid.UUID | None
) -> list[Message]:
    return conv_service.message_siblings(db, message_id, user_id)


def message_children(
    db: Session, message_id: uuid.UUID, user_id: uuid.UUID | None
) -> list[Message]:
    return conv_service.message_children(db, message_id, user_id)


def _branch_read(db: Session, conversation: Conversation) -> BranchRead:
    count = db.execute(
        select(func.count(Message.id)).where(
            Message.conversation_id == conversation.id, Message.is_deleted.is_(False)
        )
    ).scalar_one()
    return BranchRead(
        conversation_id=conversation.id,
        title=conversation.title,
        parent_conversation_id=conversation.parent_conversation_id,
        branch_from_message_id=conversation.branch_from_message_id,
        branch_name=conversation.branch_name,
        message_count=int(count or 0),
        created_at=conversation.created_at,
    )


def branch_tree(db: Session, conversation_id: uuid.UUID, user_id: uuid.UUID | None) -> dict:
    conversation = db.get(Conversation, conversation_id)
    if conversation is None or conversation.is_deleted or (
        user_id is not None and conversation.user_id != user_id
    ):
        raise NotFoundError("conversation not found")

    parent = None
    siblings: list[BranchRead] = []
    if conversation.parent_conversation_id is not None:
        parent_row = db.get(Conversation, conversation.parent_conversation_id)
        if parent_row is not None and not parent_row.is_deleted:
            parent = _branch_read(db, parent_row)
            siblings = [
                _branch_read(db, row)
                for row in db.execute(
                    select(Conversation).where(
                        Conversation.parent_conversation_id == parent_row.id,
                        Conversation.is_deleted.is_(False),
                        Conversation.id != conversation.id,
                    )
                ).scalars()
            ]

    children = [
        _branch_read(db, row)
        for row in db.execute(
            select(Conversation).where(
                Conversation.parent_conversation_id == conversation.id,
                Conversation.is_deleted.is_(False),
            )
        ).scalars()
    ]
    return {
        "current": _branch_read(db, conversation),
        "parent": parent,
        "siblings": siblings,
        "children": children,
    }

