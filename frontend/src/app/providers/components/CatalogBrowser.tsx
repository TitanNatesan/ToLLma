"use client";

import { useMemo, useState } from "react";
import { BookOpen, CheckCircle2, MinusCircle, Search } from "lucide-react";
import { toast } from "sonner";
import {
  Badge,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  EmptyState,
  Input,
  LoadingState,
  ProviderLogo,
  Select,
  Tooltip,
} from "@/components/ui";
import { useCatalogProviders, useCatalogStats } from "@/hooks/useCatalog";
import { parseApiError } from "@/lib/errors";
import { apiBaseHost } from "./ConnectionTemplateFields";
import type { CatalogProvider } from "@/types/catalog";
import type { ProviderType } from "@/types";

/** One full catalog page (4-col xl grid x 2 rows) fits ~92dvh without scrolling. */
const PAGE_SIZE = 8;

/** Provider catalog browser: search + gateway filter + paginated cards with
 * logos. Catalog entries never hold credentials. Gateway-supported rows
 * configure directly; catalog-only rows with a known API base URL can be
 * configured via the Custom (OpenAI-compatible) gateway; rows without an
 * executable gateway stay disabled. */
export function CatalogBrowser({ onConfigure }: {
  onConfigure: (provider: CatalogProvider, viaCustom: boolean) => void;
}) {
  const [search, setSearch] = useState("");
  const [committed, setCommitted] = useState("");
  const [gateway, setGateway] = useState<"all" | "supported" | "catalog-only">("all");
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<"name" | "models">("name");
  const stats = useCatalogStats();
  const query = useCatalogProviders({ search: committed, gateway, page, pageSize: PAGE_SIZE });
  const total = query.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  // Client-side sort of the current page (server order is opaque).
  const items = useMemo(() => {
    const rows = [...(query.data?.items ?? [])];
    if (sort === "models") rows.sort((a, b) => b.model_count - a.model_count);
    else rows.sort((a, b) => a.name.localeCompare(b.name));
    return rows;
  }, [query.data, sort]);
  const filtersActive = search !== "" || committed !== "" || gateway !== "all" || sort !== "name";
  function clearFilters() {
    setSearch("");
    setCommitted("");
    setGateway("all");
    setSort("name");
    setPage(1);
  }

  function submitSearch() {
    setPage(1);
    setCommitted(search);
  }

  return (
    <div className="flex flex-col gap-2" data-testid="catalog-browser">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex min-w-[150px] flex-1 items-center gap-2">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitSearch();
            }}
            placeholder="Search providers by name or slug…"
            data-testid="catalog-search"
            maxLength={120}
          />
          <Button size="sm" variant="outline" onClick={submitSearch} aria-label="Search providers" className="h-9">
            <Search className="size-3.5" aria-hidden />
          </Button>
        </div>
        <Select
          value={gateway}
          onChange={(e) => {
            setGateway(e.target.value as typeof gateway);
            setPage(1);
          }}
          data-testid="catalog-gateway-filter"
          className="h-9 w-32"
          aria-label="Filter by gateway support"
        >
          <option value="all">All providers</option>
          <option value="supported">Gateway supported</option>
          <option value="catalog-only">Catalog only</option>
        </Select>
        <Select
          value={sort}
          onChange={(e) => {
            setSort(e.target.value as typeof sort);
            setPage(1);
          }}
          data-testid="catalog-sort"
          className="h-9 w-32"
          aria-label="Sort providers"
        >
          <option value="name">Name</option>
          <option value="models">Model count</option>
        </Select>
      </div>

      <p className="text-[11px] text-zinc-500" data-testid="catalog-stats">
        {stats.data
          ? `${stats.data.active_providers} providers · ${stats.data.gateway_supported_providers} gateway-supported · ${stats.data.total_models} models`
          : "Loading catalog…"}
      </p>

      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-zinc-500" data-testid="catalog-results-count">
          {query.data
            ? `Showing ${items.length} of ${total} provider${total === 1 ? "" : "s"}`
            : "Searching catalog…"}
        </p>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-[11px]"
          disabled={!filtersActive}
          onClick={clearFilters}
          data-testid="catalog-clear-filters"
        >
          Clear filters
        </Button>
      </div>

      {query.isLoading && (
        <div className="min-h-48">
          <LoadingState message="Loading providers…" />
        </div>
      )}
      {query.isError && (
        <div className="flex flex-col gap-2">
          <EmptyState
            title="Catalog unavailable"
            description={parseApiError(query.error).message}
          />
          <div>
            <Button size="sm" variant="outline" onClick={() => void query.refetch()} data-testid="catalog-retry">
              Retry
            </Button>
          </div>
        </div>
      )}
      {!query.isLoading && !query.isError && items.length === 0 && (
        <EmptyState title="No providers match" description="Adjust the search or filters." />
      )}

      <div className="grid items-stretch gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {items.map((p) => (
          <CatalogCard key={p.id} provider={p} onConfigure={onConfigure} />
        ))}
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-center gap-2 text-xs text-zinc-500">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((v) => v - 1)}>
            Previous
          </Button>
          <span data-testid="catalog-pages">
            Page {page} of {pages} ({total} providers)
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={page >= pages}
            onClick={() => setPage((v) => v + 1)}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}

export function gatewayFamilyLabel(family: string | null): string {
  if (!family) return "Catalog only";
  return family
    .split("_")
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(" ");
}

function CatalogCard({ provider: p, onConfigure }: {
  provider: CatalogProvider;
  onConfigure: (provider: CatalogProvider, viaCustom: boolean) => void;
}) {
  const supported = p.gateway_supported && !!p.gateway_family;
  const host = apiBaseHost(p.api_base_url ?? null);
  const envVars = p.env_vars ?? [];
  const shownEnvs = envVars.slice(0, 3);
  return (
    <Card className="h-full" data-testid={`catalog-card-${p.slug}`}>
      <CardContent className="flex h-full flex-col gap-2 p-3.5">
        <div className="flex items-start gap-2.5">
          <ProviderLogo logoUrl={p.logo_url} name={p.name} size="md" />
          <div className="min-w-0 flex-1">
            <p className="break-words text-sm font-semibold text-zinc-900 dark:text-zinc-100">{p.name}</p>
            <p className="break-all font-mono text-[11px] text-zinc-500">/{p.slug}</p>
          </div>
        </div>
        {host && (
          <p className="break-all font-mono text-[11px] text-zinc-500" data-testid={`catalog-host-${p.slug}`}>
            {host}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          {supported ? (
            <Badge variant="default" className="gap-1 text-[10px]" title="Request-ready: ToLLma has a gateway adapter for this provider">
              <CheckCircle2 className="size-3" aria-hidden /> Gateway supported
            </Badge>
          ) : (
            <Badge variant="secondary" className="gap-1 text-[10px]" title="Catalog-only: discoverable, but ToLLma has no dedicated adapter for this provider yet">
              <MinusCircle className="size-3" aria-hidden /> Catalog only
            </Badge>
          )}
        </div>
        <p className="break-words text-[11px] text-zinc-500">
          {gatewayFamilyLabel(p.gateway_family)} · {p.model_count} model{p.model_count === 1 ? "" : "s"}
        </p>
        {shownEnvs.length > 0 && (
          <div className="flex flex-wrap items-center gap-1" data-testid={`catalog-env-${p.slug}`}>
            {shownEnvs.map((e) => (
              <code key={e} className="break-all rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[10px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                {e}
              </code>
            ))}
            {envVars.length > shownEnvs.length && (
              <span className="text-[10px] text-zinc-400">+{envVars.length - shownEnvs.length} more</span>
            )}
          </div>
        )}
        <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-1">
          {supported ? (
            <Button
              size="sm"
              className="min-w-[110px] flex-1"
              onClick={() => onConfigure(p, false)}
              data-testid={`catalog-configure-${p.slug}`}
            >
              Configure
            </Button>
          ) : (
            <>
              <Button size="sm" variant="outline" className="min-w-[110px] flex-1" disabled title="No executable gateway yet — configuration will be kept">
                Configure
              </Button>
              {p.api_base_url && (
                <Button
                  size="sm"
                  variant="outline"
                  className="min-w-[110px] flex-1"
                  onClick={() => onConfigure(p, true)}
                  data-testid={`catalog-configure-custom-${p.slug}`}
                  title="Configure via the Custom (OpenAI-compatible) gateway using this provider's API base URL"
                >
                  Via Custom
                </Button>
              )}
            </>
          )}
          {p.doc_url && (
            <Tooltip content={`${p.name} documentation`}>
              <a
                href={p.doc_url}
                target="_blank"
                rel="noreferrer"
                aria-label={`${p.name} documentation`}
                data-testid={`catalog-doc-${p.slug}`}
                className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800"
              >
                <BookOpen className="size-3.5" aria-hidden />
              </a>
            </Tooltip>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/** Catalog browser inside a dialog, launched from the Providers page. */
export function CatalogBrowserDialog({ open, onClose, onConfigure }: {
  open: boolean;
  onClose: () => void;
  onConfigure: (provider: CatalogProvider, family: ProviderType | null, opts?: { viaCustom: boolean }) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(n) => { if (!n) onClose(); }}>
      <DialogContent
        className="max-w-6xl max-h-none overflow-hidden p-4"
        data-testid="catalog-dialog"
      >
        <DialogTitle className="text-sm font-semibold">Provider catalog</DialogTitle>
        <DialogDescription>
          Discovery metadata from Models.dev. Catalog entries never hold credentials;
          gateway-supported providers configure directly, others go through the
          Custom gateway where an API base URL is known.
        </DialogDescription>
        <div className="mt-3">
          {open && (
            <CatalogBrowser
              onConfigure={(p, viaCustom) => {
                if (viaCustom) {
                  if (!p.api_base_url) {
                    toast.error("This provider is catalog-only: no executable gateway yet.");
                    return;
                  }
                  onConfigure(p, "CUSTOM", { viaCustom: true });
                  return;
                }
                const family = (p.gateway_family ?? null) as ProviderType | null;
                if (!p.gateway_supported || !family) {
                  toast.error("This provider is catalog-only: no gateway adapter yet.");
                  return;
                }
                onConfigure(p, family, { viaCustom: false });
              }}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
