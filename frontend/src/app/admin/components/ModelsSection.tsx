"use client";

import { useMemo } from "react";
import { SearchInput } from "@/components/ui";
import { SectionCard } from "./SectionCard";
import { HBarChart } from "./HBarChart";
import { ModelsTable } from "./tables";
import { fmtMoney } from "./format";
import type { AdminModels } from "@/types/admin";

interface ModelsSectionProps {
  data: AdminModels;
  search: string;
  onSearchChange: (value: string) => void;
  refreshing?: boolean;
}

/** Models tab: searchable ranking + per-model reliability table. */
export function ModelsSection({ data, search, onSearchChange, refreshing = false }: ModelsSectionProps) {
  const bars = useMemo(
    () =>
      data.rows.slice(0, 15).map((row) => ({
        name: row.model_name,
        value: row.requests,
        hint: fmtMoney(row.total_cost),
      })),
    [data.rows],
  );

  return (
    <div className="space-y-4">
      <SectionCard
        title="Requests by model"
        description="Top models in the selected range."
        testId="admin-models-chart"
      >
        <HBarChart
          data={bars}
          valueName="Requests"
          height={280}
          ariaLabel="Horizontal bars of model request volume"
          testId="admin-models-bars"
        />
      </SectionCard>

      <SectionCard
        title="Model breakdown"
        description="Requests, tokens, spend, error rate and latency per model."
        testId="admin-models-table-card"
        action={
          <div className="flex items-center gap-2">
            {refreshing && <span className="text-[10px] text-zinc-400">Refreshing…</span>}
            <div className="w-52">
              <SearchInput
                value={search}
                onChange={(event) => onSearchChange(event.target.value)}
                onClear={() => onSearchChange("")}
                placeholder="Search models"
                aria-label="Search models"
                data-testid="admin-models-search"
              />
            </div>
          </div>
        }
      >
        <ModelsTable rows={data.rows} />
      </SectionCard>
    </div>
  );
}
