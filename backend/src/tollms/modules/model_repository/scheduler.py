"""24h background sync scheduling (APScheduler)."""

import logging
import os

from apscheduler.schedulers.background import BackgroundScheduler

from tollms.db.session import SessionLocal
from tollms.modules.model_repository.service import run_sync

logger = logging.getLogger(__name__)

_scheduler: BackgroundScheduler | None = None


def _sync_job() -> None:
    db = SessionLocal()
    try:
        run = run_sync(db)
        logger.info("scheduled model repository sync finished: %s", run.status)
    except Exception:
        logger.exception("scheduled model repository sync crashed")
    finally:
        db.close()


def start() -> None:
    """Start the 24h sync scheduler. Idempotent; skipped under pytest."""
    global _scheduler
    if _scheduler is not None or os.getenv("PYTEST_CURRENT_TEST"):
        return
    sched = BackgroundScheduler(timezone="UTC")
    sched.add_job(_sync_job, "interval", hours=24, id="model-repository-sync", replace_existing=True)
    sched.start()
    _scheduler = sched
    logger.info("model repository scheduler started (every 24h)")


def shutdown() -> None:
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
        logger.info("model repository scheduler stopped")
