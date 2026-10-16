"""Org spend caps: ledger reads and cap changes."""

import logging
import uuid
from decimal import Decimal

from sqlalchemy.orm import Session

from tollms.api.orgs.common.audit import _audit
from tollms.api.orgs.common.guards import (
    _ORG_NOT_FOUND,
    _member_org,
    _require_perm,
    effective_permissions,
)
from tollms.api.orgs.keys.service import _allocated_budget
from tollms.api.orgs.schemas import BudgetRead
from tollms.core.exceptions import NotFoundError, ValidationError

logger = logging.getLogger(__name__)


def get_budget(db: Session, caller_id: uuid.UUID, org_id: uuid.UUID) -> BudgetRead:
    """{max_spend, allocated, unallocated}. Gates: Budgets.Read/Update or
    Analytics.ViewUsage (strangers denied as 404)."""
    org, mem = _member_org(db, org_id, caller_id)
    perms = effective_permissions(db, org_id, caller_id)
    if not (mem.is_root or perms & {"Budgets.Read", "Budgets.Update", "Analytics.ViewUsage"}):
        raise NotFoundError(_ORG_NOT_FOUND)
    allocated = _allocated_budget(db, org_id)
    cap = Decimal(str(org.max_spend)) if org.max_spend is not None else None
    return BudgetRead(
        max_spend=cap, allocated=allocated,
        unallocated=(cap - allocated) if cap is not None else None,
    )



def set_budget_cap(db: Session, caller_id: uuid.UUID, org_id: uuid.UUID,
                   max_spend: Decimal | None) -> BudgetRead:
    """Set or clear the org spend cap. A cap below allocated is rejected (422)."""
    from tollms.services.observability.events import emit

    org, mem = _member_org(db, org_id, caller_id)
    _require_perm(db, org, mem, caller_id, "Budgets.Update")
    if max_spend is not None and max_spend < 0:
        raise ValidationError("max_spend must be >= 0")
    allocated = _allocated_budget(db, org_id)
    if max_spend is not None and Decimal(str(max_spend)) < allocated:
        raise ValidationError(
            f"cap {max_spend} is below allocated {allocated}: revoke keys first"
        )
    org.max_spend = max_spend
    _audit(db, org_id, caller_id, "budget.cap_changed",
           max_spend=str(max_spend) if max_spend is not None else None)
    emit("budget.cap_changed", org_id=str(org_id), user_id=str(caller_id),
         max_spend=str(max_spend) if max_spend is not None else None)
    db.commit()
    db.refresh(org)
    logger.info("org budget cap changed: org=%s max_spend=%s", org_id, max_spend)
    return get_budget(db, caller_id, org_id)

