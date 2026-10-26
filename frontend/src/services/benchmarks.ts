/**
 * Benchmark runs API client (`/api/v1/benchmarks/runs`).
 *
 * Runs are recorded by tooling (no UI create form): this client is
 * read-only. Org scoping rides `?org_id=`; personal scope omits it.
 * Every run passes through a normalizer: the backend may send the
 * canonical `{items, nextCursor}` envelope or legacy variance
 * (bare-array bodies, `next_cursor`); the UI only ever sees the
 * canonical shape. Never throws on unknown shapes — unknown yields an
 * empty page. No prompt bodies ever travel these payloads.
 */

import { ApiError, apiRequest } from "@/services/api";

export const BENCHMARKS_BASE = "/api/v1/benchmarks";

export interface BenchmarkRun {
  id: string;
  name: string;
  traffic_path: string | null;
  provider_label: string | null;
  model_label: string | null;
  logging_mode: string | null;
  cache_state: string | null;
  conditions: Record<string, unknown>;
  n: number | null;
  errors: number | null;
  mean_ms: number | null;
  p50_ms: number | null;
  p95_ms: number | null;
  p99_ms: number | null;
  ttft_mean_ms: number | null;
  ttft_p50_ms: number | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  cache_read: number | null;
  cache_write: number | null;
  total_cost: string | null;
  notes: string | null;
  created_at: string;
}

export interface BenchmarkRunsPage {
  items: BenchmarkRun[];
  nextCursor: string | null;
}

export interface BenchmarkRunFilters {
  org_id?: string | null;
  limit?: number;
  cursor?: string;
}

function asString(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

/** Normalize one run: canonical fields win, legacy variance fills gaps. Never throws. */
export function normalizeBenchmarkRun(raw: unknown): BenchmarkRun | null {
  const r = asRecord(raw);
  const id = asString(r.id);
  if (!id) return null;
  const promptTokens = asNumber(r.prompt_tokens);
  const completionTokens = asNumber(r.completion_tokens);
  return {
    id,
    name: asString(r.name) ?? id.slice(0, 8),
    traffic_path: asString(r.traffic_path),
    provider_label: asString(r.provider_label) ?? asString(r.provider),
    model_label: asString(r.model_label) ?? asString(r.model),
    logging_mode: asString(r.logging_mode),
    cache_state: asString(r.cache_state),
    conditions: asRecord(r.conditions),
    n: asNumber(r.n) ?? asNumber(r.requests) ?? asNumber(r.samples),
    errors: asNumber(r.errors) ?? asNumber(r.error_count),
    mean_ms: asNumber(r.mean_ms) ?? asNumber(r.mean) ?? asNumber(r.avg_latency_ms),
    p50_ms: asNumber(r.p50_ms) ?? asNumber(r.p50),
    p95_ms: asNumber(r.p95_ms) ?? asNumber(r.p95),
    p99_ms: asNumber(r.p99_ms) ?? asNumber(r.p99),
    ttft_mean_ms: asNumber(r.ttft_mean_ms) ?? asNumber(r.avg_ttfb_ms),
    ttft_p50_ms: asNumber(r.ttft_p50_ms),
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    cache_read: asNumber(r.cache_read),
    cache_write: asNumber(r.cache_write),
    total_cost: asString(r.total_cost) ?? (typeof r.cost === "number" || typeof r.cost === "string" ? String(r.cost) : null),
    notes: asString(r.notes),
    created_at: asString(r.created_at) ?? "",
  };
}

function qs(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === "") continue;
    search.set(k, String(v));
  }
  const s = search.toString();
  return s ? `?${s}` : "";
}

/** Cursor-paginated runs. Unknown shapes yield an empty page, never a crash. */
export async function listBenchmarkRuns(filters: BenchmarkRunFilters = {}): Promise<BenchmarkRunsPage> {
  const raw = await apiRequest<unknown>(
    `${BENCHMARKS_BASE}/runs${qs({ org_id: filters.org_id ?? undefined, limit: filters.limit, cursor: filters.cursor })}`,
  );
  if (Array.isArray(raw)) {
    return { items: raw.map(normalizeBenchmarkRun).filter((r): r is BenchmarkRun => r !== null), nextCursor: null };
  }
  const envelope = asRecord(raw);
  const itemsRaw = Array.isArray(envelope.items) ? envelope.items : [];
  return {
    items: (itemsRaw as unknown[]).map(normalizeBenchmarkRun).filter((r): r is BenchmarkRun => r !== null),
    nextCursor: asString(envelope.nextCursor) ?? asString(envelope.next_cursor) ?? null,
  };
}

/** No-retry oracle: 404 means benchmarks aren't available for this scope. */
export function isBenchmarkStatus(error: unknown, status: number): boolean {
  return error instanceof ApiError && error.status === status;
}
