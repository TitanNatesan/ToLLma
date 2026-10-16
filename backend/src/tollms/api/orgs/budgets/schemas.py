"""Org spend-cap models. NULL max_spend = unlimited."""

from decimal import Decimal

from pydantic import BaseModel, Field


class BudgetRead(BaseModel):
    """Org spend cap ledger. NULL max_spend = unlimited."""

    max_spend: Decimal | None = None
    allocated: Decimal = Decimal("0")
    unallocated: Decimal | None = None



class BudgetUpdate(BaseModel):
    """Set or clear the cap. None clears it (unlimited). Must stay >= allocated."""

    max_spend: Decimal | None = Field(default=None, ge=0)

