"""Org spend-cap endpoints."""

import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from tollms.api.orgs.budgets import service
from tollms.api.orgs.schemas import BudgetRead, BudgetUpdate
from tollms.core.deps import get_db
from tollms.core.security import require_active_user
from tollms.models.user import User

router = APIRouter()


@router.get("/{org_id}/budget", response_model=BudgetRead)
def get_budget(org_id: uuid.UUID, db: Session = Depends(get_db),
               user: User = Depends(require_active_user)):
    return service.get_budget(db, user.id, org_id)



@router.patch("/{org_id}/budget", response_model=BudgetRead)
def set_budget_cap(org_id: uuid.UUID, data: BudgetUpdate, db: Session = Depends(get_db),
                   user: User = Depends(require_active_user)):
    return service.set_budget_cap(db, user.id, org_id, data.max_spend)

