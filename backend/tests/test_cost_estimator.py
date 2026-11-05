"""Cost estimator: official rate card, media estimates, actual-usage override."""

from decimal import Decimal

import pytest
from tollms.services import cost_estimator as ce
from tollms.services.gateway.costing import PriceSet, UsageTokens


class _Model:
    def __init__(self, model_id: str, metadata: dict | None = None) -> None:
        self.model_id = model_id
        self.metadata_ = metadata or {}


class _Repo:
    def __init__(self, **kw) -> None:
        self.image_low_price = kw.get("image_low_price")
        self.image_medium_price = kw.get("image_medium_price")
        self.image_high_price = kw.get("image_high_price")
        self.video_price_per_second = kw.get("video_price_per_second")


def test_official_image_prices_square_and_sized() -> None:
    low = ce.estimate_image_cost(model_id="gpt-image-1", quality="low")
    assert low.source == "official"
    assert low.estimated_cost == Decimal("0.011")
    medium = ce.estimate_image_cost(model_id="gpt-image-1", quality="medium", size="1024x1536")
    assert medium.estimated_cost == Decimal("0.063")
    high = ce.estimate_image_cost(model_id="gpt-image-1", quality="high", size="1536x1024")
    assert high.estimated_cost == Decimal("0.25")
    # count multiplies; auto quality maps to medium.
    assert ce.estimate_image_cost(model_id="gpt-image-1", quality="auto", count=3).estimated_cost == Decimal(
        "0.126"
    )


def test_image_model_variants_do_not_fall_back_to_wrong_row() -> None:
    """gpt-image-2.5 is token-billed: it must not use the gpt-image-2 per-image row."""
    estimate = ce.estimate_image_cost(model_id="gpt-image-2.5-sunburst", quality="high")
    assert estimate.source == "derived"
    assert estimate.basis["output_tokens"] == "4160"
    assert estimate.estimated_cost == Decimal("0.1248")
    mini = ce.estimate_image_cost(model_id="gpt-image-1-mini", quality="low")
    assert mini.estimated_cost == Decimal("0.005")


def test_video_per_second_by_resolution() -> None:
    assert ce.estimate_video_cost(model_id="sora-2", seconds=4).estimated_cost == Decimal("0.4")
    assert ce.estimate_video_cost(model_id="sora-2-pro", seconds=8, size="1920x1080").estimated_cost == Decimal(
        "5.6"
    )
    assert ce.estimate_video_cost(model_id="sora-2-pro", seconds=4, size="1792x1024").estimated_cost == Decimal(
        "2.0"
    )
    assert ce.video_resolution("1080x1920") == "1080p"
    assert ce.video_resolution("1280x720") == "720p"


def test_configured_prices_win_over_official() -> None:
    estimate = ce.estimate_image_cost(
        model_id="gpt-image-1", quality="high", low=None, medium=None, high=Decimal("0.5")
    )
    assert estimate.source == "model"
    assert estimate.estimated_cost == Decimal("0.5")


def test_actual_image_cost_from_provider_usage() -> None:
    actual = ce.actual_image_cost(
        model_id="gpt-image-1",
        input_tokens=100,
        output_tokens=4160,
        text_input_tokens=60,
        image_input_tokens=40,
    )
    assert actual is not None and actual.source == "actual" and actual.estimated is False
    # 60 text @ $5/1M + 40 image @ $10/1M + 4160 output @ $40/1M
    expected = (Decimal(60) * Decimal(5) + Decimal(40) * Decimal(10) + Decimal(4160) * Decimal(40)) / Decimal(
        1_000_000
    )
    assert actual.estimated_cost == expected.quantize(Decimal("0.00000001"))
    assert ce.actual_image_cost(model_id="gpt-image-1", input_tokens=None, output_tokens=None) is None


def test_unknown_model_estimates_zero_without_raising() -> None:
    image = ce.estimate_image_cost(model_id="local/mystery-image", quality="low")
    assert image.estimated_cost == Decimal(0) and image.source == "unknown"
    video = ce.estimate_video_cost(model_id="mystery-video", seconds=4)
    assert video.estimated_cost == Decimal(0)
    assert ce.estimate_cost("audio", model_id="x")["estimated_cost"] == "0"


def test_unified_estimate_cost_interface() -> None:
    chat = ce.estimate_cost(
        "chat",
        tokens=UsageTokens(prompt=1_000_000, completion=1_000_000),
        prices=PriceSet(input=Decimal(2), output=Decimal(10)),
    )
    assert chat["kind"] == "chat"
    assert Decimal(chat["estimated_cost"]) == Decimal(12)
    image = ce.estimate_cost("image", model_id="gpt-image-1", quality="low")
    assert image["estimated_cost"] == "0.01100000" and image["kind"] == "image"
    video = ce.estimate_cost("video", model_id="sora-2", seconds=4)
    assert video["estimated_cost"] == "0.40000000"


def test_media_rate_card_precedence() -> None:
    official = ce.media_rate_card(_Model("gpt-image-1"))
    assert official.image_low == Decimal("0.011")
    assert official.image_medium == Decimal("0.042")

    repo = ce.media_rate_card(_Model("gpt-image-1"), _Repo(image_low_price=Decimal("0.02")))
    assert repo.image_low == Decimal("0.02") and repo.image_medium == Decimal("0.042")

    model_meta = ce.media_rate_card(_Model("gpt-image-1", {"image_low_price": "0.03"}))
    assert model_meta.image_low == Decimal("0.03")

    video = ce.media_rate_card(_Model("sora-2"))
    assert video.video_per_second == Decimal("0.10")
    assert ce.media_rate_card(_Model("gpt-4.1")).video_per_second is None


def test_official_media_prices_seed_payload() -> None:
    seeded = ce.official_media_prices("gpt-image-1")
    assert seeded["image_low_price"] == Decimal("0.011")
    assert seeded["video_price_per_second"] is None
    seeded_video = ce.official_media_prices("sora-2-pro")
    assert seeded_video["video_price_per_second"] == Decimal("0.30")


def test_estimate_chat_cost_matches_token_engine() -> None:
    estimate = ce.estimate_chat_cost(
        UsageTokens(prompt=1_000, completion=500, cache_read=200),
        PriceSet(input=Decimal(2), output=Decimal(10), cache_read=Decimal("0.5")),
    )
    assert estimate.kind == "chat" and estimate.estimated is False
    # prompt total includes the 200 cached tokens: input bills 800 @ 2.
    expected = (Decimal(800) * 2 + Decimal(500) * 10 + Decimal(200) * Decimal("0.5")) / Decimal(1_000_000)
    assert estimate.estimated_cost == expected


@pytest.mark.parametrize(
    ("size", "expected"),
    [("1024x1024", "square"), ("1024x1536", "portrait"), ("1536x1024", "landscape"), ("auto", "square")],
)
def test_size_class(size: str, expected: str) -> None:
    assert ce.size_class(size) == expected
