"""Data integrity (Phase 10): branch cutoff/ordering/copies, share view-count,
export headers/truncation/scope, usage-cache invalidation, orphan sweep."""

import asyncio
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from tollms.api.conversations.schemas import ConversationCreate
from tollms.api.conversations.service import add_message, create_conversation, list_messages
from tollms.models.attachment import Attachment
from tollms.models.conversation import Conversation
from tollms.models.message import Message, MessageStatus, Role
from tollms.models.message_history import GenerationRun, MessageVersion
from tollms.models.request_log import ExportEvent


def _run(coro):
    return asyncio.run(coro)


def _uid(client) -> uuid.UUID:
    return uuid.UUID(client.get("/auth/me").json()["id"])


def _setup(client, user_factory, provider_factory, model_factory):
    user_factory()
    provider = provider_factory()
    model = model_factory(provider["id"])
    return provider, model


def _conv(db: Session, user_id: uuid.UUID, provider, model, title: str = "T"):
    return create_conversation(
        db,
        ConversationCreate(
            title=title,
            provider_id=uuid.UUID(provider["id"]),
            model_id=uuid.UUID(model["id"]),
        ),
        user_id,
    )


# --- branch -----------------------------------------------------------------


def test_branch_includes_cutoff_ordering_and_copies(
    db: Session, client, user_factory, provider_factory, model_factory
):
    provider, model = _setup(client, user_factory, provider_factory, model_factory)
    user_id = _uid(client)
    pid, mid = uuid.UUID(provider["id"]), uuid.UUID(model["id"])
    conv = _conv(db, user_id, provider, model, "Source")

    m1 = add_message(db, conv.id, Role.USER, "first", user_id=user_id)
    m2 = add_message(
        db, conv.id, Role.ASSISTANT, "second",
        provider_id=pid, model_id=mid, user_id=user_id,
    )
    m3 = add_message(db, conv.id, Role.USER, "third", user_id=user_id)
    # Idempotency key on the source assistant: must never leak onto copies.
    m2.client_key = "idem-branch-1"
    # Edit history on the first message (version numbers must survive the fork).
    db.add(MessageVersion(message_id=m1.id, user_id=user_id, version_number=1, content="first", edited_by="user"))
    db.add(MessageVersion(message_id=m1.id, user_id=user_id, version_number=2, content="first v2", edited_by="user"))
    # Two generation runs on the assistant message.
    db.add(GenerationRun(message_id=m2.id, user_id=user_id, generation_number=1,
                         provider_id=pid, model_id=mid, content="second",
                         status=MessageStatus.COMPLETED.value, is_active=False))
    db.add(GenerationRun(message_id=m2.id, user_id=user_id, generation_number=2,
                         provider_id=pid, model_id=mid, content="second retry",
                         status=MessageStatus.COMPLETED.value, is_active=True))
    # One attachment sharing one storage_path (bytes are shared, rows are not).
    db.add(Attachment(user_id=user_id, conversation_id=conv.id, message_id=m1.id,
                      filename="notes.txt", mime_type="text/plain", kind="document",
                      file_size=3, storage_path="shared/bytes.bin", extracted_text="hi"))
    db.commit()

    r = client.post(
        f"/api/v1/conversations/{conv.id}/branches",
        json={"message_id": str(m2.id), "branch_name": "Fork"},
    )
    assert r.status_code == 201, r.text
    branch_id = uuid.UUID(r.json()["conversation_id"])

    branched = list_messages(db, branch_id, user_id)
    # Cutoff inclusive: first + second copied, third left behind.
    assert [m.content for m in branched] == ["first", "second"]
    # Ordering stable: (created_at, id) is the read order, twice in a row.
    assert [(m.created_at, m.id) for m in branched] == sorted(
        [(m.created_at, m.id) for m in branched]
    )
    assert [m.content for m in list_messages(db, branch_id, user_id)] == ["first", "second"]

    # Copies are timestamped source.created_at + position µs (no same-instant ties).
    source = {m.id: m for m in list_messages(db, conv.id, user_id)}
    for position, copy in enumerate(branched):
        src = source[m1.id] if copy.content == "first" else source[m2.id]
        assert copy.id != src.id
        assert copy.created_at == src.created_at + timedelta(microseconds=position)

    # Attachments re-linked to the new message id, same bytes.
    copied_att = db.execute(
        select(Attachment).where(Attachment.conversation_id == branch_id)
    ).scalars().all()
    assert len(copied_att) == 1
    assert copied_att[0].storage_path == "shared/bytes.bin"
    assert copied_att[0].message_id == branched[0].id
    assert copied_att[0].id is not None

    # Versions / runs copied with their original numbers.
    copied_versions = db.execute(
        select(MessageVersion)
        .where(MessageVersion.message_id == branched[0].id)
        .order_by(MessageVersion.version_number)
    ).scalars().all()
    assert [v.version_number for v in copied_versions] == [1, 2]
    copied_runs = db.execute(
        select(GenerationRun)
        .where(GenerationRun.message_id == branched[1].id)
        .order_by(GenerationRun.generation_number)
    ).scalars().all()
    assert [g.generation_number for g in copied_runs] == [1, 2]

    # client_key never copied (unique per user).
    assert all(m.client_key is None for m in branched)
    assert db.execute(
        select(Message).where(Message.conversation_id == branch_id, Message.client_key.is_not(None))
    ).scalars().all() == []


# --- shares ------------------------------------------------------------------


def test_share_view_count_bumps_on_cache_hit_and_revoked_404s(
    db: Session, client, user_factory, provider_factory, model_factory
):
    from tollms.services.cache import client as cache_client

    assert _run(cache_client.connect()) is True
    provider, model = _setup(client, user_factory, provider_factory, model_factory)
    user_id = _uid(client)
    conv = _conv(db, user_id, provider, model, "Shareable")
    add_message(db, conv.id, Role.USER, "q", user_id=user_id)
    add_message(db, conv.id, Role.ASSISTANT, "a", user_id=user_id)

    share = client.post("/api/v1/shares", json={"conversation_id": str(conv.id)}).json()

    first = client.get(f"/api/v1/shares/public/{share['share_token']}")
    assert first.status_code == 200
    assert first.json()["view_count"] == 1
    second = client.get(f"/api/v1/shares/public/{share['share_token']}")
    assert second.status_code == 200
    assert second.json()["view_count"] == 2  # bumped even on the cache-hit path

    assert client.delete(f"/api/v1/shares/{share['id']}").status_code == 200
    revoked = client.get(f"/api/v1/shares/public/{share['share_token']}")
    assert revoked.status_code == 404  # revoked fails closed even though cached


# --- exports -----------------------------------------------------------------


def test_export_headers_present(db: Session, client, user_factory, provider_factory, model_factory):
    provider, model = _setup(client, user_factory, provider_factory, model_factory)
    user_id = _uid(client)
    conv = _conv(db, user_id, provider, model, "Export me")
    add_message(db, conv.id, Role.USER, "hi", user_id=user_id)

    single = client.get(f"/api/v1/exports/conversations/{conv.id}?format=json")
    assert single.status_code == 200
    assert single.headers["X-Export-Total-Count"] == "1"
    assert single.headers["X-Export-Truncated"] == "false"

    bulk = client.post("/api/v1/exports/conversations", json={"all": True, "format": "json"})
    assert bulk.status_code == 200
    assert bulk.headers["X-Export-Total-Count"] == "1"
    assert bulk.headers["X-Export-Truncated"] == "false"


def test_export_truncated_when_over_cap(db: Session, client, user_factory, provider_factory, model_factory, monkeypatch):
    import tollms.api.exports.service as export_service

    monkeypatch.setattr(export_service, "MAX_EXPORT_CONVERSATIONS", 2)
    provider, model = _setup(client, user_factory, provider_factory, model_factory)
    user_id = _uid(client)
    for i in range(3):
        _conv(db, user_id, provider, model, f"C{i}")

    r = client.post("/api/v1/exports/conversations", json={"all": True, "format": "json"})
    assert r.status_code == 200
    assert r.headers["X-Export-Total-Count"] == "3"
    assert r.headers["X-Export-Truncated"] == "true"
    assert len(r.json()["conversations"]) == 2


def test_export_ids_win_over_export_all(db: Session, client, user_factory, provider_factory, model_factory):
    provider, model = _setup(client, user_factory, provider_factory, model_factory)
    user_id = _uid(client)
    first = _conv(db, user_id, provider, model, "First")
    _conv(db, user_id, provider, model, "Second")

    r = client.post(
        "/api/v1/exports/conversations",
        json={"conversation_ids": [str(first.id)], "all": True, "format": "json"},
    )
    assert r.status_code == 200
    payload = r.json()
    assert len(payload["conversations"]) == 1
    assert payload["conversations"][0]["title"] == "First"


def test_analytics_export_item_count_is_actual(db: Session, client, user_factory):
    user_factory()
    r = client.get("/api/v1/exports/analytics", params={"dataset": "summary", "format": "json"})
    assert r.status_code == 200
    rows = r.json()["rows"]
    event = db.execute(select(ExportEvent).order_by(ExportEvent.created_at.desc())).scalars().first()
    assert event is not None and event.dataset == "analytics:summary"
    assert event.item_count == len(rows) == 1


# --- usage-cache invalidation ------------------------------------------------


def _seed_usage(client, cid: str):
    body = client.get(f"/api/v1/conversations/{cid}/usage")
    assert body.status_code == 200
    return body.json()


def _usage_key(cid: str, user_id: uuid.UUID) -> str:
    from tollms.services.cache import keys as cache_keys

    return cache_keys.usage_totals(cid, user_id)


def _assert_cached(cid: str, user_id: uuid.UUID, expected: bool) -> None:
    from tollms.services.cache.manager import get_manager

    assert _run(get_manager().exists(_usage_key(cid, user_id))) is expected


def test_usage_cache_invalidated_on_edit(db: Session, client, user_factory, provider_factory, model_factory):
    from tollms.services.cache import client as cache_client

    assert _run(cache_client.connect()) is True
    provider, model = _setup(client, user_factory, provider_factory, model_factory)
    user_id = _uid(client)
    conv = _conv(db, user_id, provider, model)
    msg = add_message(db, conv.id, Role.USER, "original", user_id=user_id)

    _seed_usage(client, str(conv.id))
    _assert_cached(str(conv.id), user_id, True)

    r = client.patch(f"/api/v1/messages/{msg.id}", json={"content": "edited"})
    assert r.status_code == 200
    _assert_cached(str(conv.id), user_id, False)
    assert client.get(f"/api/v1/conversations/{conv.id}/usage").status_code == 200


def test_usage_cache_invalidated_on_activate(db: Session, client, user_factory, provider_factory, model_factory):
    from tollms.services.cache import client as cache_client

    assert _run(cache_client.connect()) is True
    provider, model = _setup(client, user_factory, provider_factory, model_factory)
    user_id = _uid(client)
    conv = _conv(db, user_id, provider, model)
    assistant = add_message(
        db, conv.id, Role.ASSISTANT, "v2",
        provider_id=uuid.UUID(provider["id"]), model_id=uuid.UUID(model["id"]),
        user_id=user_id,
    )
    run1 = GenerationRun(message_id=assistant.id, user_id=user_id, generation_number=1,
                         content="v1", status=MessageStatus.COMPLETED.value, is_active=False)
    run2 = GenerationRun(message_id=assistant.id, user_id=user_id, generation_number=2,
                         content="v2", status=MessageStatus.COMPLETED.value, is_active=True)
    db.add(run1)
    db.add(run2)
    db.commit()

    _seed_usage(client, str(conv.id))
    _assert_cached(str(conv.id), user_id, True)

    r = client.post(f"/api/v1/messages/{assistant.id}/generations/{run1.id}/activate")
    assert r.status_code == 200, r.text
    _assert_cached(str(conv.id), user_id, False)
    assert client.get(f"/api/v1/conversations/{conv.id}/usage").status_code == 200


def test_usage_cache_invalidated_on_delete(db: Session, client, user_factory, provider_factory, model_factory):
    from tollms.services.cache import client as cache_client

    assert _run(cache_client.connect()) is True
    provider, model = _setup(client, user_factory, provider_factory, model_factory)
    user_id = _uid(client)
    conv = _conv(db, user_id, provider, model)
    msg = add_message(db, conv.id, Role.USER, "bye", user_id=user_id)

    _seed_usage(client, str(conv.id))
    _assert_cached(str(conv.id), user_id, True)

    assert client.delete(f"/api/v1/messages/{msg.id}").status_code == 204
    _assert_cached(str(conv.id), user_id, False)
    assert client.get(f"/api/v1/conversations/{conv.id}/usage").status_code == 200


def test_usage_cache_invalidated_on_branch(db: Session, client, user_factory, provider_factory, model_factory):
    from tollms.services.cache import client as cache_client

    assert _run(cache_client.connect()) is True
    provider, model = _setup(client, user_factory, provider_factory, model_factory)
    user_id = _uid(client)
    conv = _conv(db, user_id, provider, model)
    msg = add_message(db, conv.id, Role.USER, "fork me", user_id=user_id)

    _seed_usage(client, str(conv.id))
    _assert_cached(str(conv.id), user_id, True)

    r = client.post(f"/api/v1/conversations/{conv.id}/branches", json={"message_id": str(msg.id)})
    assert r.status_code == 201, r.text
    _assert_cached(str(conv.id), user_id, False)
    assert client.get(f"/api/v1/conversations/{conv.id}/usage").status_code == 200


# --- orphan sweep ---------------------------------------------------------------


def test_orphan_sweep_removes_only_old_empty(db: Session, client, user_factory, provider_factory, model_factory,
                                             monkeypatch, tmp_path, caplog):
    import logging

    from tollms.core.config import get_settings
    from tollms.services.cache import client as cache_client
    from tollms.services.gateway import attachments as attachment_engine
    from tollms.services.jobs import scheduler as scheduler

    assert _run(cache_client.connect()) is True
    assert scheduler._scheduler is None  # sweep runs standalone; schedulers never started

    provider, model = _setup(client, user_factory, provider_factory, model_factory)
    user_id = _uid(client)
    days = get_settings().orphan_sweep_days
    old = datetime.now(timezone.utc) - timedelta(days=days + 1)

    monkeypatch.setattr(get_settings(), "storage_dir", str(tmp_path / "uploads"))

    old_empty = _conv(db, user_id, provider, model, "Old empty")
    young_empty = _conv(db, user_id, provider, model, "Young empty")
    old_messaged = _conv(db, user_id, provider, model, "Old messaged")
    old_empty_id, young_empty_id, old_messaged_id = old_empty.id, young_empty.id, old_messaged.id
    add_message(db, old_messaged_id, Role.USER, "kept", user_id=user_id)
    for cid in (old_empty_id, old_messaged_id):
        row = db.get(Conversation, cid)
        row.created_at = old
    db.commit()

    # Old empty owns one staged file: the sweep must cascade the row + bytes.
    relpath = attachment_engine.save_bytes(user_id, str(old_empty_id), "staged.txt", b"orphan bytes")
    db.add(Attachment(user_id=user_id, conversation_id=old_empty_id, message_id=None,
                      filename="staged.txt", mime_type="text/plain", kind="document",
                      file_size=12, storage_path=relpath))
    db.commit()
    assert (tmp_path / "uploads" / relpath).exists()

    maker = sessionmaker(bind=db.get_bind())
    monkeypatch.setattr(scheduler, "SessionLocal", maker)
    monkeypatch.delenv("PYTEST_CURRENT_TEST", raising=False)

    with caplog.at_level(logging.INFO):
        scheduler._orphan_sweep_job()

    db.expire_all()
    assert db.get(Conversation, old_empty_id) is None
    assert db.execute(select(Attachment).where(Attachment.conversation_id == old_empty_id)).scalars().all() == []
    assert not (tmp_path / "uploads" / relpath).exists()
    assert db.get(Conversation, young_empty_id) is not None
    assert db.get(Conversation, old_messaged_id) is not None
    assert "orphan sweep finished" in caplog.text
