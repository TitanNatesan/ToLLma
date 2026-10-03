"use client";

import { useState } from "react";
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
} from "@/components/ui";
import { useCatalogProviders, useCatalogStats } from "@/hooks/useCatalog";
import { parseApiError } from "@/lib/errors";
import type { CatalogProvider } from "@/types/catalog";
import type { ProviderType } from "@/types";

/** Provider catalog browser: search + gateway filter + paginated cards with
 * logos. Configure is offered only for gateway-supported providers; catalog
 * entries never hold credentials. */
export function CatalogBrowser({ onConfigure }: {
  onConfigure: (provider: CatalogProvider) => void;
}) {
  const [search, setSearch] = useState("");
  const [committed, setCommitted] = useState("");
  const [gateway, setGateway] = useState<"all" | "supported" | "catalog-only">("all");
  const [page, setPage] = useState(1);
  const stats = useCatalogStats();
  const query = useCatalogProviders({ search: committed, gateway, page });
  const items = query.data?.items ?? [];
  const total = query.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / 24));

  function submitSearch() {
    setPage(1);
    setCommitted(search);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3" data-testid="catalog-browser">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex min-w-52 flex-1 items-center gap-2">
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
          <Button size="sm" variant="outline" onClick={submitSearch} aria-label="Search providers">
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
          aria-label="Filter by gateway support"
        >
          <option value="all">All providers</option>
          <option value="supported">Gateway supported</option>
          <option value="catalog-only">Catalog only</option>
        </Select>
      </div>

      <p className="text-[11px] text-zinc-500" data-testid="catalog-stats">
        {stats.data
          ? `${stats.data.active_providers} providers · ${stats.data.gateway_supported_providers} gateway-supported · ${stats.data.total_models} models`
          : "Loading catalog…"}
      </p>

      {query.isLoading && <LoadingState />}
      {query.isError && (
        <EmptyState
          title="Catalog unavailable"
          description={parseApiError(query.error).message}
        />
      )}
      {!query.isLoading && !query.isError && items.length === 0 && (
        <EmptyState title="No providers match" description="Adjust the search or filters." />
      )}

      <div className="grid gap-2.5 overflow-y-auto pb-2 sm:grid-cols-2">
        {items.map((p) => (
          <CatalogCard key={p.id} provider={p} onConfigure={onConfigure} />
        ))}
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-between text-xs text-zinc-500">
          <span data-testid="catalog-pages">
            Page {page} of {pages} ({total} providers)
          </span>
          <div className="flex gap-1.5">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((v) => v - 1)}>
              Previous
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={page >= pages}
              onClick={() => setPage((v) => v + 1)}
            >
              Next
            </Button>
          </div>
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
  onConfigure: (provider: CatalogProvider) => void;
}) {
  const supported = p.gateway_supported && !!p.gateway_family;
  return (
    <Card data-testid={`catalog-card-${p.slug}`}>
      <CardContent className="flex gap-3 p-3.5">
        <ProviderLogo logoUrl={p.logo_url} name={p.name} size="md" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">{p.name}</p>
          <p className="truncate font-mono text-[11px] text-zinc-500">/{p.slug}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            {supported ? (
              <Badge variant="default" className="gap-1 text-[10px]">
                <CheckCircle2 className="size-3" aria-hidden /> Gateway supported
              </Badge>
            ) : (
              <Badge variant="secondary" className="gap-1 text-[10px]" title="Discoverable, but ToLLma has no adapter for this provider yet">
                <MinusCircle className="size-3" aria-hidden /> Catalog only
              </Badge>
            )}
            <span className="text-[11px] text-zinc-500">
              {p.model_count} model{p.model_count === 1 ? "" : "s"}
            </span>
          </div>
          <div className="mt-2.5 flex gap-1.5">
            {supported ? (
              <Button
                size="sm"
                onClick={() => onConfigure(p)}
                data-testid={`catalog-configure-${p.slug}`}
              >
                Configure
              </Button>
            ) : (
              <Button size="sm" variant="outline" disabled title="ToLLma has no gateway adapter for this provider yet">
                Configure
              </Button>
            )}
            {p.doc_url && (
              <a
                href={p.doc_url}
                target="_blank"
                rel="noreferrer"
                aria-label={`${p.name} documentation`}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800"
              >
                <BookOpen className="size-3.5" aria-hidden />
              </a>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/** Catalog browser inside a dialog, launched from the Providers page. */
export function CatalogBrowserDialog({ open, onClose, onConfigure }: {
  open: boolean;
  onClose: () => void;
  onConfigure: (provider: CatalogProvider, family: ProviderType | null) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(n) => { if (!n) onClose(); }}>
      <DialogContent className="max-w-3xl p-4" data-testid="catalog-dialog">
        <DialogTitle className="text-sm font-semibold">Provider catalog</DialogTitle>
        <DialogDescription>
          Discovery metadata from Models.dev. Catalog entries never hold credentials;
          Configure is available only where ToLLma has a gateway adapter.
        </DialogDescription>
        <div className="mt-3 max-h-[70vh] overflow-hidden">
          {open && (
            <CatalogBrowser
              onConfigure={(p) => {
                const family = (p.gateway_family ?? null) as ProviderType | null;
                if (!p.gateway_supported || !family) {
                  toast.error("This provider is catalog-only: no gateway adapter yet.");
                  return;
                }
                onConfigure(p, family);
              }}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
