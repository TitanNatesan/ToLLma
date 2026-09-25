"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Ban, Globe, Network, ShieldCheck, Sparkles } from "lucide-react";
import { Badge, EmptyState, ErrorState } from "@/components/ui";
import { fmtTokens } from "@/lib/utils";
import { apiKeyErrorMessage, getKeyNetwork, isApiKeyStatus } from "@/services/apiKeys";
import { DistributionDonut } from "./analytics/DistributionDonut";
import { DEFAULT_RANGE, RangeSelector, type RangeValue } from "./analytics/RangeSelector";
import {
  ChartSkeleton,
  DataTable,
  MetricGroup,
  SectionFrame,
  fmtRelative,
  num,
  sharePct,
  truncate,
  type TableColumn,
} from "./analytics/shared";
import type {
  ApiKeyNetwork,
  ApiKeyNetworkClient,
  ApiKeyNetworkDevice,
  ApiKeyNetworkIp,
  ApiKeyNetworkLocation,
} from "@/types/apiKeys";

const IP_COLUMNS: Array<TableColumn<ApiKeyNetworkIp>> = [
  {
    key: "ip",
    header: "IP address",
    sortValue: (row) => row.ip ?? "",
    render: (row) => (
      <span className="font-mono text-[11px] text-zinc-700 dark:text-zinc-300">{row.ip}</span>
    ),
  },
  {
    key: "blocked",
    header: "Status",
    render: (row) =>
      row.blocked ? (
        <Badge variant="destructive" className="px-1.5 py-0 text-[9px] uppercase">
          Blocked
        </Badge>
      ) : (
        <Badge variant="secondary" className="px-1.5 py-0 text-[9px] uppercase">
          Allowed
        </Badge>
      ),
  },
  {
    key: "requests",
    header: "Requests",
    align: "right",
    sortValue: (row) => num(row.requests),
    render: (row) => <span className="font-mono">{fmtTokens(row.requests)}</span>,
  },
  {
    key: "last_seen",
    header: "Last seen",
    align: "right",
    sortValue: (row) => row.last_seen_at ?? "",
    render: (row) => (
      <span className="text-zinc-500" title={row.last_seen_at ?? undefined}>
        {fmtRelative(row.last_seen_at)}
      </span>
    ),
  },
];

const LOCATION_COLUMNS: Array<TableColumn<ApiKeyNetworkLocation>> = [
  {
    key: "country",
    header: "Country",
    sortValue: (row) => row.country ?? "",
    render: (row) => (
      <span className="text-zinc-800 dark:text-zinc-200">{row.country || "Unknown"}</span>
    ),
  },
  {
    key: "region",
    header: "Region",
    sortValue: (row) => row.region ?? "",
    render: (row) => <span className="text-zinc-500">{row.region || "—"}</span>,
  },
  {
    key: "city",
    header: "City",
    sortValue: (row) => row.city ?? "",
    render: (row) => <span className="text-zinc-500">{row.city || "—"}</span>,
  },
  {
    key: "requests",
    header: "Requests",
    align: "right",
    sortValue: (row) => num(row.requests),
    render: (row) => <span className="font-mono">{fmtTokens(row.requests)}</span>,
  },
];

const DEVICE_COLUMNS: Array<TableColumn<ApiKeyNetworkDevice>> = [
  {
    key: "device",
    header: "Device",
    sortValue: (row) => row.device_type ?? "",
    render: (row) => (
      <span className="text-zinc-800 dark:text-zinc-200">{row.device_type || "unknown"}</span>
    ),
  },
  {
    key: "platform",
    header: "Platform",
    sortValue: (row) => row.platform ?? "",
    render: (row) => <span className="text-zinc-500">{row.platform || "—"}</span>,
  },
  {
    key: "browser",
    header: "Browser",
    sortValue: (row) => row.browser ?? "",
    render: (row) => <span className="text-zinc-500">{row.browser || "—"}</span>,
  },
  {
    key: "user_agent",
    header: "User agent",
    render: (row) => (
      <span
        className="block max-w-72 truncate font-mono text-[10px] text-zinc-400"
        title={row.user_agent ?? undefined}
      >
        {row.user_agent ? truncate(row.user_agent, 64) : "—"}
      </span>
    ),
  },
  {
    key: "requests",
    header: "Requests",
    align: "right",
    sortValue: (row) => num(row.requests),
    render: (row) => <span className="font-mono">{fmtTokens(row.requests)}</span>,
  },
];

function NetworkSkeleton() {
  return (
    <div className="space-y-4" data-testid="key-network-loading">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={index}
            className="h-24 animate-pulse rounded-xl border border-zinc-200 bg-zinc-100/60 dark:border-zinc-800 dark:bg-zinc-900/60"
          />
        ))}
      </div>
      <ChartSkeleton height={220} />
      <ChartSkeleton height={180} />
    </div>
  );
}

/** Network tab: origin IPs, geo, devices and client/SDK distribution. */
export function NetworkPanel({ keyId }: { keyId: string }) {
  const [range, setRange] = useState<RangeValue>(DEFAULT_RANGE);
  const customReady = range.preset !== "custom" || (!!range.start && !!range.end);
  const params = useMemo(
    () => ({
      preset: range.preset,
      start: range.preset === "custom" ? range.start || undefined : undefined,
      end: range.preset === "custom" ? range.end || undefined : undefined,
    }),
    [range],
  );

  const query = useQuery({
    queryKey: ["key-network", keyId, params],
    queryFn: () => getKeyNetwork(keyId, params),
    enabled: customReady,
    staleTime: 30_000,
  });

  const error = query.error;
  return (
    <div className="space-y-4" data-testid="key-network">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">Traffic origins</h3>
        <RangeSelector
          value={range}
          onChange={setRange}
          onRefresh={() => void query.refetch()}
          fetching={query.isFetching}
          testIdPrefix="key-network-range"
        />
      </div>

      {!customReady && (
        <EmptyState
          icon={Network}
          title="Pick a date range"
          description="Select both a start and end date to load network analytics."
          className="py-12"
          testId="key-network-custom-pending"
        />
      )}

      {customReady && query.isPending && <NetworkSkeleton />}

      {customReady && !query.isPending && error && isApiKeyStatus(error, 404) && (
        <EmptyState
          icon={Network}
          title="Key not found"
          description="This key was deleted or never existed for this account."
          className="py-12"
        />
      )}
      {customReady && !query.isPending && error && isApiKeyStatus(error, 403) && (
        <EmptyState
          icon={Network}
          title="Network analytics not available"
          description="You do not have access to this key's traffic data."
          className="py-12"
        />
      )}
      {customReady &&
        !query.isPending &&
        error &&
        !isApiKeyStatus(error, 404) &&
        !isApiKeyStatus(error, 403) && (
          <ErrorState
            title="Could not load network analytics"
            message={apiKeyErrorMessage(error)}
            onRetry={() => void query.refetch()}
          />
        )}

      {customReady && !query.isPending && !error && query.data && (
        <NetworkBody data={query.data} />
      )}
    </div>
  );
}

function NetworkBody({ data }: { data: ApiKeyNetwork }) {
  const hasTraffic =
    num(data.unique_ips) > 0 ||
    (data.ips?.length ?? 0) > 0 ||
    (data.clients?.length ?? 0) > 0 ||
    (data.devices?.length ?? 0) > 0;
  const clients = useMemo(
    () =>
      (data.clients ?? []).map((row: ApiKeyNetworkClient) => ({
        name: row.client || "unknown",
        value: num(row.requests),
        hint: row.sdk ? `${row.sdk} · ${sharePct(row.share, 0)}` : sharePct(row.share, 0),
      })),
    [data.clients],
  );

  if (!hasTraffic) {
    return (
      <EmptyState
        icon={Globe}
        title="No network activity"
        description="IPs, locations, devices and client SDKs will appear once this key handles traffic."
        className="py-12"
        testId="key-network-empty"
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricGroup
          title="Unique IPs"
          icon={Globe}
          items={[{ label: "Distinct sources", value: fmtTokens(data.unique_ips), tone: "accent" }]}
          testId="key-network-unique-ips"
        />
        <MetricGroup
          title="Blocked"
          icon={Ban}
          items={[
            {
              label: "Denied requests",
              value: fmtTokens(data.blocked_ips),
              tone: num(data.blocked_ips) > 0 ? "danger" : "default",
            },
          ]}
          testId="key-network-blocked-ips"
        />
        <MetricGroup
          title="Allowed"
          icon={ShieldCheck}
          items={[{ label: "Permitted sources", value: fmtTokens(data.allowed_ips), tone: "success" }]}
          testId="key-network-allowed-ips"
        />
        <MetricGroup
          title="New"
          icon={Sparkles}
          items={[{ label: "First seen in range", value: fmtTokens(data.new_ips) }]}
          testId="key-network-new-ips"
        />
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <SectionFrame
          title="Client distribution"
          description="SDK, CLI and integration clients hitting this key."
          testId="key-network-clients"
        >
          <DistributionDonut
            items={clients}
            valueFormat={(value) => `${fmtTokens(value)} req`}
            ariaLabel="Requests by client"
            testId="key-network-clients-donut"
          />
        </SectionFrame>

        <SectionFrame
          title="Locations"
          description="Country, region and city of origin (private IPs stay local)."
          testId="key-network-locations"
        >
          {data.locations?.length ? (
            <DataTable
              columns={LOCATION_COLUMNS}
              rows={data.locations}
              rowKey={(row) => `${row.country ?? ""}:${row.region ?? ""}:${row.city ?? ""}`}
              initialSortKey="requests"
            />
          ) : (
            <p className="py-8 text-center text-xs text-zinc-400">No geolocated traffic</p>
          )}
        </SectionFrame>
      </div>

      <SectionFrame
        title="Top IP addresses"
        description="Most active sources with allow/deny state."
        testId="key-network-ips"
      >
        <DataTable
          columns={IP_COLUMNS}
          rows={data.ips ?? []}
          rowKey={(row) => row.ip}
          testId="key-network-ip-table"
          initialSortKey="requests"
        />
      </SectionFrame>

      <SectionFrame
        title="Devices"
        description="Device, platform, browser and raw user agent."
        testId="key-network-devices"
      >
        <DataTable
          columns={DEVICE_COLUMNS}
          rows={data.devices ?? []}
          rowKey={(row) => row.user_agent ?? `${row.device_type}:${row.platform}:${row.browser}`}
          testId="key-network-device-table"
          initialSortKey="requests"
        />
      </SectionFrame>
    </div>
  );
}
