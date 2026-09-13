"""CostCalculationService: usage tokens + price set -> per-request cost breakdown.

All prices are per 1M tokens. Repository prices arrive per-token and are
scaled up at the call site (prices_for_model); provider-model prices are
already per-1M. Reasoning tokens price at the output rate unless the source
quotes an explicit reasoning rate.
"""

import logging
from dataclasses import dataclass
from decimal import Decimal

logger = logging.getLogger(__name__)

_UNIT = Decimal(1_000_000)


@dataclass
class UsageTokens:
    prompt: int = 0
    completion: int = 0
    cache_read: int = 0
    cache_write: int = 0
    reasoning: int = 0


@dataclass
class PriceSet:
    """Per-1M-token prices. Zeros mean 'unpriced', never None downstream."""

    input: Decimal = Decimal(0)
    output: Decimal = Decimal(0)
    cache_read: Decimal = Decimal(0)
    cache_write: Decimal = Decimal(0)
    reasoning: Decimal = Decimal(0)


@dataclass
class CostBreakdown:
    input_cost: Decimal = Decimal(0)
    output_cost: Decimal = Decimal(0)
    cache_read_cost: Decimal = Decimal(0)
    cache_write_cost: Decimal = Decimal(0)
    reasoning_cost: Decimal = Decimal(0)
    total_cost: Decimal = Decimal(0)

    def legacy_triplet(self) -> tuple[Decimal, Decimal, Decimal]:
        """(input, output, total) for stored Message columns."""
        return self.input_cost, self.output_cost, self.total_cost


def calculate(tokens: UsageTokens, prices: PriceSet) -> CostBreakdown:
    """Pure function: no DB, no network. Every field is always computed."""
    billed_completion = max(0, tokens.completion - tokens.reasoning)
    out = CostBreakdown(
        input_cost=Decimal(tokens.prompt) * prices.input / _UNIT,
        output_cost=Decimal(billed_completion) * prices.output / _UNIT,
        cache_read_cost=Decimal(tokens.cache_read) * prices.cache_read / _UNIT,
        cache_write_cost=Decimal(tokens.cache_write) * prices.cache_write / _UNIT,
        reasoning_cost=Decimal(tokens.reasoning) * (prices.reasoning or prices.output) / _UNIT,
    )
    out.total_cost = (
        out.input_cost + out.output_cost + out.cache_read_cost + out.cache_write_cost + out.reasoning_cost
    )
    return out


def prices_for_model(model, repo_entry=None) -> PriceSet:
    """Merge price sources. Repository wins per-field; model fills the gaps.

    Repository prices are per-token (scaled x1M); model prices are per-1M.
    Never raises: falls back to zeros.
    """
    prices = PriceSet(
        input=model.input_price or Decimal(0),
        output=model.output_price or Decimal(0),
        cache_read=model.cache_read_price or Decimal(0),
        cache_write=model.cache_write_price or Decimal(0),
    )
    if repo_entry is None:
        return prices
    try:
        scale = {
            "input": repo_entry.input_cost,
            "output": repo_entry.output_cost,
            "cache_read": repo_entry.cache_read_cost,
            "cache_write": repo_entry.cache_write_cost,
            "reasoning": repo_entry.reasoning_cost,
        }
        for field, per_token in scale.items():
            if per_token is not None:
                setattr(prices, field, Decimal(per_token) * _UNIT)
    except Exception:
        logger.exception("costing: repository price merge failed, using model prices")
    return prices
