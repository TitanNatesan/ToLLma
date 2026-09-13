"""Health endpoints. No business logic, no auth."""

import logging

from fastapi import APIRouter
from sqlalchemy import text

from tollms.db.session import engine

logger = logging.getLogger(__name__)

router = APIRouter(tags=["health"])


@router.get("/health")
def liveness() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/health/ready")
def readiness() -> dict[str, str]:
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
    except Exception:
        logger.exception("readiness check: database unreachable")
        return {"status": "degraded", "database": "unreachable"}
    return {"status": "ok", "database": "reachable"}
