"""Periodic operations scheduler (APScheduler).

One engine, one scheduler: provider health checks (24h), usage rollups
(hourly), expired-token cleanup (daily) and account-deletion processing
(daily). Model repository sync keeps its own scheduler. Each job is
lock-guarded, per-item exception-safe and skipped under pytest — a failed
job never takes down the process or other jobs.
"""

import asyncio
import logging
import os
import uuid
from datetime import date, datetime, timedelta

from apscheduler.schedulers.background import BackgroundScheduler

from tollms.db.session import SessionLocal
from tollms.services.cache import constants as cache_ttl
from tollms.services.cache import keys as cache_keys
from tollms.services.cache.locks import locked_sync
from tollms.services.observability.events import emit

logger = logging.getLogger(__name__)

_scheduler: BackgroundScheduler | None = None


def _provider_health_job() -> None:
    """Re-validate every active provider so admin sees healthy/broken states."""
    from tollms.api.providers import service as providers_service

    with locked_sync(cache_keys.LOCK_SCHEDULER, cache_ttl.LOCK_SCHEDULER * 1000) as acquired:
        if not acquired:
            logger.warning("provider health check skipped: lock held")
            return
        db = SessionLocal()
        try:
            providers = providers_service.list_providers(db, active_only=True)
            logger.info("provider health check: %d providers", len(providers))
            for provider in providers:
                try:
                    ok, message, _ = asyncio.run(
                        providers_service.validate_provider(db, provider.id)
                    )
                    logger.info(
                        "provider health: %s valid=%s (%s)",
                        provider.id, ok, message[:120],
                    )
                except Exception:
                    logger.exception("provider health check failed: %s", provider.id)
        except Exception:
            logger.exception("provider health check crashed")
        finally:
            db.close()


def _usage_rollup_job() -> None:
    """Rebuild usage aggregates for yesterday + today (idempotent upsert)."""
    from tollms.services.admin import rollup as rollup_engine

    with locked_sync(cache_keys.LOCK_SCHEDULER, cache_ttl.LOCK_SCHEDULER * 1000) as acquired:
        if not acquired:
            logger.warning("usage rollup skipped: lock held")
            return
        today = date.today()
        db = SessionLocal()
        try:
            rows = rollup_engine.rebuild_range(db, today - timedelta(days=1), today)
            logger.info("usage rollup finished: %d rows", rows)
        except Exception:
            logger.exception("usage rollup crashed")
        finally:
            db.close()


def _cleanup_job() -> None:
    """Delete used OR expired password-reset tokens (single-use + time-boxed)."""
    from datetime import datetime, timezone

    from sqlalchemy import delete, or_

    from tollms.models.password_reset import PasswordResetToken

    db = SessionLocal()
    try:
        result = db.execute(
            delete(PasswordResetToken).where(
                or_(
                    PasswordResetToken.used_at.is_not(None),
                    PasswordResetToken.expires_at < datetime.now(timezone.utc),
                )
            )
        )
        db.commit()
        logger.info("cleanup finished: %d used/expired reset tokens purged", result.rowcount)
    except Exception:
        db.rollback()
        logger.exception("cleanup crashed")
    finally:
        db.close()


# --- account deletion ----------------------------------------------------------
# Reminder windows are fixed (no settings): 7-day then 1-day before purge.

_DELETION_REMINDER_7D = timedelta(days=7)
_DELETION_REMINDER_1D = timedelta(days=1)


def _aware(moment: datetime) -> datetime:
    from datetime import timezone as _tz

    return moment if moment.tzinfo is not None else moment.replace(tzinfo=_tz.utc)


def _send_deletion_notices(db, now: datetime) -> None:
    """Stage 1 + due 7-day notice -> stage 2; stage 2 + due 1-day -> stage 3."""
    from sqlalchemy import select

    from tollms.models.user import User
    from tollms.services.email import send_account_deletion_reminder

    pending = db.scalars(
        select(User).where(
            User.deletion_scheduled_for.is_not(None),
            User.deletion_scheduled_for > now,
            User.is_deleted.is_(False),
        )
    ).all()
    for user in pending:
        try:
            scheduled = _aware(user.deletion_scheduled_for)
            stamp = scheduled.isoformat()
            if user.deletion_notice_stage == 1 and now >= scheduled - _DELETION_REMINDER_7D:
                send_account_deletion_reminder(user.email, 7, stamp)
                user.deletion_notice_stage = 2
                db.commit()
                logger.info("deletion 7-day notice sent: user_id=%s", user.id)
            elif user.deletion_notice_stage == 2 and now >= scheduled - _DELETION_REMINDER_1D:
                send_account_deletion_reminder(user.email, 1, stamp)
                user.deletion_notice_stage = 3
                db.commit()
                logger.info("deletion 1-day notice sent: user_id=%s", user.id)
        except Exception:
            db.rollback()
            logger.exception("deletion notice failed: user_id=%s", user.id)


def _purge_user_data(db, user_id: uuid.UUID) -> dict[str, int]:
    """Hard-delete one account's data in dependency order. No commit."""
    from sqlalchemy import delete, select, update

    from tollms.models.api_key import ApiKey, ApiRequestLog
    from tollms.models.attachment import Attachment
    from tollms.models.conversation import Conversation
    from tollms.models.guardrail import GuardrailPolicy, GuardrailTrigger
    from tollms.models.organization import Notification
    from tollms.models.prompt_logging import (
        PromptLog,
        PromptLoggingKeyOverride,
        PromptLoggingKeyTarget,
        PromptLoggingSetting,
    )
    from tollms.models.provider import Provider
    from tollms.models.registered_model import AIModel
    from tollms.models.request_log import ExportEvent, RequestLog
    from tollms.models.usage_aggregate import UsageDailyAggregate
    from tollms.services.api_keys import keys as key_engine
    from tollms.services.gateway.attachments import delete_bytes

    # Disk paths first: conversation-linked rows vanish via CASCADE below.
    paths = [
        row[0]
        for row in db.execute(
            select(Attachment.storage_path).where(Attachment.user_id == user_id)
        ).all()
    ]
    # Conversation delete CASCADEs messages -> versions/runs, linked
    # attachments, shares and the search index at the DB level.
    conversations = db.execute(
        delete(Conversation).where(Conversation.user_id == user_id)
    ).rowcount or 0
    # Strays: uploaded but never sent (conversation_id NULL, cascade missed).
    strays = db.execute(
        delete(Attachment).where(
            Attachment.user_id == user_id, Attachment.conversation_id.is_(None)
        )
    ).rowcount or 0
    for relpath in paths:
        delete_bytes(relpath)
    # Models before providers (models.provider_id has no ON DELETE action).
    models = db.execute(
        delete(AIModel).where(
            AIModel.provider_id.in_(
                select(Provider.id).where(Provider.user_id == user_id)
            )
        )
    ).rowcount or 0
    providers = db.execute(
        delete(Provider).where(Provider.user_id == user_id)
    ).rowcount or 0
    key_hashes = [
        row[0]
        for row in db.execute(select(ApiKey.key_hash).where(ApiKey.user_id == user_id)).all()
    ]
    api_keys = db.execute(delete(ApiKey).where(ApiKey.user_id == user_id)).rowcount or 0
    aggregates = db.execute(
        update(UsageDailyAggregate)
        .where(UsageDailyAggregate.user_id == user_id)
        .values(user_id=None)
    ).rowcount or 0
    # Erasure ledger coverage (H1): user-attributed operational rows are
    # hard-deleted — content (prompt bodies, excerpts, request metadata)
    # must not survive de-linked. Counts-only aggregates stay anonymized.
    prompt_logs = db.execute(
        delete(PromptLog).where(PromptLog.user_id == user_id)
    ).rowcount or 0
    triggers = db.execute(
        delete(GuardrailTrigger).where(GuardrailTrigger.user_id == user_id)
    ).rowcount or 0
    policies = db.execute(
        delete(GuardrailPolicy).where(GuardrailPolicy.user_id == user_id)
    ).rowcount or 0
    setting_ids = select(PromptLoggingSetting.id).where(
        PromptLoggingSetting.user_id == user_id
    )
    key_targets = db.execute(
        delete(PromptLoggingKeyTarget).where(
            PromptLoggingKeyTarget.setting_id.in_(setting_ids)
        )
    ).rowcount or 0
    key_overrides = db.execute(
        delete(PromptLoggingKeyOverride).where(
            PromptLoggingKeyOverride.setting_id.in_(setting_ids)
        )
    ).rowcount or 0
    log_settings = db.execute(
        delete(PromptLoggingSetting).where(PromptLoggingSetting.user_id == user_id)
    ).rowcount or 0
    request_logs = db.execute(
        delete(RequestLog).where(RequestLog.user_id == user_id)
    ).rowcount or 0
    api_request_logs = db.execute(
        delete(ApiRequestLog).where(ApiRequestLog.user_id == user_id)
    ).rowcount or 0
    export_events = db.execute(
        delete(ExportEvent).where(ExportEvent.user_id == user_id)
    ).rowcount or 0
    notifications = db.execute(
        delete(Notification).where(Notification.user_id == user_id)
    ).rowcount or 0
    return {
        "conversations": conversations,
        "attachments": len(paths),
        "stray_attachments": strays,
        "models": models,
        "providers": providers,
        "api_keys": api_keys,
        "key_hashes": key_hashes,
        "usage_aggregates": aggregates,
        "prompt_logs": prompt_logs,
        "guardrail_triggers": triggers,
        "guardrail_policies": policies,
        "prompt_logging_settings": log_settings,
        "prompt_logging_key_targets": key_targets,
        "prompt_logging_key_overrides": key_overrides,
        "request_logs": request_logs,
        "api_request_logs": api_request_logs,
        "export_events": export_events,
        "notifications": notifications,
    }


def _purge_due_accounts(db, now: datetime) -> None:
    """Hard-purge accounts past scheduled_for. Per-user transaction: failure
    rolls back that user, writes a failed audit row, and continues."""
    from sqlalchemy import select

    from tollms.core import security
    from tollms.models.purge_audit import PurgeAuditLog
    from tollms.models.user import User
    from tollms.services.api_keys import keys as key_engine
    from tollms.services.email import send_account_purged

    due = db.scalars(
        select(User).where(
            User.deletion_scheduled_for.is_not(None),
            User.deletion_scheduled_for <= now,
            User.is_deleted.is_(False),
        )
    ).all()
    for user in due:
        user_id, email = user.id, user.email
        try:
            if _legal_hold_active(db):
                logger.warning("purge deferred for %s: active legal hold", user_id)
                continue
            counts = _purge_user_data(db, user_id)
            key_hashes = counts.pop("key_hashes")
            for key_hash in key_hashes:
                key_engine.invalidate_context(key_hash)
            revoked = asyncio.run(security.revoke_all_user_sessions(user_id))
            counts["sessions"] = revoked
            # password_reset rows CASCADE off the user row here.
            db.delete(user)
            db.add(
                PurgeAuditLog(
                    deleted_user_id=user_id, purged_at=now, counts=counts, result="ok"
                )
            )
            db.commit()
            send_account_purged(email)
            logger.info("account purged: user_id=%s counts=%s", user_id, counts)
            emit("account.purged", user_id=str(user_id), result="ok")
        except Exception as exc:
            db.rollback()
            try:
                db.add(
                    PurgeAuditLog(
                        deleted_user_id=user_id,
                        purged_at=now,
                        counts={},
                        result="failed",
                        error=str(exc)[:2000],
                    )
                )
                db.commit()
            except Exception:
                db.rollback()
            logger.exception("account purge failed: user_id=%s", user_id)
            emit("account.purged", user_id=str(user_id), result="failed")


def _legal_hold_active(db) -> bool:
    """Fail-closed legal-hold gate for the purge engine (F: hold_active).

    Queries LegalRequest directly — services must not import api.*.
    Unreadable hold table blocks purging (fail closed).
    """
    try:
        from sqlalchemy import select

        from tollms.models.incidents import LegalRequest

        row = db.execute(
            select(LegalRequest.id).where(
                LegalRequest.is_deleted.is_(False),
                LegalRequest.hold_active.is_(True),
            ).limit(1)
        ).first()
        return row is not None
    except Exception:
        logger.warning("legal-hold check failed", exc_info=True)
        return True


def _deletion_job() -> None:
    """Reminders (7-day, 1-day) then hard purge of due deletion requests."""
    from datetime import datetime, timezone

    with locked_sync(cache_keys.LOCK_SCHEDULER, cache_ttl.LOCK_SCHEDULER * 1000) as acquired:
        if not acquired:
            logger.warning("account deletion job skipped: lock held")
            return
        db = SessionLocal()
        try:
            now = datetime.now(timezone.utc)
            _send_deletion_notices(db, now)
            _purge_due_accounts(db, now)
        except Exception:
            logger.exception("account deletion job crashed")
        finally:
            db.close()


# NOTE: No orphan sweep. Explicit maintenance only: DELETE
# /api/v1/conversations/{id} (existing API). Hidden empty conversations stay
# hidden via the message_count filter (frontend behavior, untouched).

def _promptlog_cleanup_job() -> None:
    """Expire prompt-log bodies past their per-row expires_at (metadata kept)."""
    from tollms.services.prompt_logging import retention as retention_engine

    with locked_sync(cache_keys.LOCK_SCHEDULER, cache_ttl.LOCK_SCHEDULER * 1000) as acquired:
        if not acquired:
            logger.warning("promptlog cleanup skipped: lock held")
            return
        db = SessionLocal()
        try:
            count = retention_engine.expire_due_logs(db)
            logger.info("promptlog cleanup finished: %d rows expired", count)
        except Exception:
            logger.exception("promptlog cleanup crashed")
        finally:
            db.close()


# --- job definitions ---------------------------------------------------------
# Module-level table consumed by start() so tests can assert the schedule
# without starting the scheduler under pytest.

JOB_DEFS: tuple[dict, ...] = (
    {
        "id": "provider-health",
        "func": _provider_health_job,
        "trigger": "interval",
        "hours": 24,
    },
    {
        "id": "usage-rollup",
        "func": _usage_rollup_job,
        "trigger": "interval",
        "hours": 1,
    },
    {
        "id": "ops-cleanup",
        "func": _cleanup_job,
        "trigger": "interval",
        "days": 1,
    },
    {
        "id": "account-deletion",
        "func": _deletion_job,
        "trigger": "interval",
        "days": 1,
    },
    {
        "id": "promptlog-cleanup",
        "func": _promptlog_cleanup_job,
        "trigger": "interval",
        "days": 1,
    },
)


def start() -> None:
    """Start the operations scheduler. Idempotent; skipped under pytest."""
    global _scheduler
    if _scheduler is not None or os.getenv("PYTEST_CURRENT_TEST"):
        return
    sched = BackgroundScheduler(timezone="UTC")
    for job in JOB_DEFS:
        func = job["func"]
        job_id = job["id"]
        trigger = job.get("trigger", "interval")
        options = {k: v for k, v in job.items() if k not in ("func", "id", "trigger")}
        sched.add_job(func, trigger, id=job_id, replace_existing=True, **options)
    sched.start()
    _scheduler = sched
    logger.info("operations scheduler started (health 24h, rollup 1h, cleanup 1d, deletion 1d, promptlog 1d)")


def shutdown() -> None:
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
