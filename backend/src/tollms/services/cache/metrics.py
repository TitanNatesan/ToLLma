"""In-memory cache operation counters. Client-side evictions are not
observable, so evictions count pattern invalidations + deletes."""

import threading
from typing import Any


class CacheMetrics:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.reset()

    def reset(self) -> None:
        with self._lock:
            self.hits = 0
            self.misses = 0
            self.writes = 0
            self.invalidations = 0
            self.errors = 0
            self.latency_ms_total = 0.0
            self.latency_ms_count = 0

    def record_hit(self) -> None:
        with self._lock:
            self.hits += 1

    def record_miss(self) -> None:
        with self._lock:
            self.misses += 1

    def record_write(self) -> None:
        with self._lock:
            self.writes += 1

    def record_invalidation(self, count: int = 1) -> None:
        with self._lock:
            self.invalidations += count

    def record_error(self) -> None:
        with self._lock:
            self.errors += 1

    def observe_latency(self, latency_ms: float) -> None:
        with self._lock:
            self.latency_ms_total += latency_ms
            self.latency_ms_count += 1

    @property
    def hit_ratio(self) -> float:
        total = self.hits + self.misses
        return round(self.hits / total, 4) if total else 0.0

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            avg = self.latency_ms_total / self.latency_ms_count if self.latency_ms_count else 0.0
            total = self.hits + self.misses
            return {
                "hits": self.hits,
                "misses": self.misses,
                "writes": self.writes,
                "invalidations": self.invalidations,
                "errors": self.errors,
                "hit_rate": round(self.hits / total, 4) if total else 0.0,
                "avg_latency_ms": round(avg, 3),
            }


metrics = CacheMetrics()
