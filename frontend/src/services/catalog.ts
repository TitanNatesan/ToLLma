/** Provider catalog API client (read-only discovery metadata). */

import { ApiError, apiRequest } from "@/services/api";
import type {
  CatalogPage,
  CatalogProvider,
  CatalogStats,
  ConnectionTemplate,
  ConnectionTemplateCredentialField,
} from "@/types/catalog";

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

/** Connection template for wiring a catalog entry into the provider wizard. */
export function getConnectionTemplate(slug: string): Promise<ConnectionTemplate> {
  return apiRequest<ConnectionTemplate>(`${BASE}/providers/${encodeURIComponent(slug)}/connection-template`, {
    method: "POST",
  });
}

/** Backend label derivation mirror: `ACME_API_KEY` -> `Acme Api Key`. */
function envVarLabel(envVar: string): string {
  const titled = envVar
    .replace(/_/g, " ")
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
  return titled || envVar;
}

/**
 * Adapter credential key for a template field key. The template carries raw
 * env var names (`OPENAI_API_KEY`); gateway adapters expect canonical keys
 * (`api_key`, `access_key`, …). One translator, used by every submit path.
 */
export function templateFieldToCredentialKey(key: string): string {
  const v = key.toUpperCase();
  if (v === "BASE_URL") return "base_url";
  if (v.includes("API_KEY")) return "api_key";
  if (v.includes("SECRET_ACCESS") || v.includes("SECRET_KEY")) return "secret_key";
  if (v.includes("ACCESS_KEY")) return "access_key";
  if (v === "REGION" || v.endsWith("_REGION")) return "region";
  if (v.includes("PROJECT_ID")) return "project_id";
  if (v.includes("LOCATION")) return "location";
  if (v.includes("CREDENTIALS")) return "credentials_json";
  return key.toLowerCase();
}

/** Template field values -> adapter credentials (translated keys, last wins). */
export function templateCredentials(
  template: ConnectionTemplate,
  creds: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of template.credential_fields ?? []) {
    const v = creds[f.key] ?? "";
    if (v === "") continue;
    out[templateFieldToCredentialKey(f.key)] = v;
  }
  return out;
}

/**
 * Client-side fallback when the template endpoint 404s (backend not yet
 * deployed): derives the same shape from the catalog row — raw env var names
 * as credential fields (Title Case labels), api_base_url as the optional
 * base-url field. Mirrors the backend template builder exactly.
 */
export function deriveConnectionTemplate(row: CatalogProvider): ConnectionTemplate {
  const credential_fields: ConnectionTemplateCredentialField[] = (row.env_vars ?? []).map((env) => ({
    key: env,
    label: envVarLabel(env),
    required: true,
    secret: true,
  }));
  if (row.api_base_url) {
    credential_fields.push({
      key: "base_url",
      label: "Base URL",
      required: false,
      secret: false,
    });
  }
  return {
    slug: row.slug,
    name: row.name,
    logo_url: row.logo_url,
    api_base_url: row.api_base_url,
    doc_url: row.doc_url,
    npm_package: row.npm_package,
    env_vars: row.env_vars ?? [],
    gateway_family: row.gateway_family,
    gateway_supported: row.gateway_supported,
    suggested_provider_type: row.gateway_supported ? row.gateway_family : null,
    suggested_base_url: row.api_base_url,
    credential_fields,
    fallback: true,
  };
}

/**
 * Template with graceful degradation: backend endpoint first, catalog-row
 * derivation on 404 (or any failure — the row fetch doubles as the fallback
 * source, so only non-404 errors without a row propagate).
 */
export async function getConnectionTemplateWithFallback(slug: string): Promise<ConnectionTemplate> {
  try {
    return await getConnectionTemplate(slug);
  } catch (e) {
    if (!(e instanceof ApiError) || e.status !== 404) {
      // Non-404 (network/auth): still try the row-derived template before failing.
      try {
        return deriveConnectionTemplate(await getCatalogProvider(slug));
      } catch {
        throw e;
      }
    }
    return deriveConnectionTemplate(await getCatalogProvider(slug));
  }
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
