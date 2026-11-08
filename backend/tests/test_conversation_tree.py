"""Versioned branching conversation tree: parenting, versions, active leaf."""

import uuid

import pytest
from sqlalchemy.orm import Session

from tollms.api.conversations import service as conv_service
from tollms.api.conversations.schemas import ConversationCreate
from tollms.api.conversations.service import (
    active_path,
    add_message,
    create_conversation,
)
from tollms.core.exceptions import NotFoundError
from tollms.models.message import Role


def _seed_conv(db: Session, client, user_id: uuid.UUID):
    conv = create_conversation(db, ConversationCreate(title="T"), user_id)
    return conv


def test_sends_chain_under_active_leaf(db: Session, client, user_factory):
    user_factory()
    user_id = uuid.UUID(client.get("/auth/me").json()["id"])
    conv = _seed_conv(db, client, user_id)

    u1 = add_message(db, conv.id, Role.USER, "one", user_id=user_id)
    assert u1.parent_message_id is None
    assert u1.version_number == 1
    a1 = add_message(db, conv.id, Role.ASSISTANT, "uno", user_id=user_id)
    assert a1.parent_message_id == u1.id
    assert a1.version_number == 1
    u2 = add_message(db, conv.id, Role.USER, "two", user_id=user_id)
    assert u2.parent_message_id == a1.id

    db.expire_all()
    assert [m.id for m in active_path(db, conv.id, user_id)] == [u1.id, a1.id, u2.id]
    tree = conv_service.conversation_tree(db, conv.id, user_id)
    assert tree["active_leaf_id"] == u2.id
    assert len(tree["nodes"]) == 3


def test_roots_sequence_versions(db: Session, client, user_factory):
    user_factory()
    user_id = uuid.UUID(client.get("/auth/me").json()["id"])
    conv = _seed_conv(db, client, user_id)

    r1 = add_message(db, conv.id, Role.USER, "a", user_id=user_id, use_active_leaf=False)
    r2 = add_message(db, conv.id, Role.USER, "b", user_id=user_id, use_active_leaf=False)
    assert (r1.version_number, r2.version_number) == (1, 2)

    kids = conv_service.message_siblings(db, r1.id, user_id)
    assert [m.version_number for m in kids] == [1, 2]
    # Other-branch nodes never leak into the active path.
    assert [m.id for m in active_path(db, conv.id, user_id)] == [r2.id]


def test_siblings_and_children_ordering(db: Session, client, user_factory):
    user_factory()
    user_id = uuid.UUID(client.get("/auth/me").json()["id"])
    conv = _seed_conv(db, client, user_id)

    u = add_message(db, conv.id, Role.USER, "q", user_id=user_id)
    a1 = add_message(db, conv.id, Role.ASSISTANT, "a1", user_id=user_id,
                     parent_message_id=u.id, use_active_leaf=False)
    a2 = add_message(db, conv.id, Role.ASSISTANT, "a2", user_id=user_id,
                     parent_message_id=u.id, use_active_leaf=False)
    assert (a1.version_number, a2.version_number) == (1, 2)
    assert [m.id for m in conv_service.message_children(db, u.id, user_id)] == [a1.id, a2.id]
    assert [m.id for m in conv_service.message_siblings(db, a2.id, user_id)] == [a1.id, a2.id]


def test_select_switches_branch_and_404s_stale(db: Session, client, user_factory):
    user_factory()
    user_id = uuid.UUID(client.get("/auth/me").json()["id"])
    conv = _seed_conv(db, client, user_id)

    u = add_message(db, conv.id, Role.USER, "q", user_id=user_id)
    a1 = add_message(db, conv.id, Role.ASSISTANT, "a1", user_id=user_id,
                     parent_message_id=u.id, use_active_leaf=False)
    a2 = add_message(db, conv.id, Role.ASSISTANT, "a2", user_id=user_id,
                     parent_message_id=u.id, use_active_leaf=False)
    assert conv_service.conversation_path(db, conv.id, user_id)["active_leaf_id"] == a2.id

    result = conv_service.select_message(db, conv.id, a1.id, user_id)
    assert result["active_leaf_id"] == a1.id
    assert [m.id for m in result["path"]] == [u.id, a1.id]

    # New sends continue from the selected branch.
    u2 = add_message(db, conv.id, Role.USER, "follow-up", user_id=user_id)
    assert u2.parent_message_id == a1.id

    other = _seed_conv(db, client, user_id)
    with pytest.raises(NotFoundError):
        conv_service.select_message(db, conv.id, uuid.uuid4(), user_id)
    stranger = add_message(db, other.id, Role.USER, "x", user_id=user_id)
    with pytest.raises(NotFoundError):
        conv_service.select_message(db, conv.id, stranger.id, user_id)


def test_tree_and_path_http(db: Session, client, user_factory):
    user_factory()
    user_id = uuid.UUID(client.get("/auth/me").json()["id"])
    conv = _seed_conv(db, client, user_id)
    u = add_message(db, conv.id, Role.USER, "q", user_id=user_id)
    a = add_message(db, conv.id, Role.ASSISTANT, "a", user_id=user_id)

    tree = client.get(f"/api/v1/conversations/{conv.id}/tree").json()
    assert tree["active_leaf_id"] == str(a.id)
    assert [(n["id"], n["parent_message_id"]) for n in tree["nodes"]] == [
        (str(u.id), None),
        (str(a.id), str(u.id)),
    ]

    path = client.get(f"/api/v1/conversations/{conv.id}/path").json()
    assert [m["id"] for m in path["path"]] == [str(u.id), str(a.id)]

    # Selecting an ancestor of the current leaf keeps the tip: the full
    # conversation below the selection stays shown.
    sel = client.post(
        f"/api/v1/conversations/{conv.id}/select", json={"message_id": str(u.id)}
    ).json()
    assert sel["active_leaf_id"] == str(a.id)
    assert [m["id"] for m in sel["path"]] == [str(u.id), str(a.id)]

    sibs = client.get(f"/api/v1/messages/{a.id}/siblings").json()
    assert [m["id"] for m in sibs] == [str(a.id)]
    kids = client.get(f"/api/v1/messages/{u.id}/children").json()
    assert [m["id"] for m in kids] == [str(a.id)]

    assert client.get(f"/api/v1/conversations/{conv.id}/tree").json()["active_leaf_id"] == str(a.id)
