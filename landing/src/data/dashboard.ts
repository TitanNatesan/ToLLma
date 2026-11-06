// ============================================================
// R5 dashboard dataset — ONE seeded module feeding the three hero
// windows (Overview, Providers, API Keys). Every KPI/table/bar is a
// pure sum over REQUEST_LOGS (+ fixed per-key budgets), so Overview
// totals reconcile with the log + analytics detail by construction.
// All figures are SAMPLE data for illustration — never real usage.
// Truth anchors (imported, never redeclared): provider API surfaces
// + streaming/tool flags from site.ts PROVIDERS; the 10 guardrail
// categories from site.ts GUARDRAIL_CATEGORIES.
// ============================================================

import { GUARDRAIL_CATEGORIES, PROVIDERS } from "../lib/site";

export type ProviderId =
  | "openai"
  | "anthropic"
  | "gemini"
  | "vertex"
  | "bedrock"
  | "custom";

export type PageId =
  | "Overview"
  | "Providers"
  | "API Keys"
  | "Guardrails"
  | "Request Logs"
  | "Analytics";

/** Window order (top → bottom of the stack): three windows only. */
export const PAGES: PageId[] = [
  "Overview",
  "Providers",
  "API Keys",
];

export type LogStatus =
  | "Allowed"
  | "Warned"
  | "Blocked"
  | "Pending"
  | "Throttled"
  | "401"
  | "403";

/** One request-log row. costUsd is the billed amount for the row. */
export interface RequestLog {
  id: string;
  /** HH:MM:SS wall time (sample day). */
  time: string;
  /** Hour bucket 0–23 (throughput + daily-cost derivation). */
  hour: number;
  keyId: string;
  model: string;
  provider: ProviderId;
  status: LogStatus;
  /** Milliseconds; 0 when no upstream call was made. */
  latencyMs: number;
  tokens: number;
  costUsd: number;
  /** Guardrail category that fired (Warned/Blocked rows only). */
  category?: string;
  /** Seconds, Throttled rows only (429 + Retry-After). */
  retryAfterS?: number;
}

/* Seeded sample rows (28). Distribution: openai 8, anthropic 6,
   gemini 4, bedrock 4, vertex 3, custom 3. Statuses: Allowed 19,
   Warned 2, Blocked 3, Pending 1, Throttled 1, 401 1, 403 1. */
export const REQUEST_LOGS: RequestLog[] = [
  { id: "r001", time: "00:12:44", hour: 0, keyId: "checkout-api", model: "gpt-4o", provider: "openai", status: "Allowed", latencyMs: 412, tokens: 1840, costUsd: 0.0112 },
  { id: "r002", time: "01:22:10", hour: 1, keyId: "checkout-api", model: "claude-sonnet-4", provider: "anthropic", status: "Allowed", latencyMs: 689, tokens: 3120, costUsd: 0.0187 },
  { id: "r003", time: "02:03:19", hour: 2, keyId: "support-bot", model: "gpt-4o-mini", provider: "openai", status: "Allowed", latencyMs: 268, tokens: 640, costUsd: 0.0004 },
  { id: "r004", time: "03:33:48", hour: 3, keyId: "checkout-api", model: "gemini-2.0-flash", provider: "gemini", status: "Allowed", latencyMs: 522, tokens: 1730, costUsd: 0.0013 },
  { id: "r005", time: "04:47:02", hour: 4, keyId: "checkout-api", model: "gpt-4o", provider: "openai", status: "Warned", latencyMs: 531, tokens: 2310, costUsd: 0.0141, category: "pii" },
  { id: "r006", time: "05:19:37", hour: 5, keyId: "support-bot", model: "claude-sonnet-4", provider: "anthropic", status: "Warned", latencyMs: 812, tokens: 2940, costUsd: 0.0176, category: "untrusted_instruction" },
  { id: "r007", time: "06:27:39", hour: 6, keyId: "checkout-api", model: "claude-3-5-sonnet", provider: "bedrock", status: "Allowed", latencyMs: 923, tokens: 2760, costUsd: 0.0166 },
  { id: "r008", time: "07:15:53", hour: 7, keyId: "support-bot", model: "gpt-4o", provider: "openai", status: "Allowed", latencyMs: 388, tokens: 1975, costUsd: 0.012 },
  { id: "r009", time: "07:58:41", hour: 7, keyId: "support-bot", model: "gemini-1.5-pro", provider: "vertex", status: "Allowed", latencyMs: 764, tokens: 2210, costUsd: 0.0088 },
  { id: "r010", time: "08:02:31", hour: 8, keyId: "checkout-api", model: "gpt-4o-mini", provider: "openai", status: "Allowed", latencyMs: 244, tokens: 512, costUsd: 0.0003 },
  { id: "r011", time: "08:44:55", hour: 8, keyId: "checkout-api", model: "claude-sonnet-4", provider: "anthropic", status: "Allowed", latencyMs: 654, tokens: 2870, costUsd: 0.0172 },
  { id: "r012", time: "09:05:26", hour: 9, keyId: "support-bot", model: "gemini-2.0-flash", provider: "gemini", status: "Allowed", latencyMs: 498, tokens: 1890, costUsd: 0.0014 },
  { id: "r013", time: "09:41:07", hour: 9, keyId: "checkout-api", model: "gpt-4o", provider: "openai", status: "Blocked", latencyMs: 196, tokens: 320, costUsd: 0.0008, category: "prompt_injection" },
  { id: "r014", time: "10:11:03", hour: 10, keyId: "research-notebook", model: "claude-sonnet-4", provider: "anthropic", status: "Blocked", latencyMs: 388, tokens: 410, costUsd: 0.0012, category: "harmful_content" },
  { id: "r015", time: "10:47:33", hour: 10, keyId: "research-notebook", model: "llama-3.3-70b", provider: "custom", status: "Allowed", latencyMs: 1180, tokens: 1980, costUsd: 0.0016 },
  { id: "r016", time: "11:26:50", hour: 11, keyId: "research-notebook", model: "gpt-4o-mini", provider: "openai", status: "Pending", latencyMs: 0, tokens: 0, costUsd: 0 },
  { id: "r017", time: "11:59:04", hour: 11, keyId: "support-bot", model: "claude-3-5-sonnet", provider: "bedrock", status: "Allowed", latencyMs: 871, tokens: 2480, costUsd: 0.0149 },
  { id: "r018", time: "12:48:11", hour: 12, keyId: "checkout-api", model: "gemini-2.0-flash", provider: "gemini", status: "Throttled", latencyMs: 45, tokens: 0, costUsd: 0, retryAfterS: 12 },
  { id: "r019", time: "13:12:09", hour: 13, keyId: "checkout-api", model: "gemini-1.5-pro", provider: "vertex", status: "Allowed", latencyMs: 742, tokens: 2340, costUsd: 0.0094 },
  { id: "r020", time: "13:58:22", hour: 13, keyId: "support-bot", model: "gpt-4o", provider: "openai", status: "Allowed", latencyMs: 402, tokens: 2104, costUsd: 0.0128 },
  { id: "r021", time: "14:37:29", hour: 14, keyId: "checkout-api", model: "claude-sonnet-4", provider: "anthropic", status: "Allowed", latencyMs: 701, tokens: 3340, costUsd: 0.02 },
  { id: "r022", time: "15:44:36", hour: 15, keyId: "checkout-api", model: "claude-3-5-sonnet", provider: "bedrock", status: "Blocked", latencyMs: 342, tokens: 380, costUsd: 0.0011, category: "secret_leakage" },
  { id: "r023", time: "16:05:12", hour: 16, keyId: "unknown", model: "claude-sonnet-4", provider: "anthropic", status: "401", latencyMs: 12, tokens: 0, costUsd: 0 },
  { id: "r024", time: "17:29:05", hour: 17, keyId: "support-bot", model: "llama-3.3-70b", provider: "custom", status: "Allowed", latencyMs: 1245, tokens: 2140, costUsd: 0.0017 },
  { id: "r025", time: "18:20:57", hour: 18, keyId: "research-notebook", model: "gemini-2.0-flash", provider: "gemini", status: "Allowed", latencyMs: 511, tokens: 1620, costUsd: 0.0012 },
  { id: "r026", time: "19:52:18", hour: 19, keyId: "checkout-api", model: "claude-3-5-sonnet", provider: "bedrock", status: "Allowed", latencyMs: 905, tokens: 2910, costUsd: 0.0175 },
  { id: "r027", time: "20:36:44", hour: 20, keyId: "research-notebook", model: "gemini-1.5-pro", provider: "vertex", status: "403", latencyMs: 18, tokens: 0, costUsd: 0 },
  { id: "r028", time: "22:14:58", hour: 22, keyId: "checkout-api", model: "llama-3.3-70b", provider: "custom", status: "Allowed", latencyMs: 1108, tokens: 1870, costUsd: 0.0015 },
];

/* ---------- provider display order + API surfaces (R5 spec order:
   OpenAI, Anthropic, Gemini, Bedrock, Vertex, Custom). Surfaces and
   streaming/tool flags trace to site.ts PROVIDERS. ---------- */
export interface ProviderRow {
  id: ProviderId;
  name: string;
  api: string;
  note: string;
}

const META = new Map(PROVIDERS.map((p) => [p.id as string, p]));

function meta(id: ProviderId) {
  const m = META.get(id);
  if (!m) throw new Error(`unknown provider ${id}`);
  return m;
}

export const PROVIDER_ROWS: ProviderRow[] = (
  ["openai", "anthropic", "gemini", "bedrock", "vertex", "custom"] as ProviderId[]
).map((id) => {
  const m = meta(id);
  return {
    id,
    name: m.name,
    api: id === "openai" ? "Chat Completions + Responses" : m.api,
    note:
      id === "gemini"
        ? "generateContent · streaming-only, no tools"
        : id === "custom"
          ? "Chat Completions · OpenAI-compatible"
          : `${m.api} · ${m.streaming ? "streaming" : "no stream"}${m.tools ? " · tools" : ""}`,
  };
});

/* ---------- API keys ---------- */
export interface ApiKey {
  id: string;
  masked: string;
  scope: "global" | "per-key";
  budgetLimit: number;
  lastUsed: string;
  status: "active" | "revoked";
}

export const API_KEYS: ApiKey[] = [
  { id: "checkout-api", masked: "tlm_live_••••3a9c", scope: "global", budgetLimit: 0.5, lastUsed: "22:14:58", status: "active" },
  { id: "support-bot", masked: "tlm_live_••••7f2e", scope: "per-key", budgetLimit: 0.25, lastUsed: "17:29:05", status: "active" },
  { id: "research-notebook", masked: "tlm_live_••••b811", scope: "per-key", budgetLimit: 0.05, lastUsed: "20:36:44", status: "revoked" },
];

/* ---------- guardrails: modes + scopes per category ---------- */
export const GUARDRAIL_MODES: Record<string, "monitor" | "warn" | "block"> = {
  harmful_content: "block",
  prompt_injection: "block",
  secret_leakage: "warn",
  pii: "warn",
  unsafe_output: "monitor",
  data_disclosure: "monitor",
  untrusted_instruction: "warn",
  invalid_structure: "monitor",
  domain_violation: "monitor",
  tool_action: "block",
};

export const GUARDRAIL_SCOPES: Record<string, "global" | "provider" | "key"> = {
  harmful_content: "global",
  prompt_injection: "global",
  secret_leakage: "key",
  pii: "key",
  unsafe_output: "provider",
  data_disclosure: "global",
  untrusted_instruction: "provider",
  invalid_structure: "global",
  domain_violation: "provider",
  tool_action: "key",
};

/* ---------- derivations (single source: REQUEST_LOGS) ---------- */

/** Denials counted as errors: policy blocks + rate-limit + auth. */
export function isError(l: RequestLog): boolean {
  return l.status === "Blocked" || l.status === "Throttled" || l.status === "401" || l.status === "403";
}

export const KPIS = (() => {
  const total = REQUEST_LOGS.length;
  const allowed = REQUEST_LOGS.filter((l) => l.status === "Allowed").length;
  const blocked = REQUEST_LOGS.filter((l) => l.status === "Blocked").length;
  const spend = REQUEST_LOGS.reduce((s, l) => s + l.costUsd, 0);
  return {
    requestsToday: total,
    allowed,
    allowedRate: total === 0 ? 0 : allowed / total,
    blockedCount: blocked,
    spendToday: spend,
  };
})();

export interface ProviderStats {
  req24h: number;
  p50Ms: number;
  errorRate: number;
  status: "Operational" | "Degraded";
}

export function providerStats(id: ProviderId): ProviderStats {
  const rows = REQUEST_LOGS.filter((l) => l.provider === id);
  const lat = rows.map((l) => l.latencyMs).sort((a, b) => a - b);
  const mid = Math.floor(lat.length / 2);
  const p50 = lat.length === 0 ? 0 : lat.length % 2 === 1 ? lat[mid] : Math.round((lat[mid - 1] + lat[mid]) / 2);
  const errors = rows.filter(isError).length;
  const rate = rows.length === 0 ? 0 : errors / rows.length;
  return { req24h: rows.length, p50Ms: p50, errorRate: rate, status: rate > 0.05 ? "Degraded" : "Operational" };
}

export interface KeyUsage {
  used: number;
  limit: number;
  lastUsed: string;
}

export function keyUsage(id: string): KeyUsage {
  const key = API_KEYS.find((k) => k.id === id);
  if (!key) throw new Error(`unknown key ${id}`);
  const rows = REQUEST_LOGS.filter((l) => l.keyId === id && l.costUsd > 0);
  const used = rows.reduce((s, l) => s + l.costUsd, 0);
  const times = REQUEST_LOGS.filter((l) => l.keyId === id).map((l) => l.time);
  const lastUsed = times.length === 0 ? "—" : times.sort().at(-1) as string;
  return { used, limit: key.budgetLimit, lastUsed };
}

export interface GuardrailRow {
  category: string;
  mode: "monitor" | "warn" | "block";
  scope: "global" | "provider" | "key";
  hits24h: number;
}

export function guardrailRows(): GuardrailRow[] {
  return (GUARDRAIL_CATEGORIES as readonly string[]).map((c) => ({
    category: c,
    mode: GUARDRAIL_MODES[c],
    scope: GUARDRAIL_SCOPES[c],
    hits24h: REQUEST_LOGS.filter((l) => l.category === c).length,
  }));
}

/** Spend per provider (sums to KPIS.spendToday). */
export function spendByProvider(): { id: ProviderId; name: string; spend: number }[] {
  return PROVIDER_ROWS.map((p) => ({
    id: p.id,
    name: p.name,
    spend: REQUEST_LOGS.filter((l) => l.provider === p.id).reduce((s, l) => s + l.costUsd, 0),
  }));
}

/** Tokens per model, descending. */
export function tokensByModel(): { model: string; tokens: number }[] {
  const m = new Map<string, number>();
  for (const l of REQUEST_LOGS) m.set(l.model, (m.get(l.model) ?? 0) + l.tokens);
  return [...m.entries()]
    .map(([model, tokens]) => ({ model, tokens }))
    .sort((a, b) => b.tokens - a.tokens);
}

/** Cost per 4-hour bucket (00–04 … 20–24), sums to spendToday. */
export function dailyCost(): { label: string; cost: number }[] {
  const buckets = Array.from({ length: 6 }, (_, i) => ({
    label: `${String(i * 4).padStart(2, "0")}–${String(i * 4 + 4).padStart(2, "0")}`,
    cost: 0,
  }));
  for (const l of REQUEST_LOGS) buckets[Math.min(5, Math.floor(l.hour / 4))].cost += l.costUsd;
  return buckets;
}

/** Request counts per hour (24 buckets, throughput chart). */
export function throughputByHour(): number[] {
  const buckets = new Array<number>(24).fill(0);
  for (const l of REQUEST_LOGS) buckets[l.hour] += 1;
  return buckets;
}

/** Providers ordered by volume, descending. */
export function topProviders(): { id: ProviderId; name: string; req24h: number }[] {
  return PROVIDER_ROWS.map((p) => ({ id: p.id, name: p.name, req24h: providerStats(p.id).req24h })).sort(
    (a, b) => b.req24h - a.req24h,
  );
}

/** Latest Blocked rows first (time desc), up to n. */
export function recentBlocked(n = 4): RequestLog[] {
  return REQUEST_LOGS.filter((l) => l.status === "Blocked")
    .sort((a, b) => (a.time < b.time ? 1 : -1))
    .slice(0, n);
}
