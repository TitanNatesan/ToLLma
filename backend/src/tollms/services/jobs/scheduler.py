"""Periodic operations scheduler (APScheduler).

One engine, one scheduler: provider health checks (5 min), usage rollups
(hourly) and expired-token cleanup (daily). Model repository sync keeps its
own scheduler. Each job is lock-guarded, per-item exception-safe and skipped
under pytest — a failed job never takes down the process or other jobs.
"""

import asyncio
import logging
import os
from datetime import date, timedelta

from apscheduler.schedulers.background import BackgroundScheduler

from tollms.db.session import SessionLocal
from tollms.services.cache import constants as cache_ttl
from tollms.services.cache import keys as cache_keys
from tollms.services.cache.locks import locked_sync

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
    """Delete expired, unused password-reset tokens (safe: single-use + time-boxed)."""
    from datetime import datetime, timezone

    from sqlalchemy import delete

    from tollms.models.password_reset import PasswordResetToken

    db = SessionLocal()
    try:
        result = db.execute(
            delete(PasswordResetToken).where(
                PasswordResetToken.used_at.is_not(None),
                PasswordResetToken.expires_at < datetime.now(timezone.utc),
            )
        )
        db.commit()
        logger.info("cleanup finished: %d expired reset tokens purged", result.rowcount)
    except Exception:
        db.rollback()
        logger.exception("cleanup crashed")
    finally:
        db.close()


def start() -> None:
    """Start the operations scheduler. Idempotent; skipped under pytest."""
    global _scheduler
    if _scheduler is not None or os.getenv("PYTEST_CURRENT_TEST"):
        return
    sched = BackgroundScheduler(timezone="UTC")
    sched.add_job(_provider_health_job, "interval", minutes=5, id="provider-health", replace_existing=True)
    sched.add_job(_usage_rollup_job, "interval", hours=1, id="usage-rollup", replace_existing=True)
    sched.add_job(_cleanup_job, "interval", days=1, id="ops-cleanup", replace_existing=True)
    sched.start()
    _scheduler = sched
    logger.info("operations scheduler started (health 5m, rollup 1h, cleanup 1d)")


def shutdown() -> None:
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
