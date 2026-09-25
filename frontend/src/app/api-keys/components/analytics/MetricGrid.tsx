"use client";

import { useMemo } from "react";
import { Activity, Coins, Gauge, Hash } from "lucide-react";
import { fmtCost, fmtTokens } from "@/lib/utils";
import {
  fmtMs,
  fmtUnitCost,
  MetricGroup,
  num,
  pct,
  type MetricItem,
} from "./shared";
import type { ApiKeyAnalyticsSummary } from "@/types/apiKeys";

/** Four developer-grade metric groups: requests, performance, cost, tokens. */
export function MetricGrid({ summary }: { summary: ApiKeyAnalyticsSummary }) {
  const groups = useMemo(() => {
    const requests = summary.requests ?? ({} as ApiKeyAnalyticsSummary["requests"]);
    const total = num(requests.total);
    const base = total > 0 ? total : 1;

    const performance = summary.performance ?? ({} as ApiKeyAnalyticsSummary["performance"]);
    const cost = summary.cost ?? ({} as ApiKeyAnalyticsSummary["cost"]);
    const tokens = summary.tokens ?? ({} as ApiKeyAnalyticsSummary["tokens"]);

    const expensive = cost.most_expensive_request;
    let expensiveValue = "—";
    let expensiveHint: string | undefined;
    if (expensive !== null && expensive !== undefined && typeof expensive === "object") {
      expensiveValue = fmtCost(expensive.cost);
      expensiveHint = [expensive.model, expensive.endpoint].filter(Boolean).join(" · ") || undefined;
    } else if (expensive !== null && expensive !== undefined) {
      expensiveValue = fmtCost(expensive);
    }

    const requestItems: MetricItem[] = [
      { label: "Total", value: fmtTokens(total), tone: "accent" },
      { label: "Success", value: pct(num(requests.success) / base), tone: "success" },
      {
        label: "Failed",
        value: pct(num(requests.failed) / base),
        tone: num(requests.failed) > 0 ? "danger" : "default",
      },
      { label: "Cancelled", value: pct(num(requests.cancelled) / base) },
      {
        label: "Timeout",
        value: pct(num(requests.timeout) / base),
        tone: num(requests.timeout) > 0 ? "warning" : "default",
      },
      { label: "Retry", value: pct(num(requests.retry) / base) },
    ];

    const performanceItems: MetricItem[] = [
      { label: "Average", value: fmtMs(performance.avg_latency_ms), tone: "accent" },
      { label: "p50", value: fmtMs(performance.p50_ms) },
      { label: "p90", value: fmtMs(performance.p90_ms) },
      { label: "p95", value: fmtMs(performance.p95_ms) },
      { label: "p99", value: fmtMs(performance.p99_ms) },
      { label: "Slowest", value: fmtMs(performance.slowest_ms) },
      { label: "Fastest", value: fmtMs(performance.fastest_ms) },
    ];

    const costItems: MetricItem[] = [
      { label: "Total", value: fmtCost(cost.total), tone: "accent" },
      { label: "Today", value: fmtCost(cost.today) },
      { label: "Last 7d", value: fmtCost(cost.last_7d) },
      { label: "Last 30d", value: fmtCost(cost.last_30d) },
      { label: "Projected month", value: fmtCost(cost.projected_month) },
      { label: "Per request", value: fmtCost(cost.cost_per_request) },
      { label: "Per token", value: fmtUnitCost(cost.cost_per_token) },
      { label: "Most expensive", value: expensiveValue, hint: expensiveHint },
    ];

    const tokenItems: MetricItem[] = [
      { label: "Prompt", value: fmtTokens(tokens.prompt) },
      { label: "Completion", value: fmtTokens(tokens.completion) },
      { label: "Reasoning", value: fmtTokens(tokens.reasoning) },
      { label: "Cache read", value: fmtTokens(tokens.cache_read) },
      { label: "Cache write", value: fmtTokens(tokens.cache_write) },
      { label: "Total", value: fmtTokens(tokens.total), tone: "accent" },
      { label: "Per request", value: fmtTokens(tokens.per_request) },
    ];

    return { requestItems, performanceItems, costItems, tokenItems };
  }, [summary]);

  return (
    <div
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4"
      data-testid="key-analytics-metrics"
    >
      <MetricGroup
        title="Requests"
        icon={Activity}
        items={groups.requestItems}
        testId="key-metrics-requests"
      />
      <MetricGroup
        title="Performance"
        icon={Gauge}
        items={groups.performanceItems}
        testId="key-metrics-performance"
      />
      <MetricGroup title="Cost" icon={Coins} items={groups.costItems} testId="key-metrics-cost" />
      <MetricGroup title="Tokens" icon={Hash} items={groups.tokenItems} testId="key-metrics-tokens" />
    </div>
  );
}
