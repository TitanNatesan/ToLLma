"""Score feature service: workspace-scoped judgments over prompt-log subjects."""

import base64
import logging
import uuid
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from tollms.api.orgs.common.guards import _member_org, _require_perm
from tollms.api.scores.schemas import ScoreCreate, ScoreRead
from tollms.core.exceptions import (
    ApplicationException,
    NotFoundError,
    ValidationError,
)
from tollms.models.prompt_logging import PromptLog
from tollms.models.scores import DATA_TYPES, SOURCES, Score

logger = logging.getLogger(__name__)

_BOOL_TEXT = frozenset({"true", "false", "0", "1"})


def _scope_check(db: Session, caller_id: uuid.UUID, org_id: uuid.UUID | None,
                 code: str) -> None:
    """Org gate: any ACTIVE member with `code`; strangers get a 404 oracle."""
    if org_id is None:
        return
    org, mem = _member_org(db, org_id, caller_id)
    _require_perm(db, org, mem, caller_id, code)


def _read(row: Score) -> ScoreRead:
    return ScoreRead(
        id=row.id, name=row.name, data_type=row.data_type,
        value_num=row.value_num, value_text=row.value_text,
        trace_id=row.trace_id, prompt_log_id=row.prompt_log_id,
        session_key=row.session_key, experiment_id=row.experiment_id,
        source=row.source, config_name=row.config_name, comment=row.comment,
        environment=row.environment, user_id=row.user_id, org_id=row.org_id,
        created_at=row.created_at, updated_at=row.updated_at)


def _decode_cursor(cursor: str | None):
    if not cursor:
        return None
    try:
        raw = base64.urlsafe_b64decode(cursor.encode()).decode()
        created_s, row_id = raw.split("|", 1)
        return datetime.fromisoformat(created_s), uuid.UUID(row_id)
    except (ValueError, TypeError):
        raise ValidationError("invalid cursor") from None


def _check_boolean(data: ScoreCreate) -> None:
    """Boolean scores accept true/false/0/1 as text or 0/1 as number."""
    if data.value_num is not None and data.value_num not in (Decimal(0), Decimal(1)):
        raise ValidationError("boolean scores accept value_num 0 or 1")
    if data.value_num is None and (data.value_text or "").strip().lower() not in _BOOL_TEXT:
        raise ValidationError("boolean scores accept value_text true/false/0/1")


def _resolve_subject(db: Session, caller_id: uuid.UUID, org_id: uuid.UUID | None,
                     trace_id: str | None, prompt_log_id: uuid.UUID | None) -> None:
    """Subject must resolve inside the caller's workspace (404 oracle)."""
    if prompt_log_id is not None:
        row = db.get(PromptLog, prompt_log_id)
        if row is None:
            raise NotFoundError("score not found")
        if org_id is None:
            if row.user_id != caller_id or row.org_id is not None:
                raise NotFoundError("score not found")
        elif row.org_id != org_id:
            raise NotFoundError("score not found")
    if trace_id is not None:
        stmt = select(PromptLog.id).where(PromptLog.trace_id == trace_id)
        if org_id is None:
            stmt = stmt.where(PromptLog.user_id == caller_id,
                              PromptLog.org_id.is_(None))
        else:
            stmt = stmt.where(PromptLog.org_id == org_id)
        if db.scalar(stmt.limit(1)) is None:
            raise NotFoundError("score not found")


def _commit(db: Session, row: Score) -> ScoreRead:
    try:
        db.commit()
    except Exception as exc:
        db.rollback()
        logger.warning("score write failed", exc_info=True)
        raise ApplicationException("score write failed") from exc
    db.refresh(row)
    return _read(row)


def create_score(db: Session, caller_id: uuid.UUID, data: ScoreCreate,
                 org_id: uuid.UUID | None = None) -> ScoreRead:
    """Insert, or rewrite the same-(name, subject, day) row's value/comment."""
    if data.data_type not in DATA_TYPES:
        raise ValidationError(f"invalid data_type: {str(data.data_type)[:32]!r}")
    if data.source not in SOURCES:
        raise ValidationError(f"invalid source: {str(data.source)[:32]!r}")
    if data.value_num is None and not (data.value_text or "").strip():
        raise ValidationError("score requires value_num or value_text")
    if data.data_type == "boolean":
        _check_boolean(data)
    trace_id = data.trace_id or None
    prompt_log_id = data.prompt_log_id
    if trace_id is None and prompt_log_id is None:
        raise ValidationError("score requires trace_id or prompt_log_id")
    _scope_check(db, caller_id, org_id, "PromptLogs.Read")
    _resolve_subject(db, caller_id, org_id, trace_id, prompt_log_id)
    today = datetime.now(timezone.utc).date()
    stmt = select(Score).where(Score.name == data.name,
                               Score.subject_day == today)
    if org_id is None:
        stmt = stmt.where(Score.user_id == caller_id, Score.org_id.is_(None))
    else:
        stmt = stmt.where(Score.org_id == org_id)
    stmt = (stmt.where(Score.trace_id == trace_id) if trace_id is not None
            else stmt.where(Score.trace_id.is_(None)))
    stmt = (stmt.where(Score.prompt_log_id == prompt_log_id)
            if prompt_log_id is not None
            else stmt.where(Score.prompt_log_id.is_(None)))
    existing = (db.execute(stmt.order_by(
        Score.created_at.desc(), Score.id.desc())).scalars().first())
    if existing is not None:
        # Rewrite wins on the full mutable set (M4): same subject+day is one
        # judgment, so data_type/source/session_key/experiment/config/env
        # follow the latest write instead of lingering stale.
        existing.data_type = data.data_type
        existing.value_num = data.value_num
        existing.value_text = (data.value_text or None)
        existing.comment = (data.comment or None)
        existing.session_key = (data.session_key or None)
        existing.experiment_id = (data.experiment_id or None)
        existing.source = data.source
        existing.config_name = (data.config_name or None)
        existing.environment = (data.environment or None)
        return _commit(db, existing)
    row = Score(
        user_id=caller_id if org_id is None else None, org_id=org_id,
        name=data.name, subject_day=today, data_type=data.data_type, value_num=data.value_num,
        value_text=(data.value_text or None), trace_id=trace_id,
        prompt_log_id=prompt_log_id, session_key=(data.session_key or None),
        experiment_id=(data.experiment_id or None), source=data.source,
        config_name=(data.config_name or None), comment=(data.comment or None),
        environment=(data.environment or None))
    db.add(row)
    try:
        return _commit(db, row)
    except IntegrityError:
        # H3: concurrent same-subject-day INSERTs both miss the SELECT. The
        # rewrite UQ collapses the loser here — re-read and update instead.
        db.rollback()
        loser = (db.execute(stmt.order_by(
            Score.created_at.desc(), Score.id.desc())).scalars().first())
        if loser is None:
            raise
        loser.data_type = data.data_type
        loser.value_num = data.value_num
        loser.value_text = (data.value_text or None)
        loser.comment = (data.comment or None)
        loser.session_key = (data.session_key or None)
        loser.experiment_id = (data.experiment_id or None)
        loser.source = data.source
        loser.config_name = (data.config_name or None)
        loser.environment = (data.environment or None)
        return _commit(db, loser)


def list_scores(db: Session, caller_id: uuid.UUID, *,
                org_id: uuid.UUID | None = None,
                trace_id: str | None = None,
                prompt_log_id: uuid.UUID | None = None,
                session_key: str | None = None,
                name: str | None = None,
                limit: int = 50, cursor: str | None = None):
    """Workspace-scoped listing, newest-first, stable cursor order."""
    if org_id is None:stmt = select(Score).where(Score.user_id == caller_id,Score.org_id.is_(None))
    else:
        _scope_check(db, caller_id, org_id, "PromptLogs.Read")
        stmt = select(Score).where(Score.org_id == org_id)
    if trace_id is not None:stmt = stmt.where(Score.trace_id == trace_id)
    if prompt_log_id is not None:stmt = stmt.where(Score.prompt_log_id == prompt_log_id)
    if session_key is not None:stmt = stmt.where(Score.session_key == session_key)
    if name is not None and name.strip():stmt = stmt.where(Score.name == name.strip()[:128])
    decoded = _decode_cursor(cursor)
    if decoded is not None:
        created_at, row_id = decoded
        stmt = stmt.where((Score.created_at < created_at) |
                          ((Score.created_at == created_at) &
                           (Score.id < row_id)))
    limit = min(max(limit, 1), 200)
    rows = list(db.execute(stmt.order_by(
        Score.created_at.desc(), Score.id.desc()).limit(limit + 1)).scalars())
    next_cursor: str | None = None
    if len(rows) > limit:
        last = rows[limit - 1]
        raw = f"{last.created_at.isoformat()}|{last.id}"
        next_cursor = base64.urlsafe_b64encode(raw.encode()).decode()
        rows = rows[:limit]
    return [_read(row) for row in rows], next_cursor


def delete_score(db: Session, caller_id: uuid.UUID, score_id: uuid.UUID,
                 org_id: uuid.UUID | None) -> None:
    """Owner (personal) or PromptLogs.Manage (org). Cross-owner is 404."""
    if org_id is None:
        row = db.get(Score, score_id)
        if row is None or row.user_id != caller_id or row.org_id is not None: raise NotFoundError("score not found")
        db.delete(row)
        try:
            db.commit()
        except Exception as exc:
            db.rollback()
            logger.warning("score delete failed", exc_info=True)
            raise ApplicationException("score delete failed") from exc
        return
    _scope_check(db, caller_id, org_id, "PromptLogs.Manage")
    row = db.get(Score, score_id)
    if row is None or row.org_id != org_id: raise NotFoundError("score not found")
    db.delete(row)
    try:
        db.commit()
    except ApplicationException:
        db.rollback()
        raise
    except Exception as exc:
        db.rollback()
        logger.warning("score delete failed", exc_info=True)
        raise ApplicationException("score delete failed") from exc
