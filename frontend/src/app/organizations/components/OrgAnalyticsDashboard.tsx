"use client";

import { useMemo, useState } from "react";
import { BarChart3 } from "lucide-react";
import {
  Badge, Card, CardContent, EmptyState, ErrorState, LoadingState, SearchInput, Select,
} from "@/components/ui";
import { AreaChart, BarList, DonutChart } from "@/components/charts";
import { OrgBudgetCard } from "./OrgBudgetCard";
import { isForbiddenError, isNotFoundError, useOrgAnalyticsOverview, useOrgBudget } from "@/hooks/useOrgs";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { parseApiError } from "@/lib/errors";
import type { OrgAnalyticsOverview, OrgAnalyticsPoint, OrgAnalyticsRow } from "@/types/orgs";

function num(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function money(v: number | string | null | undefined): string {
  const n = num(v);
  if (n === null) return "—";
  if (n !== 0 && Math.abs(n) < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

function compact(n: number | null): string {
  if (n === null) return "—";
  return n.toLocaleString();
}

type Ext = OrgAnalyticsOverview & {
  totals?: { requests?: number | string | null; tokens?: number | string | null; cost?: number | string | null } | null;
  cache_hits?: number | string | null;
  cache_requests?: number | string | null;
  successful_requests?: number | string | null;
  failed_requests?: number | string | null;
  error_count?: number | string | null;
};

function totalRequests(o: Ext): number | null {
  return num(o.totals?.requests ?? o.requests ?? o.total_requests);
}

function totalTokens(o: Ext): number | null {
  return num(o.totals?.tokens ?? o.tokens ?? o.total_tokens);
}

function totalCost(o: Ext): number | null {
  return num(o.totals?.cost ?? o.cost ?? o.total_cost ?? o.spend);
}

function byModel(o: OrgAnalyticsOverview): OrgAnalyticsRow[] {
  return o.by_model ?? o.models ?? [];
}

function byProvider(o: OrgAnalyticsOverview): OrgAnalyticsRow[] {
  return o.by_provider ?? o.providers ?? [];
}

function byUser(o: OrgAnalyticsOverview): OrgAnalyticsRow[] {
  return o.by_user ?? o.users ?? o.by_member ?? o.members ?? [];
}

function byKey(o: OrgAnalyticsOverview): OrgAnalyticsRow[] {
  return o.by_key ?? o.keys ?? [];
}

/* NOTE: by_team is deliberately never read — per-team attribution is
 * unreliable, so no per-team splits are rendered anywhere here. */

function rowName(r: OrgAnalyticsRow): string {
  const v = r.name ?? r.label ?? r.model ?? r.provider ?? r.email ?? r.user_email ?? r.key ?? r.id;
  return typeof v === "string" && v ? v : "—";
}

function rowRequests(r: OrgAnalyticsRow): number {
  return num(r.requests ?? r.total_requests) ?? 0;
}

function rowCost(r: OrgAnalyticsRow): number {
  return num(r.cost ?? r.total_cost ?? r.spend) ?? 0;
}

function rowTokens(r: OrgAnalyticsRow): number {
  return num(r.tokens ?? r.total_tokens) ?? 0;
}

function timeline(o: OrgAnalyticsOverview): OrgAnalyticsPoint[] {
  return o.timeline ?? o.timeseries ?? o.daily ?? o.series ?? [];
}

function pointLabel(p: OrgAnalyticsPoint, i: number): string {
  const raw = p.t ?? p.timestamp ?? p.date ?? p.label;
  if (typeof raw === "string" && raw) {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    return raw;
  }
  return `#${i + 1}`;
}

type Preset = "24h" | "7d" | "30d" | "90d";

const PRESETS: Array<{ id: Preset; label: string; days: number }> = [
  { id: "24h", label: "Last 24 hours", days: 1 },
  { id: "7d", label: "Last 7 days", days: 7 },
  { id: "30d", label: "Last 30 days", days: 30 },
  { id: "90d", label: "Last 90 days", days: 90 },
];

function rangeFor(preset: Preset): { from: string; to: string; label: string } {
  const def = PRESETS.find((p) => p.id === preset)!;
  const to = new Date();
  const from = new Date(to.getTime() - def.days * 86_400_000);
  return { from: from.toISOString(), to: to.toISOString(), label: def.label };
}

function Stat({ label, value, rangeLabel, testId }: { label: string; value: string; rangeLabel: string; testId?: string }) {
  return (
    <Card data-testid={testId}>
      <CardContent className="p-3.5">
        <p className="text-[11px] uppercase tracking-wide text-zinc-500">{label}</p>
        <p className="text-2xl font-bold">{value}</p>
        <p className="mt-0.5 text-[10px] text-zinc-400">{rangeLabel}</p>
      </CardContent>
    </Card>
  );
}

export function OrgAnalyticsDashboard({ orgId, canView, canSeeCost, canReadBudget, canEditBudget }: {
  orgId: string;
  canView: boolean;
  canSeeCost: boolean;
  canReadBudget: boolean;
  canEditBudget: boolean;
}) {
  const [preset, setPreset] = useState<Preset>("30d");
  const [keyId, setKeyId] = useState("");
  const [narrow, setNarrow] = useState("");
  const range = useMemo(() => rangeFor(preset), [preset]);
  const debouncedNarrow = useDebouncedValue(narrow.trim().toLowerCase(), 300);

  // Single analytics query — every KPI, chart, and insight derives from this response.
  const overview = useOrgAnalyticsOverview(orgId, {
    enabled: canView,
    params: { from: range.from, to: range.to, key_id: keyId || undefined },
  });
  const budget = useOrgBudget(orgId, { enabled: canReadBudget });

  const keys = useMemo(() => (overview.data ? byKey(overview.data) : []), [overview.data]);

  if (!canView) {
    return <EmptyState title="Analytics" description="You need usage-analytics permission to view organization analytics." />;
  }

  if (overview.isLoading) return <LoadingState message="Loading analytics…" />;
  if (overview.isError && isForbiddenError(overview.error)) {
    return (
      <EmptyState icon={BarChart3} title="Analytics unavailable" testId="org-analytics-forbidden"
        description="You need Analytics.ViewUsage permission to view organization analytics." />
    );
  }
  if (overview.isError && isNotFoundError(overview.error)) {
    return (
      <ErrorState title="Analytics not found"
        message={overview.error ? parseApiError(overview.error).message : "No data."}
        onRetry={() => void overview.refetch()} />
    );
  }
  if (overview.isError || !overview.data) {
    return (
      <ErrorState title="Could not load analytics"
        message={overview.error ? parseApiError(overview.error).message : "No data."}
        onRetry={() => void overview.refetch()} />
    );
  }

  return (
    <AnalyticsBody
      data={overview.data} orgId={orgId} rangeLabel={range.label} canSeeCost={canSeeCost}
      canReadBudget={canReadBudget} canEditBudget={canEditBudget}
      budgetCap={budget.data ? num(budget.data.max_spend ?? budget.data.max_budget_usd ?? budget.data.cap) : null}
      preset={preset} onPreset={setPreset} keyId={keyId} onKeyId={setKeyId} keys={keys}
      narrow={narrow} onNarrow={setNarrow} debouncedNarrow={debouncedNarrow} />
  );
}

function AnalyticsBody({ data, orgId, rangeLabel, canSeeCost, canReadBudget, canEditBudget, budgetCap, preset, onPreset, keyId, onKeyId, keys, narrow, onNarrow, debouncedNarrow }: {
  data: OrgAnalyticsOverview;
  orgId: string;
  rangeLabel: string;
  canSeeCost: boolean;
  canReadBudget: boolean;
  canEditBudget: boolean;
  budgetCap: number | null;
  preset: Preset;
  onPreset: (p: Preset) => void;
  keyId: string;
  onKeyId: (id: string) => void;
  keys: OrgAnalyticsRow[];
  narrow: string;
  onNarrow: (v: string) => void;
  debouncedNarrow: string;
}) {
  const ext = data as Ext;
  const requests = totalRequests(ext);
  const tokens = totalTokens(ext);
  const cost = canSeeCost ? totalCost(ext) : null;
  const models = byModel(data);
  const providers = byProvider(data);
  const users = byUser(data);
  const points = timeline(data);

  const narrowed = (rows: OrgAnalyticsRow[]) =>
    debouncedNarrow ? rows.filter((r) => rowName(r).toLowerCase().includes(debouncedNarrow)) : rows;
  const visModels = narrowed(models);
  const visKeys = narrowed(byKey(data));
  const visUsers = narrowed(users);

  const activeCount = num(ext.active_users)
    ?? num(ext.active_keys)
    ?? (users.length > 0 ? users.length : null)
    ?? (byKey(data).length > 0 ? byKey(data).length : null);
  const activeLabel = num(ext.active_users) !== null ? "active users" : "active keys";
  const cacheRate = num(ext.cache_hit_rate)
    ?? (num(ext.cache_hits) !== null && num(ext.cache_requests)
      ? (num(ext.cache_hits)! / Math.max(1, num(ext.cache_requests)!)) * 100
      : null);
  const successRate = num(ext.success_rate)
    ?? (num(ext.successful_requests) !== null && requests
      ? (num(ext.successful_requests)! / Math.max(1, requests)) * 100
      : null);

  const empty = (requests ?? 0) === 0 && models.length === 0 && providers.length === 0
    && users.length === 0 && points.length === 0;

  // Charts (derived from the same response — totals reconcile by construction).
  const labels = points.map(pointLabel);
  const spendSeries = points.map((p) => num(p.spend ?? p.cost) ?? 0);
  const reqSeries = points.map((p) => num(p.requests) ?? 0);
  const donutSlices = providers.map((r) => ({ name: rowName(r), value: canSeeCost ? rowCost(r) : rowRequests(r) }));
  const modelBars = [...visModels]
    .sort((a, b) => (canSeeCost ? rowCost(b) - rowCost(a) : rowRequests(b) - rowRequests(a)))
    .slice(0, 8)
    .map((r) => ({
      name: rowName(r),
      value: canSeeCost ? rowCost(r) : rowRequests(r),
      hint: `${compact(rowRequests(r))} req`,
    }));
  const keyBars = [...visKeys]
    .sort((a, b) => (canSeeCost ? rowCost(b) - rowCost(a) : rowRequests(b) - rowRequests(a)))
    .slice(0, 8)
    .map((r) => ({
      name: rowName(r),
      value: canSeeCost ? rowCost(r) : rowRequests(r),
      hint: `${compact(rowRequests(r))} req`,
    }));

  // Insights — real data only, empty states otherwise.
  const topSpender = canSeeCost
    ? [...models, ...byKey(data)].sort((a, b) => rowCost(b) - rowCost(a))[0]
    : [...models, ...byKey(data)].sort((a, b) => rowRequests(b) - rowRequests(a))[0];
  const budgetPct = budgetCap !== null && cost !== null && budgetCap > 0
    ? (cost / budgetCap) * 100
    : null;

  return (
    <div className="space-y-2.5" data-testid="org-analytics">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={preset} onChange={(e) => onPreset(e.target.value as Preset)} sizeVariant="sm"
          className="w-40" aria-label="Time range" data-testid="org-analytics-range">
          {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </Select>
        {keys.length > 0 && (
          <Select value={keyId} onChange={(e) => onKeyId(e.target.value)} sizeVariant="sm"
            className="w-48" aria-label="Filter by API key" data-testid="org-analytics-key">
            <option value="">All keys</option>
            {keys.map((r, i) => {
              const id = r.id ?? r.key ?? rowName(r);
              return <option key={`${id}-${i}`} value={id}>{rowName(r)}</option>;
            })}
          </Select>
        )}
        <div className="min-w-44 flex-1">
          <SearchInput value={narrow} onChange={(e) => onNarrow(e.target.value)}
            onClear={() => onNarrow("")} placeholder="Narrow model / key / user lists…"
            aria-label="Narrow breakdown lists" data-testid="org-analytics-narrow" />
        </div>
      </div>

      <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4" data-testid="org-analytics-totals">
        <Stat label="Spend" value={canSeeCost ? (cost === null ? "—" : money(cost)) : "restricted"}
          rangeLabel={rangeLabel} testId="org-analytics-cost" />
        <Stat label="Requests" value={compact(requests)} rangeLabel={rangeLabel} testId="org-analytics-requests" />
        <Stat label="Tokens" value={compact(tokens)} rangeLabel={rangeLabel} testId="org-analytics-tokens" />
        <Stat label="Cache hit rate" value={cacheRate === null ? "—" : `${cacheRate.toFixed(1)}%`}
          rangeLabel={rangeLabel} testId="org-analytics-cache" />
        <Stat label={activeLabel === "active users" ? "Active users" : "Active keys"}
          value={compact(activeCount)} rangeLabel={rangeLabel} testId="org-analytics-active" />
        <Stat label="Success rate" value={successRate === null ? "—" : `${successRate.toFixed(1)}%`}
          rangeLabel={rangeLabel} testId="org-analytics-success" />
        <Stat label="Budget" value={budgetCap === null ? "Unlimited" : money(budgetCap)}
          rangeLabel="organization cap" testId="org-analytics-budget" />
      </div>

      {empty ? (
        <EmptyState icon={BarChart3} title="No usage yet"
          description="Organization usage will appear here once members start sending requests." />
      ) : (
        <>
          <Card>
            <CardContent className="p-3.5">
              <h3 className="mb-2 text-xs font-bold">Spend &amp; requests over time <span className="font-normal text-zinc-400">· {rangeLabel}</span></h3>
              {points.length === 0 ? (
                <p className="py-6 text-center text-xs text-zinc-400">No timeline data in this range.</p>
              ) : (
                <AreaChart testId="org-analytics-timeline" labels={labels}
                  series={[
                    ...(canSeeCost ? [{ name: "Spend", values: spendSeries }] : []),
                    { name: "Requests", values: reqSeries },
                  ]} />
              )}
            </CardContent>
          </Card>

          <div className="grid gap-2.5 xl:grid-cols-2">
            <Card>
              <CardContent className="p-3.5">
                <h3 className="mb-2 text-xs font-bold">Share by provider</h3>
                {providers.length === 0 ? (
                  <p className="py-6 text-center text-xs text-zinc-400">No per-provider usage yet.</p>
                ) : (
                  <DonutChart testId="org-analytics-by-provider" slices={donutSlices}
                    centerLabel={canSeeCost ? "Spend" : "Requests"}
                    valueFormat={(v) => (canSeeCost ? money(v) : compact(v))} />
                )}
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3.5">
                <h3 className="mb-2 text-xs font-bold">Top models</h3>
                {visModels.length === 0 ? (
                  <p className="py-6 text-center text-xs text-zinc-400">
                    {debouncedNarrow ? "No models match this filter." : "No per-model usage yet."}
                  </p>
                ) : (
                  <BarList testId="org-analytics-by-model" items={modelBars}
                    valueFormat={(v) => (canSeeCost ? money(v) : compact(v))} />
                )}
              </CardContent>
            </Card>
          </div>

          {byKey(data).length > 0 && (
            <Card>
              <CardContent className="p-3.5">
                <h3 className="mb-2 text-xs font-bold">Top keys</h3>
                {visKeys.length === 0 ? (
                  <p className="py-6 text-center text-xs text-zinc-400">No keys match this filter.</p>
                ) : (
                  <BarList testId="org-analytics-by-key" items={keyBars}
                    valueFormat={(v) => (canSeeCost ? money(v) : compact(v))} />
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent className="p-3.5">
              <h3 className="mb-2 text-xs font-bold">By user</h3>
              {visUsers.length === 0 ? (
                <p className="py-4 text-xs text-zinc-500">
                  {debouncedNarrow ? "No users match this filter." : "No per-user usage yet."}
                </p>
              ) : (
                <div className="overflow-x-auto" data-testid="org-analytics-by-user">
                  <table className="w-full min-w-[480px] border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-zinc-200 text-left text-[10px] uppercase tracking-wider text-zinc-400 dark:border-zinc-800">
                        <th className="py-2 pr-3 font-medium">User</th>
                        <th className="py-2 pr-3 text-right font-medium">Requests</th>
                        <th className="py-2 pr-3 text-right font-medium">Tokens</th>
                        <th className="py-2 text-right font-medium">Cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visUsers.map((r, i) => (
                        <tr key={r.id ?? r.key ?? `${rowName(r)}-${i}`}
                          className="border-b border-zinc-100 last:border-0 dark:border-zinc-900">
                          <td className="max-w-56 truncate py-2 pr-3 font-medium">
                            {rowName(r)}{" "}
                            {(r.removed ?? r.removed_badge ?? r.is_removed ?? r.member_removed) && (
                              <Badge variant="outline" data-testid="org-analytics-removed">removed member</Badge>
                            )}
                          </td>
                          <td className="py-2 pr-3 text-right font-mono">{compact(rowRequests(r))}</td>
                          <td className="py-2 pr-3 text-right font-mono">{compact(rowTokens(r))}</td>
                          <td className="py-2 text-right font-mono">
                            {canSeeCost ? money(rowCost(r)) : "restricted"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-3.5">
              <h3 className="mb-2 text-xs font-bold">Insights</h3>
              <ul className="space-y-1.5 text-xs" data-testid="org-analytics-insights">
                {topSpender ? (
                  <li>Top spend: <strong>{rowName(topSpender)}</strong> — {canSeeCost ? money(rowCost(topSpender)) : `${compact(rowRequests(topSpender))} requests`} in {rangeLabel.toLowerCase()}.</li>
                ) : (
                  <li className="text-zinc-500">No top-spend signal — no attributed usage in this range.</li>
                )}
                {budgetPct !== null ? (
                  <li>Budget proximity: <strong>{budgetPct.toFixed(1)}%</strong> of the {money(budgetCap)} cap consumed{budgetPct >= 80 ? " — approaching the cap." : "."}</li>
                ) : (
                  <li className="text-zinc-500">No budget-proximity signal — cap or spend is unavailable.</li>
                )}
                {successRate !== null ? (
                  <li>Success rate <strong>{successRate.toFixed(1)}%</strong> in {rangeLabel.toLowerCase()}{successRate < 99 ? " — elevated errors, check provider health." : "."}</li>
                ) : (
                  <li className="text-zinc-500">No error signals in this range.</li>
                )}
              </ul>
            </CardContent>
          </Card>
        </>
      )}

      <OrgBudgetCard orgId={orgId} canRead={canReadBudget} canEdit={canEditBudget} />
    </div>
  );
}
