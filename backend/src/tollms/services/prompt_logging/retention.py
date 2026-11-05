"""Prompt-log retention: expire bodies past their per-row expires_at.

Metadata rows are never deleted; audit rows and billing rows are untouched.

Accepted gap (M3): the daily job writes no per-org audit ledger rows, and
personal purges are unaudited — at daily-job volume a per-org ledger row per
expiry pass is noise, and personal workspaces have no org ledger to write
to. User-invoked purges ARE audited at the API layer (records.purge_logs);
revisit if compliance ever needs per-org proof of job runs.
"""

import logging
from datetime import datetime, timezone

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from tollms.models.prompt_logging import PromptLog

logger = logging.getLogger(__name__)


def expire_due_logs(db: Session, *, now: datetime | None = None) -> int:
    """NULL expired bodies (content_expired=True), keep metadata. Returns rows."""
    moment = now or datetime.now(timezone.utc)
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    try:
        result = db.execute(
            update(PromptLog)
            .where(
                PromptLog.expires_at.is_not(None),
                PromptLog.expires_at < moment,
                PromptLog.content_expired.is_(False),
            )
            .values(input_cipher=None, output_cipher=None, content_expired=True)
        )
        db.commit()
        count = result.rowcount or 0
        if count:
            logger.info("promptlog retention expired %d rows", count)
        return count
    except Exception:
        db.rollback()
        logger.warning("promptlog retention failed", exc_info=True)
        return 0


def due_count(db: Session, *, now: datetime | None = None) -> int:
    """Rows past expiry still holding content (for tests/ops checks)."""
    from sqlalchemy import func

    moment = now or datetime.now(timezone.utc)
    try:
        return int(db.scalar(
            select(func.count())
            .select_from(PromptLog)
            .where(PromptLog.expires_at.is_not(None), PromptLog.expires_at < moment, PromptLog.content_expired.is_(False))
        ) or 0)
    except Exception:
        logger.warning("promptlog due-count failed", exc_info=True)
        return 0
