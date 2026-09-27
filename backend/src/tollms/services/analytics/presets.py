"""Canonical analytics preset vocabulary shared by every analytics surface.

Three engines grew three preset dialects over disjoint fact tables:

* gateway (``services/analytics`` over ``api_request_logs``) — trailing
  presets: ``24h``, ``7d``, ``30d``, ``90d``, ``custom``.
* chat (``api/analytics`` over ``messages``) — calendar presets: ``today``,
  ``yesterday``, ``last_7d``, ``last_30d``, ``this_month``, ``last_month``,
  ``last_90d``, ``custom``.
* keys (``api/keys`` + ``services/gateway/api_logs`` over
  ``api_request_logs`` key-scoped) — ``today``, ``last_7d``, ``last_30d``,
  ``last_90d``, ``this_month``.

``normalize`` accepts the union of all legacy aliases on every surface and
maps each token to the calling family's native preset. Trailing-day presets
(``24h`` — last 24 wall-clock hours ending now) and calendar presets
(``today`` — local midnight to now) keep distinct semantics and are never
merged; cross-family mappings are documented approximations. Unknown tokens
fall back to the family's existing default (gateway ``7d``, chat and
gateway-key ``this_month``); the user-facing keys surface has no fallback
and still raises (HTTP 422), preserving its fail-closed contract. ``custom``
on the keys surface also raises — it takes no date bounds.

Services never import from ``api/``; this module lives beside the engines so
every resolver can share it without creating an import cycle.
"""

from tollms.core.exceptions import ValidationError

# Every preset token any surface has ever accepted.
CANONICAL = (
    "today",
    "yesterday",
    "24h",
    "7d",
    "last_7d",
    "30d",
    "last_30d",
    "90d",
    "last_90d",
    "this_month",
    "last_month",
    "custom",
)

_GATEWAY_NATIVES = ("24h", "7d", "30d", "90d", "custom")
_CHAT_NATIVES = (
    "today",
    "yesterday",
    "last_7d",
    "last_30d",
    "this_month",
    "last_month",
    "last_90d",
    "custom",
)
_KEYS_NATIVES = ("today", "last_7d", "last_30d", "last_90d", "this_month")

# Cross-family aliases: legacy token -> nearest native preset. Entries marked
# approx map a semantic the family cannot express exactly (e.g. a full prior
# calendar day onto a trailing-24h window).
_GATEWAY_ALIASES = {
    "today": "24h",  # approx: calendar-day remainder vs trailing 24h
    "yesterday": "24h",  # approx: prior calendar day vs trailing 24h
    "last_7d": "7d",
    "last_30d": "30d",
    "last_90d": "90d",
    "this_month": "30d",  # approx: calendar month vs trailing 30d
    "last_month": "30d",  # approx: prior calendar month vs trailing 30d
}
_CHAT_ALIASES = {
    "24h": "today",  # approx: trailing 24h vs calendar-day remainder
    "7d": "last_7d",
    "30d": "last_30d",
    "90d": "last_90d",
}
_KEYS_ALIASES = {
    "24h": "today",  # approx: trailing 24h vs calendar-day remainder
    "yesterday": "today",  # approx: prior calendar day vs calendar today
    "7d": "last_7d",
    "30d": "last_30d",
    "90d": "last_90d",
    "this_month": "this_month",
    "last_month": "last_30d",  # approx: prior calendar month vs trailing 30d
}

_FAMILIES: dict[str, dict[str, object]] = {
    "gateway": {"natives": _GATEWAY_NATIVES, "aliases": _GATEWAY_ALIASES, "default": "7d"},
    "chat": {"natives": _CHAT_NATIVES, "aliases": _CHAT_ALIASES, "default": "this_month"},
    "keys": {"natives": _KEYS_NATIVES, "aliases": _KEYS_ALIASES, "default": None},
    "gateway_keys": {"natives": _KEYS_NATIVES, "aliases": _KEYS_ALIASES, "default": "this_month"},
}


def normalize(raw: str, *, family: str) -> str:
    """Map any legacy preset token to ``family``'s native preset.

    Unknown tokens resolve to the family's existing default; the ``keys``
    family has no default and raises :class:`ValidationError` instead.
    """
    config = _FAMILIES[family]
    natives = config["natives"]
    assert isinstance(natives, tuple)
    if raw in natives:
        return raw
    aliases = config["aliases"]
    assert isinstance(aliases, dict)
    mapped = aliases.get(raw)
    if isinstance(mapped, str):
        return mapped
    default = config["default"]
    if isinstance(default, str):
        return default
    known = ", ".join(_KEYS_NATIVES)
    raise ValidationError(f"unknown analytics preset: {raw!r}; expected one of {known}")
