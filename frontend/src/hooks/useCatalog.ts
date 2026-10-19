"use client";

import { useQuery } from "@tanstack/react-query";
import {
  getCatalogProvider,
  getCatalogStats,
  getConnectionTemplateWithFallback,
  listCatalogProviders,
} from "@/services/catalog";

export function useCatalogProviders(params: {
  search: string;
  gateway: "all" | "supported" | "catalog-only";
  page: number;
  pageSize?: number;
}) {
  const { search, gateway, page, pageSize = 24 } = params;
  return useQuery({
    queryKey: ["catalog", "providers", search, gateway, page, pageSize],
    queryFn: () =>
      listCatalogProviders({
        search: search.trim() || undefined,
        gateway_supported: gateway === "all" ? undefined : gateway === "supported",
        page,
        page_size: pageSize,
      }),
    staleTime: 60_000,
  });
}

export function useCatalogProvider(slug: string | null) {
  return useQuery({
    queryKey: ["catalog", "provider", slug],
    queryFn: () => getCatalogProvider(slug ?? ""),
    enabled: !!slug,
    staleTime: 60_000,
  });
}

export function useCatalogStats() {
  return useQuery({ queryKey: ["catalog", "stats"], queryFn: getCatalogStats, staleTime: 60_000 });
}

/**
 * Connection template for the wizard. Falls back to a catalog-row-derived
 * template when the backend endpoint 404s (parallel backend still landing).
 */
export function useConnectionTemplate(slug: string | null) {
  return useQuery({
    queryKey: ["catalog", "connection-template", slug],
    queryFn: () => getConnectionTemplateWithFallback(slug ?? ""),
    enabled: !!slug,
    staleTime: 60_000,
    retry: false,
  });
}
