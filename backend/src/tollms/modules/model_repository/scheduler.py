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
    from datetime import datetime, timezone
    from tollms.modules.model_repository.models import RepositoryModel

    next_run = None
    db = SessionLocal()
    try:
        if db.query(RepositoryModel).count() == 0:
            next_run = datetime.now(timezone.utc)
    except Exception:
        pass
    finally:
        db.close()

    sched = BackgroundScheduler(timezone="UTC")
    kwargs = {"next_run_time": next_run} if next_run else {}
    sched.add_job(
        _sync_job,
        "interval",
        hours=24,
        id="model-repository-sync",
        replace_existing=True,
        **kwargs,
    )
    sched.start()
    _scheduler = sched
    logger.info("model repository scheduler started (every 24h)")


def shutdown() -> None:
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
        logger.info("model repository scheduler stopped")
