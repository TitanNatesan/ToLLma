"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ComponentType,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, ErrorState, PageHeader } from "@/components/ui";
import { ADMIN_SECTIONS, ADMIN_SECTION_IDS, type AdminSectionId } from "@/components/Sidebar/SidebarAdmin";
import { useAuthStore } from "@/store/auth";
import { cn } from "@/lib/utils";
import {
  getAdminApiKeys,
  getAdminCache,
  getAdminCosts,
  getAdminDashboard,
  getAdminErrors,
  getAdminHealth,
  getAdminMedia,
  getAdminModels,
  getAdminProviders,
  getAdminTokens,
  getAdminUsage,
  getAdminUsers,
  isForbiddenError,
} from "@/services/admin";
import type { AdminPreset, AdminQueryParams } from "@/types/admin";
import { ApiKeysSection } from "./components/ApiKeysSection";
import { CacheSection } from "./components/CacheSection";
import { CatalogSection } from "./components/CatalogSection";
import { CostsSection } from "./components/CostsSection";
import { ErrorsSection } from "./components/ErrorsSection";
import { fmtDateTime } from "./components/format";
import { ForbiddenState } from "./components/ForbiddenState";
import { HealthSection } from "./components/HealthSection";
import { MediaSection } from "./components/MediaSection";
import { ModelsSection } from "./components/ModelsSection";
import { OverviewSection } from "./components/OverviewSection";
import { ProvidersSection } from "./components/ProvidersSection";
import { RangePicker } from "./components/RangePicker";
import { SectionSkeleton } from "./components/Skeletons";
import { TokensSection } from "./components/TokensSection";
import { UsageSection } from "./components/UsageSection";
import { UsersSection } from "./components/UsersSection";

function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

function adminQueryKey(endpoint: string, params: AdminQueryParams): readonly unknown[] {
  return [
    "admin",
    endpoint,
    params.preset,
    params.timezone,
    params.granularity ?? "",
    params.limit ?? 0,
    params.search ?? "",
  ];
}

/** Range-scoped admin query; every section loads in parallel on mount. */
function useAdminQuery<T>(
  endpoint: string,
  params: AdminQueryParams,
  fetcher: (params: AdminQueryParams) => Promise<T>,
  enabled: boolean,
) {
  return useQuery({
    queryKey: adminQueryKey(endpoint, params),
    queryFn: () => fetcher(params),
    enabled,
  });
}

interface SectionQuery {
  isPending: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => unknown;
}

/** Per-section load state: skeleton while pending, retryable error otherwise. */
function SectionBody({
  query,
  children,
  degrade = false,
}: {
  query: SectionQuery;
  children: ReactNode;
  /** Let the section render its own empty state instead of a hard error. */
  degrade?: boolean;
}) {
  if (query.isPending) return <SectionSkeleton />;
  if (query.isError && !degrade) {
    return (
      <ErrorState
        title="Admin analytics unavailable"
        message={
          query.error instanceof Error ? query.error.message : "Could not load this section."
        }
        onRetry={() => void query.refetch()}
      />
    );
  }
  return <>{children}</>;
}

/** Stacked-section heading; the accent chip tracks the section in view. */
function SectionHeading({
  id,
  label,
  icon: Icon,
  active,
}: {
  id: AdminSectionId;
  label: string;
  icon: ComponentType<{ className?: string }>;
  active: boolean;
}) {
  return (
    <div className="mb-4 flex items-center gap-2.5">
      <span
        aria-hidden="true"
        className={cn(
          "flex size-7 items-center justify-center rounded-lg border transition-colors",
          active
            ? "border-tollma-200 bg-tollma-50 text-tollma-700 dark:border-tollma-900 dark:bg-tollma-950/50 dark:text-tollma-300"
            : "border-zinc-200 bg-white text-zinc-400 dark:border-zinc-800 dark:bg-zinc-950",
        )}
      >
        <Icon className="size-3.5" />
      </span>
      <h2
        id={`admin-section-${id}`}
        className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50"
      >
        {label}
      </h2>
    </div>
  );
}

export default function AdminPage() {
  const user = useAuthStore((state) => state.user);
  const isAdmin = user?.platform_role === "platform_admin";

  const [preset, setPreset] = useState<AdminPreset>("last_7d");
  const [modelSearch, setModelSearch] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const debouncedModelSearch = useDebounced(modelSearch);
  const debouncedUserSearch = useDebounced(userSearch);

  // Pinned UTC keeps server bucket boundaries deterministic for all viewers.
  const params = useMemo<AdminQueryParams>(
    () => ({ preset, timezone: "UTC", granularity: "day", limit: 10 }),
    [preset],
  );
  const modelParams = useMemo<AdminQueryParams>(
    () => ({ ...params, limit: 25, search: debouncedModelSearch.trim() || undefined }),
    [params, debouncedModelSearch],
  );
  const userParams = useMemo<AdminQueryParams>(
    () => ({ ...params, limit: 25, search: debouncedUserSearch.trim() || undefined }),
    [params, debouncedUserSearch],
  );

  const enabled = isAdmin;
  const dashboard = useAdminQuery("dashboard", params, getAdminDashboard, enabled);
  const usage = useAdminQuery("usage", params, getAdminUsage, enabled);
  const costs = useAdminQuery("costs", params, getAdminCosts, enabled);
  const tokens = useAdminQuery("tokens", params, getAdminTokens, enabled);
  const providers = useAdminQuery("providers", params, getAdminProviders, enabled);
  const models = useAdminQuery("models", modelParams, getAdminModels, enabled);
  const users = useAdminQuery("users", userParams, getAdminUsers, enabled);
  const media = useAdminQuery("media", params, getAdminMedia, enabled);
  const cache = useAdminQuery("cache", params, getAdminCache, enabled);
  const errors = useAdminQuery("errors", params, getAdminErrors, enabled);
  const health = useAdminQuery("health", params, getAdminHealth, enabled);
  const apiKeys = useAdminQuery("api-keys", params, getAdminApiKeys, enabled);

  const queries = [
    dashboard,
    usage,
    costs,
    tokens,
    providers,
    models,
    users,
    media,
    cache,
    errors,
    health,
    apiKeys,
  ];
  const forbidden = !isAdmin || queries.some((query) => isForbiddenError(query.error));
  const refreshing = queries.some((query) => query.isFetching);

  // Bulk retry surfaces only when multiple sections fail at once; per-section
  // retry in SectionBody stays the recovery path for a single failure.
  const failedQueries = queries.filter(
    (query) => query.isError && !isForbiddenError(query.error),
  );
  const failedCount = failedQueries.length;
  const showRetryAll = !forbidden && failedCount >= 2;
  const retryAllFailed = () => {
    void Promise.allSettled(failedQueries.map((query) => query.refetch()));
  };

  // The URL hash is the single source of truth for which section renders.
  // Deep links (`/admin#tokens`) and sidebar clicks both drive it.
  const activeId = useHashSection();

  const queryClient = useQueryClient();
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["admin"] });

  const pageHeader = (
    <PageHeader
      title="Platform admin"
      subtitle="Aggregated platform telemetry — usage, spend, tokens, media and health. Message content is never exposed."
      badges={isAdmin ? <Badge variant="warning">Admin</Badge> : undefined}
      actions={
        <>
          {showRetryAll && (
            <Button
              variant="outline"
              size="sm"
              onClick={retryAllFailed}
              data-testid="admin-retry-all"
            >
              Retry all failed ({failedCount})
            </Button>
          )}
          <RangePicker
            preset={preset}
            onPreset={setPreset}
            range={dashboard.data?.range}
            onRefresh={refresh}
            refreshing={refreshing}
            disabled={!isAdmin}
          />
        </>
      }
      className="sticky top-0 z-20"
    />
  );

  if (forbidden) {
    return (
      <main
        className="flex min-w-0 flex-1 flex-col overflow-y-auto scroll-smooth bg-white dark:bg-zinc-950"
        data-testid="admin-page"
      >
        {pageHeader}
        <div className="p-4">
          <ForbiddenState onRetry={isAdmin ? refresh : undefined} />
        </div>
      </main>
    );
  }

  function sectionQuery(id: AdminSectionId): SectionQuery {
    switch (id) {
      case "overview":
        return dashboard;
      case "usage":
        return usage;
      case "costs":
        return costs;
      case "tokens":
        return tokens;
      case "providers":
        return providers;
      case "models":
        return models;
      case "users":
        return users;
      case "media":
        return media;
      case "cache":
        return cache;
      case "errors":
        return errors;
      case "health":
        return health;
      case "api-keys":
        return apiKeys;
      case "catalog":
        // Self-loading section (global catalog scope, no time range).
        return { isPending: false, isError: false, error: null, refetch: () => {} };
    }
  }

  function renderSectionBody(id: AdminSectionId): ReactNode {
    switch (id) {
      case "overview":
        return dashboard.data ? <OverviewSection data={dashboard.data} /> : null;
      case "usage":
        return usage.data ? <UsageSection data={usage.data} /> : null;
      case "costs":
        return costs.data ? <CostsSection data={costs.data} /> : null;
      case "tokens":
        return tokens.data ? <TokensSection data={tokens.data} /> : null;
      case "providers":
        return providers.data ? <ProvidersSection data={providers.data} /> : null;
      case "catalog":
        return <CatalogSection />;
      case "models":
        return models.data ? (
          <ModelsSection
            data={models.data}
            search={modelSearch}
            onSearchChange={setModelSearch}
            refreshing={models.isFetching}
          />
        ) : null;
      case "users":
        return users.data ? (
          <UsersSection
            data={users.data}
            search={userSearch}
            onSearchChange={setUserSearch}
            refreshing={users.isFetching}
          />
        ) : null;
      case "media":
        return media.data ? <MediaSection data={media.data} /> : null;
      case "cache":
        return cache.data ? <CacheSection data={cache.data} /> : null;
      case "errors":
        return errors.data ? <ErrorsSection data={errors.data} /> : null;
      case "health":
        return health.data ? <HealthSection data={health.data} /> : null;
      case "api-keys":
        return <ApiKeysSection data={apiKeys.data ?? null} error={apiKeys.error} />;
    }
  }

  return (
    <main
      className="flex min-w-0 flex-1 flex-col overflow-y-auto scroll-smooth bg-white dark:bg-zinc-950"
      data-testid="admin-page"
    >
      {pageHeader}

      <div className="space-y-6 px-4 py-6 pb-16">
        {(() => {
          const section = ADMIN_SECTIONS.find(({ id }) => id === activeId) ?? ADMIN_SECTIONS[0];
          return (
            <section
              key={section.id}
              id={section.id}
              aria-labelledby={`admin-section-${section.id}`}
              data-testid={`admin-panel-${section.id}`}
            >
              <SectionHeading
                id={section.id}
                label={section.label}
                icon={section.icon}
                active
              />
              <SectionBody query={sectionQuery(section.id)} degrade={section.id === "api-keys"}>
                {renderSectionBody(section.id)}
              </SectionBody>
            </section>
          );
        })()}

        {dashboard.data && (
          <p className="text-center text-[10px] text-zinc-400">
            Snapshot generated {fmtDateTime(dashboard.data.generated_at)} ·{" "}
            {dashboard.data.range.timezone} buckets
          </p>
        )}
      </div>
    </main>
  );
}

/** Active admin section from the URL hash (`/admin#tokens`), default overview. */
function useHashSection(): AdminSectionId {
  const subscribe = useCallback((onChange: () => void) => {
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  const getSnapshot = useCallback((): AdminSectionId => {
    const hash = window.location.hash.slice(1);
    return (ADMIN_SECTION_IDS as readonly string[]).includes(hash)
      ? (hash as AdminSectionId)
      : "overview";
  }, []);
  return useSyncExternalStore(subscribe, getSnapshot, () => "overview");
}
