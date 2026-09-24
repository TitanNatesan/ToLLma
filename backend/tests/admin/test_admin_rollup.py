"""Rollup engine: `UsageDailyAggregate` rows are rebuilt per
(day, user, provider, model) scope with idempotent results.
"""

import uuid
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal

from sqlalchemy.orm import Session

from tollms.models.conversation import Conversation
from tollms.models.message import Message, MessageStatus, Role
from tollms.models.usage_aggregate import UsageDailyAggregate
from tollms.models.user import User
from tollms.services.admin.rollup import rebuild_day, rebuild_range

SCOPE_FIELDS = (
    "day",
    "user_id",
    "provider_id",
    "model_id",
    "requests",
    "failed_requests",
    "prompt_tokens",
    "completion_tokens",
    "total_tokens",
    "total_cost",
)


def _user(db: Session, email: str) -> User:
    user = User(email=email, password_hash="not-used", has_password=True)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _conversation(db: Session, user_id: uuid.UUID, title: str) -> Conversation:
    conversation = Conversation(user_id=user_id, title=title)
    db.add(conversation)
    db.commit()
    db.refresh(conversation)
    return conversation


def _message(
    db: Session,
    *,
    user_id: uuid.UUID,
    conversation_id: uuid.UUID,
    provider_id: uuid.UUID,
    model_id: uuid.UUID,
    at: datetime,
    prompt: int,
    completion: int,
    cost: str,
    status: MessageStatus = MessageStatus.COMPLETED,
) -> Message:
    total = Decimal(cost)
    message = Message(
        user_id=user_id,
        conversation_id=conversation_id,
        role=Role.ASSISTANT,
        content="rollup fixture answer",
        provider_id=provider_id,
        model_id=model_id,
        status=status,
        created_at=at,
        completed_at=at,
        prompt_tokens=prompt,
        completion_tokens=completion,
        total_tokens=prompt + completion,
        input_cost=total / 2,
        output_cost=total / 2,
        total_cost=total,
    )
    db.add(message)
    db.flush()
    return message


def _snapshot(db: Session) -> list[tuple]:
    db.expire_all()
    rows = db.query(UsageDailyAggregate).all()
    return [
        tuple(getattr(row, field) for field in SCOPE_FIELDS)
        for row in sorted(rows, key=lambda r: (r.day, str(r.user_id), str(r.model_id)))
    ]


def test_rebuild_day_sums_per_scope_and_is_idempotent(
    db: Session, user_factory, provider_factory, model_factory
) -> None:
    owner = user_factory("rollup-owner@tollma.ai")
    other = _user(db, "rollup-other@tollma.ai")
    provider = provider_factory("Rollup Provider")
    model_a = model_factory(provider["id"], model_id="rollup-a", name="Rollup A")
    model_b = model_factory(provider["id"], model_id="rollup-b", name="Rollup B")
    provider_id = uuid.UUID(provider["id"])
    model_a_id = uuid.UUID(model_a["id"])
    model_b_id = uuid.UUID(model_b["id"])
    owner_id = uuid.UUID(owner["id"])

    day = (datetime.now(timezone.utc) - timedelta(days=1)).date()
    at = datetime.combine(day, time(12, 0), tzinfo=timezone.utc)
    owner_conv = _conversation(db, owner_id, "Rollup owner conv")
    other_conv = _conversation(db, other.id, "Rollup other conv")

    _message(db, user_id=owner_id, conversation_id=owner_conv.id, provider_id=provider_id,
             model_id=model_a_id, at=at, prompt=100, completion=50, cost="1.00")
    _message(db, user_id=owner_id, conversation_id=owner_conv.id, provider_id=provider_id,
             model_id=model_a_id, at=at + timedelta(hours=2), prompt=10, completion=5, cost="0.50")
    _message(db, user_id=owner_id, conversation_id=owner_conv.id, provider_id=provider_id,
             model_id=model_b_id, at=at + timedelta(hours=3), prompt=7, completion=3, cost="0.25")
    _message(db, user_id=other.id, conversation_id=other_conv.id, provider_id=provider_id,
             model_id=model_a_id, at=at + timedelta(hours=1), prompt=20, completion=10, cost="0.40")
    db.commit()

    rebuild_day(db, day)
    db.commit()

    rows = db.query(UsageDailyAggregate).all()
    assert len(rows) == 3, "one row per (day, user, provider, model) scope"
    by_key = {(row.user_id, row.provider_id, row.model_id): row for row in rows}

    owner_a = by_key[(owner_id, provider_id, model_a_id)]
    assert owner_a.day == day
    assert owner_a.requests == 2
    assert owner_a.prompt_tokens == 110
    assert owner_a.completion_tokens == 55
    assert owner_a.total_tokens == 165
    assert owner_a.total_cost == Decimal("1.50")

    owner_b = by_key[(owner_id, provider_id, model_b_id)]
    assert owner_b.requests == 1
    assert owner_b.total_tokens == 10
    assert owner_b.total_cost == Decimal("0.25")

    other_a = by_key[(other.id, provider_id, model_a_id)]
    assert other_a.requests == 1
    assert other_a.total_tokens == 30
    assert other_a.total_cost == Decimal("0.40")

    first = _snapshot(db)
    rebuild_day(db, day)
    db.commit()
    second = _snapshot(db)

    assert len(second) == len(first) == 3, "rebuilding a day must not duplicate rows"
    assert second == first, "rebuilding a day must not change existing totals"


def test_rebuild_range_covers_multiple_days_and_returns_row_count(
    db: Session, user_factory, provider_factory, model_factory
) -> None:
    owner = user_factory("rollup-range@tollma.ai")
    provider = provider_factory("Range Provider")
    model = model_factory(provider["id"], model_id="range-a", name="Range A")
    owner_id = uuid.UUID(owner["id"])
    provider_id = uuid.UUID(provider["id"])
    model_id = uuid.UUID(model["id"])
    conversation = _conversation(db, owner_id, "Range conv")

    today = datetime.now(timezone.utc).date()
    days = [today - timedelta(days=offset) for offset in (1, 2, 3)]
    for index, day in enumerate(days):
        _message(
            db,
            user_id=owner_id,
            conversation_id=conversation.id,
            provider_id=provider_id,
            model_id=model_id,
            at=datetime.combine(day, time(10, 0), tzinfo=timezone.utc),
            prompt=100 * (index + 1),
            completion=10,
            cost="0.10",
        )
    db.commit()

    count = rebuild_range(db, days[2], days[0])  # oldest -> most recent
    db.expire_all()

    assert isinstance(count, int), f"rebuild_range must return a row count, got {type(count)}"
    assert count >= 2, "the range spans multiple days with data"

    rows = db.query(UsageDailyAggregate).all()
    assert count == len(rows), "the returned count must equal the aggregate rows written"
    covered = {row.day for row in rows}
    assert {days[1], days[2]} <= covered, "older days in the range must be rebuilt"
    assert all(row.requests == 1 for row in rows)

    by_day = {row.day: row for row in rows}
    assert by_day[days[2]].prompt_tokens == 300
    assert by_day[days[1]].prompt_tokens == 200
