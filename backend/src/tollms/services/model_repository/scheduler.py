"""Model-catalog sync: fetch on every backend start, then every 6 hours (APScheduler)."""

import logging
import os

from apscheduler.schedulers.background import BackgroundScheduler

from tollms.db.session import SessionLocal
from tollms.services.cache import constants as cache_ttl
from tollms.services.cache import keys as cache_keys
from tollms.services.cache.locks import locked_sync
from tollms.services.model_repository.sync import run_sync

logger = logging.getLogger(__name__)

_scheduler: BackgroundScheduler | None = None


def _sync_job() -> None:
    with locked_sync(cache_keys.LOCK_SCHEDULER, cache_ttl.LOCK_SCHEDULER * 1000) as acquired:
        if not acquired:
            logger.warning("scheduled model repository sync skipped: previous run still holds the lock")
            return
        db = SessionLocal()
        try:
            run = run_sync(db)
            logger.info("scheduled model repository sync finished: %s", run.status)
        except Exception:
            logger.exception("scheduled model repository sync crashed")
        finally:
            db.close()


def start() -> None:
    """Start the sync scheduler: one run at startup, then every 6h. Idempotent; skipped under pytest."""
    global _scheduler
    if _scheduler is not None or os.getenv("PYTEST_CURRENT_TEST"):
        return
    from datetime import datetime, timezone

    sched = BackgroundScheduler(timezone="UTC")
    # Always sync once at startup (catches catalog drift while offline),
    # then refresh every 6 hours. Overlapping runs are lock-guarded.
    sched.add_job(
        _sync_job,
        "interval",
        hours=6,
        id="model-repository-sync",
        replace_existing=True,
        next_run_time=datetime.now(timezone.utc),
    )
    sched.start()
    _scheduler = sched
    logger.info("model repository scheduler started (startup + every 6h)")


def shutdown() -> None:
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
        logger.info("model repository scheduler stopped")
