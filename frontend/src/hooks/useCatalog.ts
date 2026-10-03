"use client";

import { useQuery } from "@tanstack/react-query";
import { getCatalogProvider, getCatalogStats, listCatalogProviders } from "@/services/catalog";

export function useCatalogProviders(params: {
  search: string;
  gateway: "all" | "supported" | "catalog-only";
  page: number;
}) {
  const { search, gateway, page } = params;
  return useQuery({
    queryKey: ["catalog", "providers", search, gateway, page],
    queryFn: () =>
      listCatalogProviders({
        search: search.trim() || undefined,
        gateway_supported: gateway === "all" ? undefined : gateway === "supported",
        page,
        page_size: 24,
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
