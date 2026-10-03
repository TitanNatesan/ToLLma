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
