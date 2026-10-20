"use client";

import { useMemo } from "react";
import { chartColor } from "@/components/charts/palette";
import { fmtTokens } from "@/lib/utils";
import { DistributionDonut } from "./DistributionDonut";
import { CHAT_ENDPOINT, CHAT_ENDPOINT_COLOR, SectionFrame, endpointLabel, num, sharePct } from "./shared";
import type { ApiKeyAnalyticsSummary } from "@/types/apiKeys";

/** Endpoint Usage: donut of requests across gateway endpoints plus in-app chat. */
export function EndpointDonut({ summary }: { summary: ApiKeyAnalyticsSummary }) {
  const items = useMemo(() => {
    let gateway = 0;
    return (summary.endpoints ?? []).map((row) => ({
      name: endpointLabel(row.endpoint),
      value: num(row.requests),
      hint:
        row.share !== null && row.share !== undefined
          ? `${sharePct(row.share, 0)} share`
          : undefined,
      color: row.endpoint === CHAT_ENDPOINT ? CHAT_ENDPOINT_COLOR : chartColor(gateway++),
    }));
  }, [summary.endpoints]);

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
