"use client";

/**
 * Live platform health stream (`GET /api/admin/health/stream`, SSE).
 *
 * Owns its own state: no react-query cache entry is touched and no page-level
 * refetch is triggered — `HealthSection` is the only consumer.
 *
 * Connection lifecycle:
 * - `EventSource` with `withCredentials: true` (cross-origin session cookie),
 *   against the same resolved API base as `@/services/admin` (whose helper is
 *   module-private and out of scope for this change, so the pattern lives here
 *   again).
 * - Every parsed event appends a sample; the rolling window is capped at
 *   `MAX_SAMPLES` (60 ≈ 2 minutes at the 2s cadence), oldest dropped first.
 * - On error the native stream is closed (the browser would otherwise retry on
 *   its own schedule) and reconnection is scheduled with `1s → 2s → 5s → 10s`
 *   backoff, staying at 10s. A successfully parsed event resets the backoff.
 * - HTTP 403 (account is not a platform admin) is terminal: status
 *   `disconnected` with a clear error and no reconnect loop. `EventSource`
 *   does not expose the HTTP status, so a single fetch probe reads it; the
 *   page renders its own forbidden state.
 * - Unmount closes the stream, aborts any in-flight probe and clears timers.
 */

import { useEffect, useState } from "react";
import type { LiveHealthSample, LiveHealthStreamStatus } from "@/types/admin";

const STREAM_PATH = "/api/admin/health/stream";
const MAX_SAMPLES = 60;
const RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000] as const;
const FORBIDDEN_MESSAGE = "Live health stream requires platform admin access (403).";

// Mirrors `apiBase()` in `@/services/admin`: browser clients resolve the
// host-mapped backend port, SSR/build-time evaluation falls back to env.
function apiBase(): string {
  if (typeof window !== "undefined") {
    if (window.location.hostname && window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1") {
      return `${window.location.protocol}//${window.location.hostname}:8000`;
    }
  }
  return process.env.BACKEND_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
}

function reconnectDelay(attempt: number): number {
  return RECONNECT_DELAYS_MS[Math.min(attempt, RECONNECT_DELAYS_MS.length - 1)];
}

export interface AdminHealthStream {
  samples: LiveHealthSample[];
  latest: LiveHealthSample | null;
  status: LiveHealthStreamStatus;
  error: string | null;
}

/** Streams live platform health samples for the admin health tab. */
export function useAdminHealthStream(): AdminHealthStream {
  const [samples, setSamples] = useState<LiveHealthSample[]>([]);
  const [status, setStatus] = useState<LiveHealthStreamStatus>("connecting");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let stopped = false;
    let attempt = 0;
    let timer: number | null = null;
    let source: EventSource | null = null;
    let probe: AbortController | null = null;

    function clearTimer() {
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
    }

    function abortProbe() {
      probe?.abort();
      probe = null;
    }

    function stop(message: string) {
      if (cancelled || stopped) return;
      stopped = true;
      clearTimer();
      abortProbe();
      source?.close();
      source = null;
      setStatus("disconnected");
      setError(message);
    }

    function scheduleReconnect() {
      if (cancelled || stopped) return;
      const delay = reconnectDelay(attempt);
      attempt += 1;
      clearTimer();
      timer = window.setTimeout(() => {
        timer = null;
        connect();
      }, delay);
    }

    /** EventSource hides the HTTP status; probe it once to detect a 403. */
    async function probeForbidden() {
      if (cancelled || stopped) return;
      abortProbe();
      const controller = new AbortController();
      probe = controller;
      try {
        const response = await fetch(`${apiBase()}${STREAM_PATH}`, {
          headers: { Accept: "text/event-stream" },
          credentials: "include",
          cache: "no-store",
          signal: controller.signal,
        });
        const statusCode = response.status;
        controller.abort(); // headers are enough; do not hold the event stream open
        if (statusCode === 403) stop(FORBIDDEN_MESSAGE);
      } catch {
        // Network-level failure: the already-scheduled backoff retry owns recovery.
      } finally {
        if (probe === controller) probe = null;
      }
    }

    function handleMessage(event: MessageEvent<string>) {
      if (cancelled || stopped) return;
      let sample: LiveHealthSample;
      try {
        sample = JSON.parse(event.data) as LiveHealthSample;
      } catch {
        console.warn("[admin-health] Ignoring malformed SSE payload", event.data);
        return;
      }
      attempt = 0; // a successful event resets the backoff to 1s
      clearTimer();
      setStatus("live");
      setError(null);
      setSamples((prev) => {
        const next = [...prev, sample];
        return next.length > MAX_SAMPLES ? next.slice(next.length - MAX_SAMPLES) : next;
      });
    }

    function handleError() {
      if (cancelled || stopped) return;
      source?.close();
      source = null;
      setStatus("reconnecting");
      scheduleReconnect();
      void probeForbidden();
    }

    function connect() {
      if (cancelled || stopped) return;
      source?.close();
      const next = new EventSource(`${apiBase()}${STREAM_PATH}`, { withCredentials: true });
      source = next;
      next.onopen = () => {
        if (cancelled || stopped || source !== next) return;
        setStatus("live");
        setError(null);
      };
      next.onmessage = (event: MessageEvent<string>) => {
        if (source !== next) return;
        handleMessage(event);
      };
      next.onerror = () => {
        if (source !== next) return;
        handleError();
      };
    }

    if (typeof EventSource === "undefined") {
      // Deferred so the effect body itself never calls setState synchronously.
      timer = window.setTimeout(() => {
        if (!cancelled) {
          setStatus("disconnected");
          setError("Live health stream is not supported by this browser.");
        }
      }, 0);
    } else {
      connect();
    }

    return () => {
      cancelled = true;
      clearTimer();
      abortProbe();
      source?.close();
      source = null;
    };
  }, []);

  return {
    samples,
    latest: samples.length > 0 ? samples[samples.length - 1] : null,
    status,
    error,
  };
}
