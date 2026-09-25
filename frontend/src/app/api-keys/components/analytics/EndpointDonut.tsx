"use client";

import { useMemo } from "react";
import { fmtTokens } from "@/lib/utils";
import { DistributionDonut } from "./DistributionDonut";
import { SectionFrame, num, sharePct } from "./shared";
import type { ApiKeyAnalyticsSummary } from "@/types/apiKeys";

/** Endpoint Usage: donut of requests across gateway endpoints. */
export function EndpointDonut({ summary }: { summary: ApiKeyAnalyticsSummary }) {
  const items = useMemo(
    () =>
      (summary.endpoints ?? []).map((row) => ({
        name: row.endpoint || "unknown endpoint",
        value: num(row.requests),
        hint:
          row.share !== null && row.share !== undefined
            ? `${sharePct(row.share, 0)} share`
            : undefined,
      })),
    [summary.endpoints],
  );

  return (
    <SectionFrame
      title="Endpoint usage"
      description="Request share per gateway endpoint."
      testId="key-endpoint-donut"
    >
      <DistributionDonut
        items={items}
        valueFormat={(value) => fmtTokens(value)}
        ariaLabel="Requests by endpoint"
        testId="key-endpoints-donut"
      />
    </SectionFrame>
  );
}
