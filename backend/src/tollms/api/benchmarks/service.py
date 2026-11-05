"""Benchmark runs: aggregate perf snapshots per workspace. No prompt bodies.

Personal runs are owner-only; org runs need ACTIVE membership +
Analytics.ViewUsage. Every miss is a 404 oracle. Delete is creator-or-root.
"""

import base64
import logging
import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from tollms.api.benchmarks.schemas import BenchmarkRunRead
from tollms.api.orgs.common.guards import _member_org, _require_perm
from tollms.core.exceptions import NotFoundError, ValidationError
from tollms.models.benchmark import BenchmarkRun

logger = logging.getLogger(__name__)

_BODY_KEYS = ("input_text", "output_text")


def _scope_org(db: Session, caller_id: uuid.UUID, org_id: uuid.UUID) -> None:
    org, mem = _member_org(db, org_id, caller_id)
    _require_perm(db, org, mem, caller_id, "Analytics.ViewUsage")


def _reject_bodies(value: object) -> None:
    """Walk conditions recursively: input_text/output_text keys anywhere are
    422 (this ledger must never hold prompt bodies)."""
    if isinstance(value, dict):
        for key, item in value.items():
            if key in _BODY_KEYS:
                raise ValidationError(f"conditions must not contain {key!r}")
            _reject_bodies(item)
    elif isinstance(value, (list, tuple)):
        for item in value:
            _reject_bodies(item)


def _read(row: BenchmarkRun) -> BenchmarkRunRead:
    return BenchmarkRunRead(
        id=row.id, user_id=row.user_id, org_id=row.org_id, name=row.name,
        traffic_path=row.traffic_path, provider_label=row.provider_label,
        model_label=row.model_label, logging_mode=row.logging_mode,
        cache_state=row.cache_state, conditions=dict(row.conditions or {}),
        n=row.n, errors=row.errors, mean_ms=row.mean_ms, p50_ms=row.p50_ms,
        p95_ms=row.p95_ms, p99_ms=row.p99_ms, ttft_mean_ms=row.ttft_mean_ms,
        ttft_p50_ms=row.ttft_p50_ms, prompt_tokens=row.prompt_tokens,
        completion_tokens=row.completion_tokens,
        cache_read_tokens=row.cache_read_tokens,
        cache_write_tokens=row.cache_write_tokens, total_cost=row.total_cost,
        notes=row.notes, created_at=row.created_at, updated_at=row.updated_at)


def create_run(db: Session, caller_id: uuid.UUID, data) -> BenchmarkRunRead:
    if data.org_id is not None:
        _scope_org(db, caller_id, data.org_id)
    _reject_bodies(data.conditions)
    if data.total_cost is not None and data.total_cost < 0:
        raise ValidationError("total_cost must be >= 0")
    row = BenchmarkRun(
        user_id=caller_id, org_id=data.org_id, name=data.name.strip(),
        traffic_path=data.traffic_path, provider_label=data.provider_label,
        model_label=data.model_label, logging_mode=data.logging_mode,
        cache_state=data.cache_state, conditions=dict(data.conditions or {}),
        n=data.n, errors=data.errors, mean_ms=data.mean_ms, p50_ms=data.p50_ms,
        p95_ms=data.p95_ms, p99_ms=data.p99_ms, ttft_mean_ms=data.ttft_mean_ms,
        ttft_p50_ms=data.ttft_p50_ms, prompt_tokens=data.prompt_tokens,
        completion_tokens=data.completion_tokens,
        cache_read_tokens=data.cache_read_tokens,
        cache_write_tokens=data.cache_write_tokens, total_cost=data.total_cost,
        notes=data.notes)
    db.add(row)
    db.commit()
    db.refresh(row)
    return _read(row)


def _decode_cursor(cursor: str | None):
    if not cursor:
        return None
    try:
        from datetime import datetime

        raw = base64.urlsafe_b64decode(cursor.encode()).decode()
        created_s, row_id = raw.split("|", 1)
        return datetime.fromisoformat(created_s), uuid.UUID(row_id)
    except (ValueError, TypeError):
        raise ValidationError("invalid cursor") from None


def list_runs(db: Session, caller_id: uuid.UUID, *,
              org_id: uuid.UUID | None = None,
              limit: int = 50, cursor: str | None = None):
    """Newest-first cursor listing, same envelope as prompt-log lists."""
    if org_id is None:
        stmt = select(BenchmarkRun).where(
            BenchmarkRun.user_id == caller_id, BenchmarkRun.org_id.is_(None))
    else:
        _scope_org(db, caller_id, org_id)
        stmt = select(BenchmarkRun).where(BenchmarkRun.org_id == org_id)
    decoded = _decode_cursor(cursor)
    if decoded is not None:
        created_at, row_id = decoded
        stmt = stmt.where((BenchmarkRun.created_at < created_at) |
                          ((BenchmarkRun.created_at == created_at) &
                           (BenchmarkRun.id < row_id)))
    limit = min(max(limit, 1), 200)
    rows = list(db.scalars(stmt.order_by(
        BenchmarkRun.created_at.desc(), BenchmarkRun.id.desc()).limit(limit + 1)))
    next_cursor: str | None = None
    if len(rows) > limit:
        last = rows[limit - 1]
        raw = f"{last.created_at.isoformat()}|{last.id}"
        next_cursor = base64.urlsafe_b64encode(raw.encode()).decode()
        rows = rows[:limit]
    return [_read(row) for row in rows], next_cursor


def delete_run(db: Session, caller_id: uuid.UUID, run_id: uuid.UUID) -> None:
    """Creator-or-root delete: personal runs need the creator; org runs need
    the creator or org root. Every other miss is a 404 oracle."""
    row = db.get(BenchmarkRun, run_id)
    if row is None:
        raise NotFoundError("benchmark run not found")
    if row.org_id is None:
        if row.user_id != caller_id:
            raise NotFoundError("benchmark run not found")
    else:
        _org, mem = _member_org(db, row.org_id, caller_id)
        if row.user_id != caller_id and not mem.is_root:
            raise NotFoundError("benchmark run not found")
    db.delete(row)
    db.commit()
