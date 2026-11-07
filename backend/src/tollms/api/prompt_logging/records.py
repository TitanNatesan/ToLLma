"""Prompt log records: metadata listing, gated detail, delete, purge, retention."""

import base64
import csv
import io
import json
import logging
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from tollms.api.orgs.common.audit import _audit
from tollms.api.orgs.common.guards import _member_org, _parse_time, _require_perm, effective_permissions
from tollms.api.prompt_logging.settings import DEFAULT_RETENTION_DAYS, _live_setting, decrypt_body
from tollms.core.exceptions import (
    ApplicationException,
    NotFoundError,
    ValidationError,
)
from tollms.services import request_logs as request_log_engine
from tollms.models.api_key import ApiKey
from tollms.models.organization import Membership, MembershipState
from tollms.models.prompt_logging import STATUSES, PromptLog
from tollms.models.provider import Provider
from tollms.models.registered_model import AIModel

logger = logging.getLogger(__name__)

_LEVELS = ("debug", "info", "warning", "error")
MAX_EXPORT_PAGE = 1000


def _scope_org(db: Session, caller_id: uuid.UUID, org_id: uuid.UUID,
               code: str) -> None:
    org, mem = _member_org(db, org_id, caller_id)
    _require_perm(db, org, mem, caller_id, code)


def _scope_stmt(db: Session, caller_id: uuid.UUID, org_id: uuid.UUID | None,
                code: str = "PromptLogs.Read"):
    """Base listing scope: org rows for org workspaces (perm-gated), own
    personal rows otherwise. Unknown workspaces are 404 oracles."""
    if org_id is None:
        return select(PromptLog).where(
            PromptLog.user_id == caller_id, PromptLog.org_id.is_(None))
    _scope_org(db, caller_id, org_id, code)
    return select(PromptLog).where(PromptLog.org_id == org_id)


def _resolve_member(db: Session, org_id: uuid.UUID, user_id: uuid.UUID) -> None:
    """Filter targets must hold ACTIVE membership: suspended/removed members
    are 404 oracles, same as strangers."""
    exists = db.scalar(select(Membership.id).where(
        Membership.org_id == org_id, Membership.user_id == user_id,
        Membership.is_deleted.is_(False),
        Membership.state == MembershipState.ACTIVE.value))
    if exists is None:
        raise NotFoundError("prompt log not found")


def _resolve_key(db: Session, caller_id: uuid.UUID, org_id: uuid.UUID | None,
                 key_id: uuid.UUID) -> None:
    key = db.get(ApiKey, key_id)
    if key is None or key.is_deleted:
        raise NotFoundError("prompt log not found")
    if org_id is None:
        if key.user_id != caller_id or key.org_id is not None:
            raise NotFoundError("prompt log not found")
    elif key.org_id != org_id:
        raise NotFoundError("prompt log not found")


def _resolve_provider(db: Session, caller_id: uuid.UUID, org_id: uuid.UUID | None,
                      provider_id: uuid.UUID) -> None:
    provider = db.get(Provider, provider_id)
    if provider is None or provider.is_deleted:
        raise NotFoundError("prompt log not found")
    if org_id is None:
        if provider.org_id is not None or provider.user_id != caller_id:
            raise NotFoundError("prompt log not found")
    elif provider.org_id != org_id:
        raise NotFoundError("prompt log not found")


def _resolve_model(db: Session, caller_id: uuid.UUID, org_id: uuid.UUID | None,
                   model_id: uuid.UUID) -> None:
    model = db.get(AIModel, model_id)
    if model is None or model.is_deleted:
        raise NotFoundError("prompt log not found")
    _resolve_provider(db, caller_id, org_id, model.provider_id)


def _decode_cursor(cursor: str | None):
    if not cursor:
        return None
    try:
        raw = base64.urlsafe_b64decode(cursor.encode()).decode()
        created_s, row_id = raw.split("|", 1)
        return datetime.fromisoformat(created_s), uuid.UUID(row_id)
    except (ValueError, TypeError):
        raise ValidationError("invalid cursor") from None


def _live_map(db: Session, entity: object, id_col: object, val_col: object,
                ids: set[uuid.UUID], label: str) -> dict:
    """One batched id -> value lookup. Soft-deleted (or missing) rows are
    absent — callers surface None for those rows.

    Batched enrichment is intended: key_name/user_email/provider_name/
    model_name ride every metadata row via one query per entity per page
    (not N+1), and live-only filtering keeps deleted rows as None."""
    if not ids:
        return {}
    try:
        stmt = select(id_col, val_col).where(id_col.in_(list(ids)))
        is_deleted = getattr(entity, "is_deleted", None)
        if is_deleted is not None:
            stmt = stmt.where(is_deleted.is_(False))
        return dict(db.execute(stmt).all())
    except Exception:
        logger.warning("promptlog %s batch lookup failed", label, exc_info=True)
        return {}


def _key_names(db: Session, key_ids: set[uuid.UUID]) -> dict:
    """One batched id -> name lookup for a listing page. Missing (deleted)
    keys are simply absent — callers surface None for those rows."""
    return _live_map(db, ApiKey, ApiKey.id, ApiKey.name, key_ids, "key-name")


def _user_emails(db: Session, user_ids: set[uuid.UUID]) -> dict:
    """Batched user id -> email. Deleted users are absent (None downstream)."""
    from tollms.models.user import User

    return _live_map(db, User, User.id, User.email, user_ids, "user-email")


def _provider_names(db: Session, provider_ids: set[uuid.UUID]) -> dict:
    """Batched provider id -> name. Deleted providers are absent."""
    return _live_map(db, Provider, Provider.id, Provider.name,
                     provider_ids, "provider-name")


def _model_names(db: Session, model_ids: set[uuid.UUID]) -> dict:
    """Batched model id -> display id (models.model_id). Deleted models absent."""
    return _live_map(db, AIModel, AIModel.id, AIModel.model_id,
                     model_ids, "model-name")


def _meta(row: PromptLog, key_name: str | None = None,
         user_email: str | None = None, provider_name: str | None = None,
         model_name: str | None = None):
    from tollms.api.prompt_logging.schemas import LogMeta

    fields: list[str] = []
    if row.input_cipher is not None:
        fields.append("input")
    if row.output_cipher is not None:
        fields.append("output")
    completed_at = None
    if row.latency_ms is not None and row.created_at is not None:
        try:
            completed_at = row.created_at + timedelta(milliseconds=float(row.latency_ms))
        except (TypeError, ValueError, OverflowError):
            completed_at = None
    duration_ms: int | None = None
    if row.latency_ms is not None:
        try:
            duration_ms = round(float(row.latency_ms))
        except (TypeError, ValueError, OverflowError):
            duration_ms = None
    return LogMeta(
        id=row.id, workspace_type=row.workspace_type, user_id=row.user_id,
        org_id=row.org_id, api_key_id=row.api_key_id,
        key_provenance=row.key_provenance,
        match_source=row.match_source,
        conversation_id=row.conversation_id, provider_id=row.provider_id,
        model_id=row.model_id, endpoint=row.endpoint or "", source=row.source,
        request_id=row.request_id, generation_id=row.generation_id,
        status=row.status, input_chars=row.input_chars, output_chars=row.output_chars,
        prompt_tokens=row.prompt_tokens, completion_tokens=row.completion_tokens,
        usage_estimated=row.usage_estimated, total_tokens=row.total_tokens,
        cache_read_tokens=row.cache_read_tokens,
        cache_write_tokens=row.cache_write_tokens,
        reasoning_tokens=row.reasoning_tokens, input_cost=row.input_cost,
        output_cost=row.output_cost, total_cost=row.total_cost,
        currency=row.currency, pricing_version=row.pricing_version,
        trace_id=row.trace_id, session_key=row.session_key,
        finish_reason=row.finish_reason, model_params=row.model_params,
        level=row.level, status_message=row.status_message,
        latency_ms=row.latency_ms, error_code=row.error_code,
        policy_version=row.policy_version, content_expired=row.content_expired,
        input_truncated=bool(row.input_truncated),
        output_truncated=bool(row.output_truncated),
        created_at=row.created_at, expires_at=row.expires_at,
        fields=fields, duration_ms=duration_ms,
        completed_at=completed_at, key_name=key_name, user_email=user_email,
        provider_name=provider_name, model_name=model_name)


def _ledger_filters(stmt, *, trace_id: str | None = None,
                  session_key: str | None = None,
                  status: str | None = None, level: str | None = None,
                  min_cost: Decimal | None = None,
                  max_cost: Decimal | None = None,
                  min_tokens: int | None = None,
                  max_tokens: int | None = None):
    """AND-composed metadata filters shared by list_logs and export_logs."""
    if status is not None:
        if status not in STATUSES:
            # Truncated: the value is attacker-controlled (query param).
            raise ValidationError(f"invalid status: {str(status)[:32]!r}")
        stmt = stmt.where(PromptLog.status == status)
    if trace_id is not None:
        stmt = stmt.where(PromptLog.trace_id == trace_id)
    if session_key is not None:
        stmt = stmt.where(PromptLog.session_key == session_key)
    if level is not None:
        if level not in _LEVELS:
            raise ValidationError(f"invalid level: {str(level)[:32]!r}")
        stmt = stmt.where(PromptLog.level == level)
    if min_cost is not None:
        stmt = stmt.where(PromptLog.total_cost >= min_cost)
    if max_cost is not None:
        stmt = stmt.where(PromptLog.total_cost <= max_cost)
    if min_tokens is not None:
        stmt = stmt.where(PromptLog.total_tokens >= min_tokens)
    if max_tokens is not None:
        stmt = stmt.where(PromptLog.total_tokens <= max_tokens)
    return stmt


def list_logs(db: Session, caller_id: uuid.UUID, *,
              org_id: uuid.UUID | None = None,
              user_id: uuid.UUID | None = None,
              key_id: uuid.UUID | None = None,
              provider_id: uuid.UUID | None = None,
              model_id: uuid.UUID | None = None,
              status: str | None = None,
              date_from: str | None = None,
              date_to: str | None = None,
              q: str | None = None,
              trace_id: str | None = None,
              session_key: str | None = None,
              level: str | None = None,
              min_cost: Decimal | None = None,
              max_cost: Decimal | None = None,
              min_tokens: int | None = None,
              max_tokens: int | None = None,
              limit: int = 50, cursor: str | None = None):
    """Metadata-only listing, filters AND-composed, stable cursor order."""
    stmt = _scope_stmt(db, caller_id, org_id)
    if user_id is not None:
        if org_id is None:
            if user_id != caller_id:
                raise NotFoundError("prompt log not found")
        else:
            _resolve_member(db, org_id, user_id)
        stmt = stmt.where(PromptLog.user_id == user_id)
    if key_id is not None:
        _resolve_key(db, caller_id, org_id, key_id)
        stmt = stmt.where(PromptLog.api_key_id == key_id)
    if provider_id is not None:
        _resolve_provider(db, caller_id, org_id, provider_id)
        stmt = stmt.where(PromptLog.provider_id == provider_id)
    if model_id is not None:
        _resolve_model(db, caller_id, org_id, model_id)
        stmt = stmt.where(PromptLog.model_id == model_id)
    stmt = _ledger_filters(stmt, trace_id=trace_id,
                           session_key=session_key, status=status,
                           level=level, min_cost=min_cost,
                           max_cost=max_cost, min_tokens=min_tokens,
                           max_tokens=max_tokens)
    start = _parse_time(date_from, "from") if date_from else None
    end = _parse_time(date_to, "to") if date_to else None
    if start is not None:
        stmt = stmt.where(PromptLog.created_at >= start)
    if end is not None:
        stmt = stmt.where(PromptLog.created_at < end)
    if q is not None and q.strip():
        escaped = q.strip()[:128].replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        stmt = stmt.where(PromptLog.request_id.ilike(f"%{escaped}%", escape="\\"))
    decoded = _decode_cursor(cursor)
    if decoded is not None:
        created_at, row_id = decoded
        stmt = stmt.where((PromptLog.created_at < created_at) |
                          ((PromptLog.created_at == created_at) &
                           (PromptLog.id < row_id)))
    limit = min(max(limit, 1), 200)
    rows = list(db.scalars(stmt.order_by(
        PromptLog.created_at.desc(), PromptLog.id.desc()).limit(limit + 1)))
    next_cursor: str | None = None
    if len(rows) > limit:
        last = rows[limit - 1]
        raw = f"{last.created_at.isoformat()}|{last.id}"
        next_cursor = base64.urlsafe_b64encode(raw.encode()).decode()
        rows = rows[:limit]
    names = _key_names(db, {row.api_key_id for row in rows
                            if row.api_key_id is not None})
    emails = _user_emails(db, {row.user_id for row in rows
                               if row.user_id is not None})
    providers = _provider_names(db, {row.provider_id for row in rows
                                     if row.provider_id is not None})
    models = _model_names(db, {row.model_id for row in rows
                               if row.model_id is not None})
    return [_meta(row, names.get(row.api_key_id), emails.get(row.user_id),
                  providers.get(row.provider_id), models.get(row.model_id))
            for row in rows], next_cursor


def _can_view_content(db: Session, caller_id: uuid.UUID,
                      org_id: uuid.UUID | None) -> bool:
    if org_id is None:
        return True
    org, mem = _member_org(db, org_id, caller_id)
    if mem.is_root:
        return True
    return "PromptLogs.ViewContent" in effective_permissions(db, org_id, caller_id)


def get_log_detail(db: Session, caller_id: uuid.UUID, log_id: uuid.UUID,
                   org_id: uuid.UUID | None):
    """Detail: bodies only with PromptLogs.ViewContent, else metadata +
    content_restricted. Cross-workspace rows are 404 oracles."""
    from tollms.api.prompt_logging.schemas import LogDetail

    if org_id is None:
        row = db.get(PromptLog, log_id)
        if row is None or row.user_id != caller_id or row.org_id is not None:
            raise NotFoundError("prompt log not found")
    else:
        _scope_org(db, caller_id, org_id, "PromptLogs.Read")
        row = db.get(PromptLog, log_id)
        if row is None or row.org_id != org_id:
            raise NotFoundError("prompt log not found")
    key_name = _key_names(
        db, {row.api_key_id} if row.api_key_id is not None else set()).get(row.api_key_id)
    user_email = _user_emails(
        db, {row.user_id} if row.user_id is not None else set()).get(row.user_id)
    provider_name = _provider_names(
        db, {row.provider_id} if row.provider_id is not None else set()).get(row.provider_id)
    model_name = _model_names(
        db, {row.model_id} if row.model_id is not None else set()).get(row.model_id)
    meta = _meta(row, key_name, user_email, provider_name, model_name)
    if row.content_expired or (row.input_cipher is None and row.output_cipher is None):
        return LogDetail(**meta.model_dump(), input_text=None,
                         output_text=None, content_restricted=False)
    if not _can_view_content(db, caller_id, org_id):
        return LogDetail(**meta.model_dump(), input_text=None,
                         output_text=None, content_restricted=True)
    body_in = decrypt_body(row.input_cipher)
    body_out = decrypt_body(row.output_cipher)
    if (row.input_cipher or row.output_cipher) and body_in is None and body_out is None:
        return LogDetail(**meta.model_dump(), input_text=None,
                         output_text=None, content_restricted=True)
    if org_id is not None:
        # Bodies leave the vault: org AuditLog row (who/when/row id only,
        # never body content). Personal scope skips audit (own data).
        # Fail-closed like the delete/purge paths below.
        try:
            _audit(db, org_id, caller_id, "prompt_logs.content_viewed",
                   log_id=str(log_id))
            db.commit()
        except ApplicationException:
            db.rollback()
            raise
        except Exception as exc:
            db.rollback()
            raise ApplicationException("prompt log read failed") from exc
    return LogDetail(**meta.model_dump(), input_text=body_in,
                     output_text=body_out, content_restricted=False)


def delete_log(db: Session, caller_id: uuid.UUID, log_id: uuid.UUID,
               org_id: uuid.UUID | None) -> None:
    if org_id is None:
        row = db.get(PromptLog, log_id)
        if row is None or row.user_id != caller_id or row.org_id is not None:
            raise NotFoundError("prompt log not found")
        db.delete(row)
        db.commit()
        return
    _scope_org(db, caller_id, org_id, "PromptLogs.Delete")
    row = db.get(PromptLog, log_id)
    if row is None or row.org_id != org_id:
        raise NotFoundError("prompt log not found")
    db.delete(row)
    try:
        _audit(db, org_id, caller_id, "prompt_logs.log.delete", log_id=str(log_id))
        db.commit()
    except ApplicationException:
        db.rollback()
        raise
    except Exception as exc:
        db.rollback()
        raise ApplicationException("prompt log delete failed") from exc


def purge_logs(db: Session, caller_id: uuid.UUID, org_id: uuid.UUID | None,
               before: datetime | None = None) -> int:
    """Expire content (NULL ciphers, keep metadata) for rows before cutoff."""
    from sqlalchemy import update

    cutoff = before or datetime.now(timezone.utc)
    if cutoff.tzinfo is None:
        cutoff = cutoff.replace(tzinfo=timezone.utc)
    if org_id is None:
        stmt = (update(PromptLog)
                .where(PromptLog.user_id == caller_id, PromptLog.org_id.is_(None),
                       PromptLog.created_at < cutoff,
                       PromptLog.content_expired.is_(False))
                .values(input_cipher=None, output_cipher=None, content_expired=True))
        count = db.execute(stmt).rowcount or 0
        db.commit()
        return count
    _scope_org(db, caller_id, org_id, "PromptLogs.Delete")
    stmt = (update(PromptLog)
            .where(PromptLog.org_id == org_id, PromptLog.created_at < cutoff,
                   PromptLog.content_expired.is_(False))
            .values(input_cipher=None, output_cipher=None, content_expired=True))
    count = db.execute(stmt).rowcount or 0
    try:
        _audit(db, org_id, caller_id, "prompt_logs.purge", expired=count)
        db.commit()
    except ApplicationException:
        db.rollback()
        raise
    except Exception as exc:
        db.rollback()
        raise ApplicationException("prompt log purge failed") from exc
    return count


def retention_info(db: Session, caller_id: uuid.UUID, org_id: uuid.UUID | None):
    """{default_days, effective_days, next_run (next UTC midnight daily job),
    queue_depth, last_error (async capture worker health)}."""
    from tollms.api.prompt_logging.schemas import RetentionRead
    from tollms.services.prompt_logging import queue as promptlog_queue

    if org_id is None:
        setting = _live_setting(db, caller_id, None)
    else:
        _scope_org(db, caller_id, org_id, "PromptLogs.Read")
        setting = _live_setting(db, caller_id, org_id)
    effective = setting.retention_days if setting is not None else DEFAULT_RETENTION_DAYS
    now = datetime.now(timezone.utc)
    next_run = (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    queue_stats = promptlog_queue.stats()
    raw_error = queue_stats.get("last_error")
    # Error code only - strip any raw DB/driver text (legacy values may
    # still carry Exc: message).
    last_error = str(raw_error).split(":")[0].strip()[:64] if raw_error else None
    return RetentionRead(default_days=DEFAULT_RETENTION_DAYS,
                         effective_days=effective, next_run=next_run,
                         queue_depth=int(queue_stats.get("queue_depth") or 0),
                         last_error=last_error,
                         dropped_full=int(queue_stats.get("dropped_full") or 0),
                         dropped_error=int(queue_stats.get("dropped_error") or 0),
                         duplicates=int(queue_stats.get("duplicates") or 0),
                         enqueued=int(queue_stats.get("enqueued") or 0))


_EXPORT_COLUMNS = (
    "id", "created_at", "trace_id", "session_key", "endpoint", "source",
    "status", "level", "prompt_tokens", "completion_tokens", "total_tokens",
    "cache_read_tokens", "cache_write_tokens", "reasoning_tokens",
    "input_cost", "output_cost", "total_cost", "currency", "latency_ms",
    "error_code", "status_message",
)


def _export_row(row: PromptLog) -> dict:
    """Metadata-only export object. Decrypted bodies are never exported."""
    return {
        "id": str(row.id),
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "trace_id": _csv_safe(row.trace_id),
        "session_key": _csv_safe(row.session_key),
        "endpoint": _csv_safe(row.endpoint),
        "source": row.source,
        "status": row.status,
        "level": row.level,
        "prompt_tokens": row.prompt_tokens,
        "completion_tokens": row.completion_tokens,
        "total_tokens": row.total_tokens,
        "cache_read_tokens": row.cache_read_tokens,
        "cache_write_tokens": row.cache_write_tokens,
        "reasoning_tokens": row.reasoning_tokens,
        "input_cost": str(row.input_cost) if row.input_cost is not None else None,
        "output_cost": str(row.output_cost) if row.output_cost is not None else None,
        "total_cost": str(row.total_cost) if row.total_cost is not None else None,
        "currency": row.currency,
        "latency_ms": row.latency_ms,
        "error_code": _csv_safe(row.error_code),
        "status_message": _csv_safe(row.status_message),
    }


def _csv_safe(value: str | None) -> str | None:
    """Formula-injection guard (H2): spreadsheet formulas never start a cell.

    Prefixes a single quote when the value starts with = + - @ tab or CR.
    Only applied at export serialization — stored rows are untouched.
    """
    if not value:
        return value
    if value[0] in ("=", "+", "-", "@", "\t", "\r", "\n"):
        return "'" + value
    return value


def export_logs(db: Session, caller_id: uuid.UUID, *,
                org_id: uuid.UUID | None = None,
                format: str = "csv",
                limit: int = 200, cursor: str | None = None,
                trace_id: str | None = None,
                session_key: str | None = None,
                status: str | None = None,
                level: str | None = None,
                min_cost: Decimal | None = None,
                max_cost: Decimal | None = None,
                min_tokens: int | None = None,
                max_tokens: int | None = None):
    """Server-side cursor-paged metadata export (bodies never leave the vault).

    Scope: personal rows for the owner; org rows require BOTH
    PromptLogs.Read and Analytics.Export (the latter implies the former per
    the plan — both are enforced here explicitly). Each call writes one
    ExportEvent(dataset='prompt_logs') with org/personal attribution in
    detail. Returns (content, media_type, next_cursor, item_count); the
    router serves content as an attachment with X-Next-Cursor when set.
    """
    if format not in ("csv", "jsonl"):
        raise ValidationError(f"invalid format: {str(format)[:16]!r}")
    if org_id is None:
        stmt = select(PromptLog).where(
            PromptLog.user_id == caller_id, PromptLog.org_id.is_(None))
    else:
        _scope_org(db, caller_id, org_id, "PromptLogs.Read")
        _scope_org(db, caller_id, org_id, "Analytics.Export")
        stmt = select(PromptLog).where(PromptLog.org_id == org_id)
    stmt = _ledger_filters(stmt, trace_id=trace_id, session_key=session_key,
                           status=status, level=level, min_cost=min_cost,
                           max_cost=max_cost, min_tokens=min_tokens,
                           max_tokens=max_tokens)
    decoded = _decode_cursor(cursor)
    if decoded is not None:
        created_at, row_id = decoded
        stmt = stmt.where((PromptLog.created_at < created_at) |
                          ((PromptLog.created_at == created_at) &
                           (PromptLog.id < row_id)))
    limit = min(max(limit, 1), MAX_EXPORT_PAGE)
    rows = list(db.scalars(stmt.order_by(
        PromptLog.created_at.desc(), PromptLog.id.desc()).limit(limit + 1)))
    next_cursor: str | None = None
    if len(rows) > limit:
        last = rows[limit - 1]
        raw = f"{last.created_at.isoformat()}|{last.id}"
        next_cursor = base64.urlsafe_b64encode(raw.encode()).decode()
        rows = rows[:limit]
    objs = [_export_row(row) for row in rows]
    if format == "csv":
        buf = io.StringIO()
        writer = csv.writer(buf, lineterminator="\n")
        writer.writerow(_EXPORT_COLUMNS)
        for obj in objs:
            writer.writerow(["" if obj[col] is None else obj[col]
                             for col in _EXPORT_COLUMNS])
        content, media_type = buf.getvalue(), "text/csv; charset=utf-8"
    else:
        content = "".join(json.dumps(obj, default=str) + "\n" for obj in objs)
        media_type = "application/x-ndjson"
    try:
        request_log_engine.record_export(
            db, caller_id, "prompt_logs", format, len(objs),
            detail=f"org_id={org_id}" if org_id is not None else "personal")
        db.commit()
    except ApplicationException:
        db.rollback()
        raise
    except Exception as exc:
        db.rollback()
        logger.warning("promptlog export audit failed", exc_info=True)
        raise ApplicationException("prompt log export failed") from exc
    return content, media_type, next_cursor, len(objs)
