"""In-process activity counters for live health metrics.

Cheap, lock-guarded counters owned by the API process. The admin health
stream reads them; nothing else does. Never raises.
"""

import threading

_lock = threading.Lock()
_active_requests = 0


def request_started() -> None:
    global _active_requests
    with _lock:
        _active_requests += 1


def request_finished() -> None:
    global _active_requests
    with _lock:
        _active_requests = max(0, _active_requests - 1)


def active_requests() -> int:
    with _lock:
        return _active_requests
