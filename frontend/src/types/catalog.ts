export interface CatalogProvider {
  id: string;
  slug: string;
  name: string;
  display_name: string | null;
  logo_url: string | null;
  doc_url: string | null;
  api_base_url: string | null;
  npm_package: string | null;
  env_vars: string[];
  source: string;
  gateway_family: string | null;
  gateway_supported: boolean;
  capabilities: Record<string, boolean>;
  model_count: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CatalogPage {
  items: CatalogProvider[];
  total: number;
  page: number;
  page_size: number;
}

export interface CatalogStats {
  total_providers: number;
  active_providers: number;
  inactive_providers: number;
  gateway_supported_providers: number;
  catalog_only_providers: number;
  total_models: number;
  last_sync_at: string | null;
  last_sync_status: string | null;
  sources: string[];
}

/** One credential input the gateway expects for a catalog provider. */
export interface ConnectionTemplateCredentialField {
  key: string;
  label: string;
  required: boolean;
  secret: boolean;
}

/** GET /api/v1/catalog/providers/{slug}/connection-template response. */
export interface ConnectionTemplate {
  slug: string;
  name: string;
  logo_url: string | null;
  api_base_url: string | null;
  doc_url: string | null;
  npm_package: string | null;
  env_vars: string[];
  gateway_family: string | null;
  gateway_supported: boolean;
  suggested_provider_type: string | null;
  suggested_base_url: string | null;
  credential_fields: ConnectionTemplateCredentialField[];
  /** True when derived client-side because the template endpoint 404d. */
  fallback?: boolean;
}
