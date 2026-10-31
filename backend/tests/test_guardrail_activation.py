"""Guardrail activation: when policies apply at all.

No policies -> allow. Disabled policies never apply. Monitor never blocks.
Stage gates (pre/post) hold. Block-wins across policies. Wrong-key /
disabled / global scoping stays covered by test_guardrails_global_key_scope
(not duplicated here); these tests only pin that category filtering did
not disturb activation.
"""

import asyncio
import uuid

import pytest
from sqlalchemy.orm import Session

from tollms.core.exceptions import ForbiddenError
from tollms.services.guardrails import enforcement as enforcement_engine
from tollms.services.guardrails import evaluation as evaluation_engine

SECRET_TEXT = "rotate deploy key AKIAIOSFODNN7EXAMPLE now"
TOOL_TEXT = "please rm -rf /tmp/x"
PII_TEXT = "mail me at a@b.co"


def _mkpolicy(db: Session, uid: uuid.UUID, name: str, categories: list[str],
              enforcement: str = "block", stage: str = "both",
              is_enabled: bool = True):
    from tollms.models.guardrail import GuardrailPolicy, GuardrailRule

    policy = GuardrailPolicy(name=f"{name}-{uuid.uuid4().hex[:6]}", user_id=uid,
                             enforcement=enforcement, stage=stage,
                             is_enabled=is_enabled, failure_action="allow")
    db.add(policy)
    db.flush()
    for cat in categories:
        db.add(GuardrailRule(policy_id=policy.id, category=cat))
    db.commit()
    return policy


def _uid(db: Session) -> uuid.UUID:
    from tollms.models.user import User

    users = db.query(User).all()
    assert len(users) == 1
    return users[0].id


def test_no_policies_allow(db: Session, user_factory) -> None:
    user = user_factory()
    uid = uuid.UUID(user["id"])
    assert enforcement_engine.check_pre_sync(
        db, text=SECRET_TEXT, user_id=uid,
        source="internal", endpoint="chat") is None
    assert enforcement_engine.record_post_sync(
        db, text=SECRET_TEXT, user_id=uid,
        source="internal", endpoint="chat") == "allowed"


def test_all_disabled_allow(db: Session, user_factory) -> None:
    user = user_factory()
    uid = uuid.UUID(user["id"])
    _mkpolicy(db, uid, "Off", ["secret_leakage"], is_enabled=False)
    assert enforcement_engine.check_pre_sync(
        db, text=SECRET_TEXT, user_id=uid,
        source="internal", endpoint="chat") is None
    assert enforcement_engine.record_post_sync(
        db, text=SECRET_TEXT, user_id=uid,
        source="internal", endpoint="chat") == "allowed"


def test_monitor_only_never_blocks_hooks(db: Session, user_factory) -> None:
    user = user_factory()
    uid = uuid.UUID(user["id"])
    _mkpolicy(db, uid, "Mon", ["secret_leakage"], enforcement="monitor")
    assert enforcement_engine.check_pre_sync(
        db, text=SECRET_TEXT, user_id=uid,
        source="internal", endpoint="chat") is None
    assert enforcement_engine.record_post_sync(
        db, text=SECRET_TEXT, user_id=uid,
        source="internal", endpoint="chat") == "allowed"


def test_stage_gates_hold(db: Session, user_factory) -> None:
    user = user_factory()
    uid = uuid.UUID(user["id"])
    _mkpolicy(db, uid, "PreOnly", ["secret_leakage"], stage="pre")
    with pytest.raises(ForbiddenError):
        enforcement_engine.check_pre_sync(
            db, text=SECRET_TEXT, user_id=uid,
            source="internal", endpoint="chat")
    assert enforcement_engine.record_post_sync(
        db, text=SECRET_TEXT, user_id=uid,
        source="internal", endpoint="chat") == "allowed"


def test_post_only_policy_ignores_pre(db: Session, user_factory) -> None:
    user = user_factory()
    uid = uuid.UUID(user["id"])
    _mkpolicy(db, uid, "PostOnly", ["secret_leakage"], stage="post")
    assert enforcement_engine.check_pre_sync(
        db, text=SECRET_TEXT, user_id=uid,
        source="internal", endpoint="chat") is None
    assert enforcement_engine.record_post_sync(
        db, text=SECRET_TEXT, user_id=uid,
        source="internal", endpoint="chat", allow_block=True) == "blocked"


def test_block_wins_across_policies(db: Session, user_factory) -> None:
    user = user_factory()
    uid = uuid.UUID(user["id"])
    _mkpolicy(db, uid, "WarnPii", ["pii"], enforcement="warn")
    _mkpolicy(db, uid, "BlockSecret", ["secret_leakage"], enforcement="block")
    # Warn-only signal warns; block signal blocks even with a warn policy live.
    notice = enforcement_engine.check_pre_sync(
        db, text=PII_TEXT, user_id=uid, source="internal", endpoint="chat")
    assert notice is not None and "pii" in notice
    with pytest.raises(ForbiddenError) as exc:
        enforcement_engine.check_pre_sync(
            db, text=f"{PII_TEXT} {SECRET_TEXT}", user_id=uid,
            source="internal", endpoint="chat")
    assert "secret_leakage" in str(exc.value)


def test_unselected_category_never_warns(db: Session, user_factory) -> None:
    """A warn-mode secret-only policy stays silent on tool/pii text."""
    user = user_factory()
    uid = uuid.UUID(user["id"])
    policy = _mkpolicy(db, uid, "WarnSecret", ["secret_leakage"], enforcement="warn")
    for text in (TOOL_TEXT, PII_TEXT):
        result = asyncio.run(evaluation_engine.evaluate_policy(
            db, policy, text, stage="pre", ctx={}))
        assert evaluation_engine.effective_action(policy, result) == "allowed"
