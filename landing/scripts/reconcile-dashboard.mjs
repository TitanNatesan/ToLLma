// R5 reconcile: independently recomputes every Overview KPI, provider
// row, key budget, guardrail hit count, and analytics series straight
// from REQUEST_LOGS and asserts the dashboard.ts helpers agree.
// Usage: node scripts/reconcile-dashboard.mjs (exit 0 = all match).
import { mkdtempSync, copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tmp = mkdtempSync(join(tmpdir(), "r5-reconcile-"));
copyFileSync(join(root, "src/lib/site.ts"), join(tmp, "site.ts"));
const src = readFileSync(join(root, "src/data/dashboard.ts"), "utf8").replace(
  '"../lib/site"',
  '"./site.ts"',
);
writeFileSync(join(tmp, "dashboard.ts"), src);
const d = await import(join(tmp, "dashboard.ts"));

const fails = [];
const eq = (name, a, b, tol = 1e-9) => {
  const ok = typeof a === "number" ? Math.abs(a - b) <= tol : a === b;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}: got=${JSON.stringify(a)} want=${JSON.stringify(b)}`);
  if (!ok) fails.push(name);
};

const L = d.REQUEST_LOGS;
// Independent recomputation (no helper reuse except raw rows).
const sum = (f) => L.reduce((s, l) => s + f(l), 0);
eq("logs.count", L.length, d.KPIS.requestsToday);
eq("kpis.allowed", L.filter((l) => l.status === "Allowed").length, d.KPIS.allowed);
eq("kpis.allowedRate", L.filter((l) => l.status === "Allowed").length / L.length, d.KPIS.allowedRate);
eq("kpis.blocked", L.filter((l) => l.status === "Blocked").length, d.KPIS.blockedCount);
eq("kpis.spend", sum((l) => l.costUsd), d.KPIS.spendToday, 1e-12);
eq("pages.order", d.PAGES.join("|"), "Overview|Providers|API Keys|Guardrails|Request Logs|Analytics");
eq("providers.rows", d.PROVIDER_ROWS.map((p) => p.id).join("|"), "openai|anthropic|gemini|bedrock|vertex|custom");
for (const p of d.PROVIDER_ROWS) {
  const rows = L.filter((l) => l.provider === p.id);
  const s = d.providerStats(p.id);
  const lat = rows.map((l) => l.latencyMs).sort((x, y) => x - y);
  const mid = Math.floor(lat.length / 2);
  const p50 = lat.length % 2 === 1 ? lat[mid] : Math.round((lat[mid - 1] + lat[mid]) / 2);
  const err = rows.filter((l) => ["Blocked", "Throttled", "401", "403"].includes(l.status)).length / rows.length;
  eq(`provider.${p.id}.req24h`, rows.length, s.req24h);
  eq(`provider.${p.id}.p50`, p50, s.p50Ms);
  eq(`provider.${p.id}.errorRate`, err, s.errorRate);
}
for (const k of d.API_KEYS) {
  const u = d.keyUsage(k.id);
  eq(`key.${k.id}.used`, sum((l) => (l.keyId === k.id ? l.costUsd : 0)), u.used, 1e-12);
  eq(`key.${k.id}.limit`, k.budgetLimit, u.limit);
  if (!(u.used < u.limit)) { console.log(`FAIL key.${k.id}.budget: used>=limit`); fails.push(`key.${k.id}.budget`); }
  else console.log(`PASS key.${k.id}.budget: used<limit`);
}
for (const g of d.guardrailRows()) {
  eq(`guardrail.${g.category}.hits`, L.filter((l) => l.category === g.category).length, g.hits24h);
}
eq("guardrails.count10", d.guardrailRows().length, 10);
eq("analytics.spend", d.spendByProvider().reduce((s, r) => s + r.spend, 0), d.KPIS.spendToday, 1e-12);
eq("analytics.daily", d.dailyCost().reduce((s, r) => s + r.cost, 0), d.KPIS.spendToday, 1e-12);
eq("analytics.tokens.total", d.tokensByModel().reduce((s, r) => s + r.tokens, 0), sum((l) => l.tokens));
eq("analytics.throughput", d.throughputByHour().reduce((s, n) => s + n, 0), L.length);
eq("overview.topProviders", d.topProviders().reduce((s, r) => s + r.req24h, 0), L.length);
eq("statuses.covered", [...new Set(L.map((l) => l.status))].sort().join("|"), "401|403|Allowed|Blocked|Pending|Throttled|Warned");
if (fails.length) { console.error(`\nRECONCILE FAILED: ${fails.join(", ")}`); process.exit(1); }
console.log("\nRECONCILE OK: all totals match REQUEST_LOGS.");
