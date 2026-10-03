/** Provider catalog API client (read-only discovery metadata). */

import { apiRequest } from "@/services/api";
import type { CatalogPage, CatalogProvider, CatalogStats } from "@/types/catalog";

const BASE = "/api/v1/catalog";

export function listCatalogProviders(params: {
  search?: string;
  gateway_supported?: boolean;
  active_only?: boolean;
  page?: number;
  page_size?: number;
} = {}): Promise<CatalogPage> {
  const q = new URLSearchParams();
  if (params.search) q.set("search", params.search);
  if (params.gateway_supported !== undefined) q.set("gateway_supported", String(params.gateway_supported));
  if (params.active_only === false) q.set("active_only", "false");
  if (params.page) q.set("page", String(params.page));
  if (params.page_size) q.set("page_size", String(params.page_size));
  const suffix = q.toString();
  return apiRequest<CatalogPage>(`${BASE}/providers${suffix ? `?${suffix}` : ""}`);
}

export function getCatalogProvider(slug: string): Promise<CatalogProvider> {
  return apiRequest<CatalogProvider>(`${BASE}/providers/${encodeURIComponent(slug)}`);
}

export function getCatalogStats(): Promise<CatalogStats> {
  return apiRequest<CatalogStats>(`${BASE}/stats`);
}

/** Models.dev logo for a ToLLma gateway family, or null when none exists. */
export function logoForProviderType(family: string | null | undefined): string | null {
  const id =
    family === "OPENAI" ? "openai"
    : family === "ANTHROPIC_MESSAGES" ? "anthropic"
    : family === "GEMINI" ? "google"
    : family === "VERTEX_AI" ? "google-vertex"
    : family === "BEDROCK_CONVERSE" ? "amazon-bedrock"
    : null;
  return id ? `https://models.dev/logos/${id}.svg` : null;
}
