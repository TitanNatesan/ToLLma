"""CostEstimationService: rate-card estimates for chat, images and video.

Chat estimates delegate to the token engine in `services/gateway/costing.py`.
Media estimates follow the official OpenAI pricing documentation
(developers.openai.com/api/docs/pricing, image-generation calculator):

- GPT Image models: per-image quality tables (1024x1024 baseline, sized
  variants) with a token-rate fallback for models that are billed purely by
  image output tokens.
- Sora video: per-second rates by model and resolution.

Every estimate carries its provenance (`source`): ``official`` (published
per-image table), ``official_tokens`` (published token rates), ``derived``
(token model scaled from the documented table), ``model``/``repository`` (user
overrides). An estimate is a fallback only — when the provider reports usage,
the gateway stores the actual cost and this module is not consulted.

Pure functions: no DB, no network, never raises on unknown models (returns
``None`` where the rate card has no answer).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from typing import Any

from tollms.services.gateway.costing import PriceSet, UsageTokens, calculate

_D = Decimal
_UNIT = _D(1_000_000)

# ---------------------------------------------------------------------------
# Official rate card
# ---------------------------------------------------------------------------

# Per-image prices by quality, square (1024x1024) and long-edge variants.
# Source: OpenAI image-generation calculator, "Earlier GPT Image models".
_IMAGE_QUALITY_TABLE: dict[str, dict[str, dict[str, Decimal]]] = {
    "gpt-image-1": {
        "low": {"square": _D("0.011"), "portrait": _D("0.016"), "landscape": _D("0.016")},
        "medium": {"square": _D("0.042"), "portrait": _D("0.063"), "landscape": _D("0.063")},
        "high": {"square": _D("0.167"), "portrait": _D("0.25"), "landscape": _D("0.25")},
    },
    "gpt-image-1-mini": {
        "low": {"square": _D("0.005"), "portrait": _D("0.006"), "landscape": _D("0.006")},
        "medium": {"square": _D("0.011"), "portrait": _D("0.015"), "landscape": _D("0.015")},
        "high": {"square": _D("0.036"), "portrait": _D("0.052"), "landscape": _D("0.052")},
    },
    "gpt-image-1.5": {
        "low": {"square": _D("0.009"), "portrait": _D("0.013"), "landscape": _D("0.013")},
        "medium": {"square": _D("0.034"), "portrait": _D("0.05"), "landscape": _D("0.05")},
        "high": {"square": _D("0.133"), "portrait": _D("0.2"), "landscape": _D("0.2")},
    },
    "gpt-image-2": {
        "low": {"square": _D("0.006"), "portrait": _D("0.005"), "landscape": _D("0.005")},
        "medium": {"square": _D("0.053"), "portrait": _D("0.041"), "landscape": _D("0.041")},
        "high": {"square": _D("0.211"), "portrait": _D("0.165"), "landscape": _D("0.165")},
    },
}

# Image output token rates (USD per 1M tokens) for token-billed image models.
_IMAGE_OUTPUT_TOKEN_RATE: dict[str, Decimal] = {
    "gpt-image-2.5": _D("30"),
    "gpt-image-2": _D("30"),
    "gpt-image-1.5": _D("32"),
    "gpt-image-1": _D("40"),
    "gpt-image-1-mini": _D("8"),
}

# Documented output tokens for the pre-2 models (per image, 1024x1024).
_IMAGE_SQUARE_TOKENS: dict[str, Decimal] = {
    "low": _D("272"),
    "medium": _D("1056"),
    "high": _D("4160"),
    # gpt-image-2.5 adds xhigh/max tiers; counts scale linearly from high
    # (the interactive calculator does not publish its token matrix).
    "xhigh": _D("6240"),
    "max": _D("8320"),
}
# Long-edge variants scale by 1.5 per the documented table (408/272 etc.).
_IMAGE_SIZE_TOKEN_SCALE = {"square": _D("1"), "portrait": _D("1.5"), "landscape": _D("1.5")}

# Sora per-second rates by model and resolution.
_VIDEO_PER_SECOND: dict[str, dict[str, Decimal]] = {
    "sora-2-pro": {"720p": _D("0.30"), "1024p": _D("0.50"), "1080p": _D("0.70")},
    "sora-2": {"720p": _D("0.10")},
}

_SIZE_RE = re.compile(r"^(\d+)\s*[x×]\s*(\d+)$")

# Vision/edit image input rates used when the provider reports totals only.
_IMAGE_INPUT_TOKEN_RATE: dict[str, Decimal] = {
    "gpt-image-2.5": _D("8"),
    "gpt-image-2": _D("8"),
    "gpt-image-1.5": _D("8"),
    "gpt-image-1": _D("10"),
    "gpt-image-1-mini": _D("2.5"),
}
_IMAGE_TEXT_INPUT_TOKEN_RATE: dict[str, Decimal] = {
    "gpt-image-2.5": _D("5"),
    "gpt-image-2": _D("5"),
    "gpt-image-1.5": _D("5"),
    "gpt-image-1": _D("5"),
    "gpt-image-1-mini": _D("2"),
}


@dataclass(frozen=True)
class CostEstimate:
    """One estimated charge with its basis and provenance."""

    estimated_cost: Decimal
    kind: str  # chat | image | video
    source: str  # official | official_tokens | derived | model | repository | unknown
    basis: dict[str, Any] = field(default_factory=dict)
    estimated: bool = True
    currency: str = "USD"

    def as_dict(self) -> dict[str, Any]:
        return {
            "estimated_cost": str(self.estimated_cost),
            "kind": self.kind,
            "source": self.source,
            "estimated": self.estimated,
            "currency": self.currency,
            "basis": self.basis,
        }


def _model_base(model_id: str | None) -> str:
    """Strip vendor prefixes/tags: 'openai/gpt-image-1:latest' -> 'gpt-image-1'."""
    if not model_id:
        return ""
    tail = model_id.strip().lower().rsplit("/", 1)[-1]
    return tail.split(":", 1)[0]


def _match_rate[V](model_id: str | None, table: dict[str, V]) -> tuple[str, V] | None:
    """Longest-prefix match on a model-id boundary.

    Ordered longest-first so ``gpt-image-1-mini`` beats ``gpt-image-1`` and
    ``gpt-image-2.5`` beats ``gpt-image-2``; a version key only matches when the
    next character is a separator (``-``/``:``), so ``gpt-image-2.5-sunburst``
    never falls back to the ``gpt-image-2`` row.
    """
    base = _model_base(model_id)
    if not base:
        return None
    for key in sorted(table, key=len, reverse=True):
        if base == key or (base.startswith(key) and len(base) > len(key) and base[len(key)] in "-:"):
            return key, table[key]
    return None


def size_class(size: str | None) -> str:
    """'1024x1536' -> portrait, '1536x1024' -> landscape, else square."""
    match = _SIZE_RE.match((size or "").strip())
    if not match:
        return "square"
    width, height = int(match.group(1)), int(match.group(2))
    if width == height:
        return "square"
    return "landscape" if width > height else "portrait"


def video_resolution(size: str | None) -> str:
    """Normalize a video size to the rate-card resolution bucket."""
    match = _SIZE_RE.match((size or "").strip())
    if not match:
        return "720p"
    width, height = int(match.group(1)), int(match.group(2))
    short_edge = min(width, height)
    if short_edge >= 1080:
        return "1080p"
    if short_edge >= 1024:
        return "1024p"
    return "720p"


# ---------------------------------------------------------------------------
# Public estimators
# ---------------------------------------------------------------------------


def estimate_chat_cost(
    tokens: UsageTokens,
    prices: PriceSet,
) -> CostEstimate:
    """Token cost via the shared pricing engine (input/output/cache/reasoning)."""
    breakdown = calculate(tokens, prices)
    return CostEstimate(
        estimated_cost=breakdown.total_cost,
        kind="chat",
        source="model",
        basis={
            "prompt_tokens": tokens.prompt,
            "completion_tokens": tokens.completion,
            "cache_read_tokens": tokens.cache_read,
            "cache_write_tokens": tokens.cache_write,
            "reasoning_tokens": tokens.reasoning,
        },
        estimated=False,
    )


def image_rate_per_image(
    model_id: str | None,
    quality: str | None,
    *,
    size: str | None = None,
    low: Decimal | None = None,
    medium: Decimal | None = None,
    high: Decimal | None = None,
) -> tuple[Decimal | None, str]:
    """One image price + provenance. Explicit model/repository values win."""
    tier = (quality or "low").strip().lower()
    if tier == "auto":
        tier = "medium"
    configured = {"low": low, "medium": medium, "high": high}.get(tier)
    if configured is not None and configured > 0:
        return configured, "model"
    matched = _match_rate(model_id, _IMAGE_QUALITY_TABLE)
    if matched is not None:
        _, qualities = matched
        prices = qualities.get(tier)
        if prices is not None:
            return prices.get(size_class(size), prices["square"]), "official"
    return None, "unknown"


def estimate_image_cost(
    *,
    model_id: str | None = None,
    quality: str | None = "low",
    size: str | None = "1024x1024",
    count: int = 1,
    low: Decimal | None = None,
    medium: Decimal | None = None,
    high: Decimal | None = None,
) -> CostEstimate:
    """Image generation estimate: per-image table first, token model second."""
    count = max(1, int(count or 1))
    tier = (quality or "low").strip().lower()
    per_image, source = image_rate_per_image(
        model_id, tier, size=size, low=low, medium=medium, high=high
    )
    if per_image is not None:
        total = (per_image * count).quantize(_D("0.00000001"))
        return CostEstimate(
            estimated_cost=total,
            kind="image",
            source=source,
            basis={
                "model": _model_base(model_id),
                "quality": tier,
                "size": size or "1024x1024",
                "count": count,
                "price_per_image": str(per_image),
            },
        )
    matched = _match_rate(model_id, _IMAGE_OUTPUT_TOKEN_RATE)
    if matched is None:
        return CostEstimate(
            estimated_cost=_D(0),
            kind="image",
            source="unknown",
            basis={"model": _model_base(model_id), "quality": tier, "size": size, "count": count},
        )
    _, output_rate = matched
    tokens = (
        _IMAGE_SQUARE_TOKENS.get(tier, _IMAGE_SQUARE_TOKENS["medium"])
        * _IMAGE_SIZE_TOKEN_SCALE.get(size_class(size), _D("1"))
    )
    per_image = tokens * output_rate / _UNIT
    total = (per_image * count).quantize(_D("0.00000001"))
    return CostEstimate(
        estimated_cost=total,
        kind="image",
        source="derived",
        basis={
            "model": _model_base(model_id),
            "quality": tier,
            "size": size or "1024x1024",
            "count": count,
            "output_tokens": str(tokens),
            "output_token_rate_per_million": str(output_rate),
        },
    )


def actual_image_cost(
    *,
    model_id: str | None,
    input_tokens: int | None,
    output_tokens: int | None,
    text_input_tokens: int | None = None,
    image_input_tokens: int | None = None,
) -> CostEstimate | None:
    """Provider-reported image usage -> actual cost. None when usage is absent."""
    if not output_tokens:
        return None
    matched = _match_rate(model_id, _IMAGE_OUTPUT_TOKEN_RATE)
    output_rate = matched[1] if matched else _D("0")
    input_rate = _match_rate(model_id, _IMAGE_INPUT_TOKEN_RATE)
    text_rate = _match_rate(model_id, _IMAGE_TEXT_INPUT_TOKEN_RATE)
    image_rate = input_rate[1] if input_rate else output_rate
    text_rate_value = text_rate[1] if text_rate else image_rate
    if text_input_tokens is not None or image_input_tokens is not None:
        billed_input = _D(text_input_tokens or 0) * text_rate_value + _D(image_input_tokens or 0) * image_rate
    else:
        billed_input = _D(input_tokens or 0) * image_rate
    total = (billed_input + _D(output_tokens) * output_rate) / _UNIT
    return CostEstimate(
        estimated_cost=total.quantize(_D("0.00000001")),
        kind="image",
        source="actual",
        estimated=False,
        basis={
            "model": _model_base(model_id),
            "input_tokens": input_tokens or 0,
            "output_tokens": output_tokens,
            "text_input_tokens": text_input_tokens,
            "image_input_tokens": image_input_tokens,
        },
    )


def video_rate_per_second(
    model_id: str | None,
    size: str | None,
    *,
    price_per_second: Decimal | None = None,
) -> tuple[Decimal | None, str]:
    """One second of video price + provenance."""
    if price_per_second is not None and price_per_second > 0:
        return price_per_second, "model"
    matched = _match_rate(model_id, _VIDEO_PER_SECOND)
    if matched is None:
        return None, "unknown"
    _, by_resolution = matched
    resolution = video_resolution(size)
    rate = by_resolution.get(resolution) or next(iter(by_resolution.values()))
    return rate, "official"


def estimate_video_cost(
    *,
    model_id: str | None = None,
    seconds: float | str | None = 4,
    size: str | None = "1280x720",
    price_per_second: Decimal | None = None,
) -> CostEstimate:
    """Video generation estimate from the per-second rate card."""
    try:
        duration = _D(str(seconds or 0))
    except (InvalidOperation, ValueError, TypeError):
        duration = _D(0)
    rate, source = video_rate_per_second(model_id, size, price_per_second=price_per_second)
    if rate is None:
        return CostEstimate(
            estimated_cost=_D(0),
            kind="video",
            source="unknown",
            basis={"model": _model_base(model_id), "seconds": str(duration), "size": size},
        )
    total = (rate * duration).quantize(_D("0.00000001"))
    return CostEstimate(
        estimated_cost=total,
        kind="video",
        source=source,
        basis={
            "model": _model_base(model_id),
            "seconds": str(duration),
            "resolution": video_resolution(size),
            "price_per_second": str(rate),
        },
    )


def estimate_cost(kind: str, **kwargs: Any) -> dict[str, Any]:
    """Unified interface. kind = "chat" | "image" | "video".

    Returns ``{"estimated_cost": ..., "kind": ..., "source": ...}``; unknown
    kinds return a zero estimate rather than raising.
    """
    if kind == "chat":
        tokens = kwargs.get("tokens") or UsageTokens()
        prices = kwargs.get("prices") or PriceSet()
        return estimate_chat_cost(tokens, prices).as_dict()
    if kind == "image":
        return estimate_image_cost(
            model_id=kwargs.get("model_id"),
            quality=kwargs.get("quality"),
            size=kwargs.get("size"),
            count=kwargs.get("count", 1),
            low=kwargs.get("low"),
            medium=kwargs.get("medium"),
            high=kwargs.get("high"),
        ).as_dict()
    if kind == "video":
        return estimate_video_cost(
            model_id=kwargs.get("model_id"),
            seconds=kwargs.get("seconds"),
            size=kwargs.get("size"),
            price_per_second=kwargs.get("price_per_second"),
        ).as_dict()
    return CostEstimate(
        estimated_cost=_D(0), kind=kind or "unknown", source="unknown"
    ).as_dict()


@dataclass
class MediaRateCard:
    """Media prices resolved for one registered model (metadata/repository/official)."""

    image_low: Decimal | None = None
    image_medium: Decimal | None = None
    image_high: Decimal | None = None
    video_per_second: Decimal | None = None


def _as_decimal(value: Any) -> Decimal | None:
    if value is None or value == "":
        return None
    try:
        return _D(str(value))
    except (InvalidOperation, ValueError, TypeError):
        return None


def _card_from_mapping(source: dict[str, Any]) -> MediaRateCard:
    return MediaRateCard(
        image_low=_as_decimal(source.get("image_low_price")),
        image_medium=_as_decimal(source.get("image_medium_price")),
        image_high=_as_decimal(source.get("image_high_price")),
        video_per_second=_as_decimal(source.get("video_price_per_second")),
    )


def media_rate_card(model: Any = None, repo_entry: Any = None) -> MediaRateCard:
    """Resolve media prices: model metadata -> repository columns -> official."""
    card = MediaRateCard()
    metadata = getattr(model, "metadata_", None)
    if isinstance(metadata, dict):
        card = _card_from_mapping(metadata)
    if repo_entry is not None:
        repo = _card_from_mapping(
            {
                "image_low_price": getattr(repo_entry, "image_low_price", None),
                "image_medium_price": getattr(repo_entry, "image_medium_price", None),
                "image_high_price": getattr(repo_entry, "image_high_price", None),
                "video_price_per_second": getattr(repo_entry, "video_price_per_second", None),
            }
        )
        card = MediaRateCard(
            image_low=card.image_low or repo.image_low,
            image_medium=card.image_medium or repo.image_medium,
            image_high=card.image_high or repo.image_high,
            video_per_second=card.video_per_second or repo.video_per_second,
        )
    model_id = getattr(model, "model_id", None)
    matched = _match_rate(model_id, _IMAGE_QUALITY_TABLE)
    if matched is not None:
        qualities = matched[1]
        card.image_low = card.image_low or qualities["low"]["square"]
        card.image_medium = card.image_medium or qualities["medium"]["square"]
        card.image_high = card.image_high or qualities["high"]["square"]
    video_match = _match_rate(model_id, _VIDEO_PER_SECOND)
    if video_match is not None:
        card.video_per_second = card.video_per_second or video_match[1]["720p"]
    return card


def official_media_prices(model_id: str) -> dict[str, Decimal | None]:
    """Rate-card values for repository seeding (None when unpriced)."""
    card = MediaRateCard()
    matched = _match_rate(model_id, _IMAGE_QUALITY_TABLE)
    if matched is not None:
        qualities = matched[1]
        card.image_low = qualities["low"]["square"]
        card.image_medium = qualities["medium"]["square"]
        card.image_high = qualities["high"]["square"]
    video_match = _match_rate(model_id, _VIDEO_PER_SECOND)
    if video_match is not None:
        card.video_per_second = video_match[1]["720p"]
    return {
        "image_low_price": card.image_low,
        "image_medium_price": card.image_medium,
        "image_high_price": card.image_high,
        "video_price_per_second": card.video_per_second,
    }
