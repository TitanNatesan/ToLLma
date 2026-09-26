"use client";

import { useMemo } from "react";
import { SectionCard } from "./SectionCard";
import { HBarChart } from "./HBarChart";
import { KpiCard } from "./KpiCard";
import { ProvidersTable } from "./tables";
import { fmtMoney, toNumber } from "./format";
import type { AdminProviders } from "@/types/admin";

/** Providers tab: traffic ranking and full reliability table. */
export function ProvidersSection({ data }: { data: AdminProviders }) {  const bars = useMemo(
    () =>
      data.rows.map((row) => ({
        name: row.provider_name,
        value: row.requests,
        hint: fmtMoney(row.total_cost),
      })),
    [data.rows],
  );

  const totalCost = useMemo(
    () => data.rows.reduce((sum, row) => sum + toNumber(row.total_cost), 0),
    [data.rows],
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiCard
          label="Healthy credentials"
          value={String(data.credential_health?.healthy ?? 0)}
          testId="admin-providers-healthy"
        />
        <KpiCard
          label="Broken credentials"
          value={String(data.credential_health?.broken ?? 0)}
          testId="admin-providers-broken"
        />
        <KpiCard
          label="Unchecked credentials"
          value={String(data.credential_health?.unknown ?? 0)}
          testId="admin-providers-unknown"
        />
      </div>
      <SectionCard
        title="Requests by provider"
        description={`${data.rows.length} providers · ${fmtMoney(totalCost)} tracked spend in range.`}
        testId="admin-providers-chart"
      >
        <HBarChart
          data={bars}
          valueName="Requests"
          ariaLabel="Horizontal bars of provider request volume"
          testId="admin-providers-bars"
        />
      </SectionCard>

      <SectionCard
        title="Provider breakdown"
        description="Requests, tokens, spend, error rate and latency per provider."
        testId="admin-providers-table-card"
      >
        <ProvidersTable rows={data.rows} />
      </SectionCard>
    </div>
  );
}
