"""Core cache infrastructure over Valkey. PostgreSQL stays the source of
truth; this package is the performance layer (read cache, metadata cache,
distributed locks, metrics). All operations degrade to a bypass when
Valkey is unreachable or disabled."""

from tollms.services.cache import constants, keys
from tollms.services.cache.client import connect, disconnect, get_client, ping, server_info
from tollms.services.cache.decorators import cached, cache_invalidate, cache_refresh
from tollms.services.cache.locks import acquire, locked, locked_sync, release
from tollms.services.cache.manager import CacheManager, get_manager
from tollms.services.cache.metrics import metrics

get_cache = get_manager

__all__ = [
    "CacheManager",
    "acquire",
    "cached",
    "cache_invalidate",
    "cache_refresh",
    "connect",
    "constants",
    "disconnect",
    "get_cache",
    "get_client",
    "get_manager",
    "keys",
    "locked",
    "locked_sync",
    "metrics",
    "ping",
    "release",
    "server_info",
]
