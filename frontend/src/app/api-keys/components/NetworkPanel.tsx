"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Ban,
  Building2,
  Globe,
  Globe2,
  MapPin,
  MonitorSmartphone,
  Network,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
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
    key: "requests",
    header: "Requests",
    align: "right",
    sortValue: (row) => num(row.requests),
    render: (row) => <span className="font-mono">{fmtTokens(row.requests)}</span>,
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

type ClientGroup = "SDK" | "Browser" | "CLI" | "Custom";

/** Map a raw client/sdk pair to a display label + one of the four groups. */
function classifyClient(client: string, sdk: string | null): { group: ClientGroup; label: string } {
  const hay = `${client} ${sdk ?? ""}`.toLowerCase();
  if (hay.includes("openai")) return { group: "SDK", label: "OpenAI SDK" };
  if (hay.includes("anthropic")) return { group: "SDK", label: "Anthropic SDK" };
  if (hay.includes("curl")) return { group: "CLI", label: "Curl" };
  if (hay.includes("python-requests") || (hay.includes("python") && hay.includes("requests"))) {
    return { group: "SDK", label: "Python Requests" };
  }
  if (hay.includes("node") || hay.includes("undici") || hay.includes("node-fetch")) {
    return { group: "SDK", label: "Node Fetch" };
  }
  if (
    hay.includes("mozilla") ||
    hay.includes("chrome") ||
    hay.includes("safari") ||
    hay.includes("firefox") ||
    hay.includes("edge") ||
    hay.includes("browser")
  ) {
    return { group: "Browser", label: "Browser" };
  }
  if (hay.includes("cli") || hay.includes("terminal") || hay.includes("shell")) {
    return { group: "CLI", label: client || "CLI" };
  }
  if (
    hay.includes("sdk") ||
    hay.includes("langchain") ||
    hay.includes("llama") ||
    hay.includes("golang") ||
    hay.includes("go-http") ||
    hay.includes("java") ||
    hay.includes("ruby") ||
    hay.includes("rust") ||
    hay.includes("php") ||
    hay.includes("dotnet")
  ) {
    return { group: "SDK", label: client || "SDK" };
  }
  return { group: "Custom", label: client || "Custom" };
}

type DeviceCategory = "Desktop" | "Mobile" | "Server" | "Unknown";

/** Roll raw device rows into Desktop / Mobile / Server / Unknown. */
function categorizeDevice(row: ApiKeyNetworkDevice): DeviceCategory {
  const hay = `${row.device_type ?? ""} ${row.platform ?? ""} ${row.browser ?? ""}`.toLowerCase();
  if (/mobile|phone|android|iphone|ios|ipad|tablet/.test(hay)) return "Mobile";
  if (/server|bot|crawler|spider|curl|cli|headless|datacenter|scraper/.test(hay)) return "Server";
  if (/desktop|windows|mac|linux|laptop|chromebook/.test(hay)) return "Desktop";
  // A recognised browser without a device hint still means an end-user machine.
  if (row.browser) return "Desktop";
  return "Unknown";
}

const CLIENT_ROW_COLUMNS: Array<
  TableColumn<ApiKeyNetworkClient & { group: ClientGroup; label: string }>
> = [
  {
    key: "client",
    header: "Client",
    sortValue: (row) => row.label ?? "",
    render: (row) => (
      <span className="text-zinc-800 dark:text-zinc-200" title={row.client}>
        {row.label}
      </span>
    ),
  },
  {
    key: "group",
    header: "Group",
    sortValue: (row) => row.group,
    render: (row) => (
      <Badge variant="secondary" className="px-1.5 py-0 text-[9px] uppercase">
        {row.group}
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
    (data.devices?.length ?? 0) > 0 ||
    (data.locations?.length ?? 0) > 0;

  const geo = useMemo(() => {
    const locations = data.locations ?? [];
    const countries = new Set<string>();
    const regions = new Set<string>();
    const cities = new Set<string>();
    const byCountry = new Map<string, number>();
    for (const row of locations) {
      if (row.country) countries.add(row.country);
      if (row.region) regions.add(`${row.country ?? ""}:${row.region}`);
      if (row.city) cities.add(`${row.region ?? ""}:${row.city}`);
      const key = row.country || "Unknown";
      byCountry.set(key, (byCountry.get(key) ?? 0) + num(row.requests));
    }
    const top = (pick: (row: ApiKeyNetworkLocation) => string | null) => {
      let best = "";
      let bestRequests = -1;
      for (const row of locations) {
        const name = pick(row) || "Unknown";
        if (num(row.requests) > bestRequests) {
          best = name;
          bestRequests = num(row.requests);
        }
      }
      return bestRequests >= 0 ? { name: best, requests: bestRequests } : null;
    };
    return {
      countryCount: countries.size,
      regionCount: regions.size,
      cityCount: cities.size,
      topCountry: top((row) => row.country),
      topRegion: top((row) => row.region),
      topCity: top((row) => row.city),
      countryDonut: [...byCountry.entries()].map(([name, value]) => ({ name, value })),
    };
  }, [data.locations]);

  const clients = useMemo(
    () =>
      (data.clients ?? []).map((row: ApiKeyNetworkClient) => {
        const { group, label } = classifyClient(row.client, row.sdk);
        return { ...row, group, label };
      }),
    [data.clients],
  );

  const clientGroups = useMemo(() => {
    const order: ClientGroup[] = ["SDK", "Browser", "CLI", "Custom"];
    return order.map((group) => {
      const members = clients
        .filter((row) => row.group === group)
        .sort((a, b) => num(b.requests) - num(a.requests));
      return {
        group,
        requests: members.reduce((sum, row) => sum + num(row.requests), 0),
        examples: members.slice(0, 3).map((row) => row.label),
      };
    });
  }, [clients]);

  const clientDonut = useMemo(
    () =>
      clients.map((row) => ({
        name: row.label || "unknown",
        value: num(row.requests),
        hint: row.sdk ? `${row.sdk} · ${sharePct(row.share, 0)}` : sharePct(row.share, 0),
      })),
    [clients],
  );

  const deviceCategories = useMemo(() => {
    const order: DeviceCategory[] = ["Desktop", "Mobile", "Server", "Unknown"];
    return order.map((category) => {
      const members = (data.devices ?? []).filter((row) => categorizeDevice(row) === category);
      return {
        category,
        sources: members.length,
        requests: members.reduce((sum, row) => sum + num(row.requests), 0),
      };
    });
  }, [data.devices]);

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

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricGroup
          title="Top country"
          icon={Globe2}
          items={[
            { label: geo.topCountry?.name ?? "No data", value: fmtTokens(geo.topCountry?.requests ?? 0) },
            { label: "Countries", value: fmtTokens(geo.countryCount) },
          ]}
          testId="key-network-geo-country"
        />
        <MetricGroup
          title="Top region"
          icon={MapPin}
          items={[
            { label: geo.topRegion?.name ?? "No data", value: fmtTokens(geo.topRegion?.requests ?? 0) },
            { label: "Regions", value: fmtTokens(geo.regionCount) },
          ]}
          testId="key-network-geo-region"
        />
        <MetricGroup
          title="Top city"
          icon={Building2}
          items={[
            { label: geo.topCity?.name ?? "No data", value: fmtTokens(geo.topCity?.requests ?? 0) },
            { label: "Cities", value: fmtTokens(geo.cityCount) },
          ]}
          testId="key-network-geo-city"
        />
        <MetricGroup
          title="Devices"
          icon={MonitorSmartphone}
          items={deviceCategories.slice(0, 2).map((row) => ({
            label: row.category,
            value: fmtTokens(row.requests),
          }))}
          testId="key-network-device-summary"
        />
      </div>

      <SectionFrame
        title="Top IP addresses"
        description="Most active sources with request volume, allow/deny state and last activity."
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

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <SectionFrame
          title="Geographic distribution"
          description="Request share by country of origin."
          testId="key-network-geo-chart"
        >
          <DistributionDonut
            items={geo.countryDonut}
            valueFormat={(value) => `${fmtTokens(value)} req`}
            ariaLabel="Requests by country"
            testId="key-network-geo-donut"
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

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {clientGroups.map((row) => (
          <MetricGroup
            key={row.group}
            title={row.group}
            icon={Network}
            items={[
              { label: "Requests", value: fmtTokens(row.requests), tone: "accent" },
              {
                label: "Seen as",
                value: row.examples.length > 0 ? truncate(row.examples.join(", "), 28) : "—",
              },
            ]}
            testId={`key-network-clients-${row.group.toLowerCase()}`}
          />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <SectionFrame
          title="Client distribution"
          description="SDK, CLI and integration clients hitting this key."
          testId="key-network-clients"
        >
          <DistributionDonut
            items={clientDonut}
            valueFormat={(value) => `${fmtTokens(value)} req`}
            ariaLabel="Requests by client"
            testId="key-network-clients-donut"
          />
        </SectionFrame>

        <SectionFrame
          title="Client identification"
          description="Every client labelled and grouped: SDK, browser, CLI or custom."
          testId="key-network-client-groups"
        >
          <DataTable
            columns={CLIENT_ROW_COLUMNS}
            rows={clients}
            rowKey={(row) => `${row.group}:${row.client}:${row.sdk ?? ""}`}
            testId="key-network-client-table"
            initialSortKey="requests"
          />
        </SectionFrame>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {deviceCategories.map((row) => (
          <MetricGroup
            key={row.category}
            title={row.category}
            icon={MonitorSmartphone}
            items={[
              { label: "Requests", value: fmtTokens(row.requests), tone: "accent" },
              { label: "Sources", value: fmtTokens(row.sources) },
            ]}
            testId={`key-network-devices-${row.category.toLowerCase()}`}
          />
        ))}
      </div>

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
