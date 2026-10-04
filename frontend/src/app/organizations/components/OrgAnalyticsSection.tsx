"use client";

import { BarChart3 } from "lucide-react";
import {
  Badge, Card, CardContent, EmptyState, ErrorState, LoadingState,
} from "@/components/ui";
import { OrgBudgetCard } from "./OrgBudgetCard";
import { useOrgAnalyticsOverview } from "@/hooks/useOrgs";
import { parseApiError } from "@/lib/errors";
import { ApiError } from "@/services/api";
import type { OrgAnalyticsOverview, OrgAnalyticsRow } from "@/types/orgs";

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

function totalRequests(o: OrgAnalyticsOverview): number | null {
  const t = (o as { totals?: { requests?: number | string | null } | null }).totals;
  return num(t?.requests ?? o.requests ?? o.total_requests);
}

function totalTokens(o: OrgAnalyticsOverview): number | null {
  const t = (o as { totals?: { tokens?: number | string | null } | null }).totals;
  return num(t?.tokens ?? o.tokens ?? o.total_tokens);
}

function totalCost(o: OrgAnalyticsOverview): number | null {
  const t = (o as { totals?: { cost?: number | string | null } | null }).totals;
  return num(t?.cost ?? o.cost ?? o.total_cost ?? o.spend);
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

function rowName(r: OrgAnalyticsRow): string {
  const v = r.name ?? r.label ?? r.model ?? r.provider ?? r.email ?? r.user_email ?? r.key ?? r.id;
  return typeof v === "string" && v ? v : "—";
}

function rowRequests(r: OrgAnalyticsRow): number | null {
  return num(r.requests ?? r.total_requests);
}

function rowTokens(r: OrgAnalyticsRow): number | null {
  return num(r.tokens ?? r.total_tokens);
}

function rowCost(r: OrgAnalyticsRow): number | null {
  return num(r.cost ?? r.total_cost ?? r.spend);
}

function rowRemoved(r: OrgAnalyticsRow): boolean {
  return !!(r.removed ?? r.removed_badge ?? r.is_removed ?? r.member_removed);
}

function isNotFound(e: unknown): boolean {
  return e instanceof ApiError && e.status === 404;
}

function Stat({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <Card data-testid={testId}>
      <CardContent className="p-3.5">
        <p className="text-[11px] uppercase tracking-wide text-zinc-500">{label}</p>
        <p className="text-2xl font-bold">{value}</p>
      </CardContent>
    </Card>
  );
}

function RowsTable({ rows, testId, showRemoved, canSeeCost, emptyTitle }: {
  rows: OrgAnalyticsRow[];
  testId: string;
  showRemoved?: boolean;
  canSeeCost: boolean;
  emptyTitle: string;
}) {
  if (rows.length === 0) {
    return <p className="p-3 text-xs text-zinc-500">{emptyTitle}</p>;
  }
  return (
    <div className="overflow-x-auto" data-testid={testId}>
      <table className="w-full min-w-[480px] border-collapse text-xs">
        <thead>
          <tr className="border-b border-zinc-200 text-left text-[10px] uppercase tracking-wider text-zinc-400 dark:border-zinc-800">
            <th className="py-2 pr-3 font-medium">Name</th>
            <th className="py-2 pr-3 text-right font-medium">Requests</th>
            <th className="py-2 pr-3 text-right font-medium">Tokens</th>
            <th className="py-2 text-right font-medium">Cost</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id ?? r.key ?? `${rowName(r)}-${i}`}
              className="border-b border-zinc-100 last:border-0 dark:border-zinc-900">
              <td className="max-w-56 truncate py-2 pr-3 font-medium">
                {rowName(r)}{" "}
                {showRemoved && rowRemoved(r) && (
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
  );
}

export function OrgAnalyticsSection({ orgId, canView, canSeeCost, canReadBudget, canEditBudget }: {
  orgId: string;
  canView: boolean;
  canSeeCost: boolean;
  canReadBudget: boolean;
  canEditBudget: boolean;
}) {
  const overview = useOrgAnalyticsOverview(orgId, { enabled: canView });

  if (!canView) {
    return <EmptyState title="Analytics" description="You need usage-analytics permission to view organization analytics." />;
  }

  if (overview.isLoading) return <LoadingState message="Loading analytics…" />;
  if (overview.isError && isNotFound(overview.error)) {
    return (
      <div className="space-y-2.5">
        <EmptyState icon={BarChart3} title="Analytics aren't available yet"
          description="The organization analytics service is still rolling out." />
        <OrgBudgetCard orgId={orgId} canRead={canReadBudget} canEdit={canEditBudget} />
      </div>
    );
  }
  if (overview.isError || !overview.data) {
    return (
      <ErrorState title="Could not load analytics"
        message={overview.error ? parseApiError(overview.error).message : "No data."}
        onRetry={() => void overview.refetch()} />
    );
  }

  const data = overview.data;
  const requests = totalRequests(data);
  const tokens = totalTokens(data);
  const cost = canSeeCost ? totalCost(data) : null;
  const models = byModel(data);
  const providers = byProvider(data);
  const users = byUser(data);
  const empty = (requests ?? 0) === 0 && models.length === 0 && providers.length === 0 && users.length === 0;

  return (
    <div className="space-y-2.5" data-testid="org-analytics">
      <div className="grid gap-2.5 sm:grid-cols-3" data-testid="org-analytics-totals">
        <Stat label="Requests" value={compact(requests)} testId="org-analytics-requests" />
        <Stat label="Tokens" value={compact(tokens)} testId="org-analytics-tokens" />
        <Stat label="Cost" value={canSeeCost ? (cost === null ? "—" : money(cost)) : "restricted"}
          testId="org-analytics-cost" />
      </div>

      {empty ? (
        <EmptyState icon={BarChart3} title="No usage yet"
          description="Organization usage will appear here once members start sending requests." />
      ) : (
        <>
          <Card>
            <CardContent className="p-3.5">
              <h3 className="mb-2 text-xs font-bold">By model</h3>
              <RowsTable rows={models} testId="org-analytics-by-model"
                canSeeCost={canSeeCost} emptyTitle="No per-model usage yet." />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3.5">
              <h3 className="mb-2 text-xs font-bold">By provider</h3>
              <RowsTable rows={providers} testId="org-analytics-by-provider"
                canSeeCost={canSeeCost} emptyTitle="No per-provider usage yet." />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3.5">
              <h3 className="mb-2 text-xs font-bold">By user</h3>
              <RowsTable rows={users} testId="org-analytics-by-user" showRemoved
                canSeeCost={canSeeCost} emptyTitle="No per-user usage yet." />
            </CardContent>
          </Card>
        </>
      )}

      <OrgBudgetCard orgId={orgId} canRead={canReadBudget} canEdit={canEditBudget} />
    </div>
  );
}
