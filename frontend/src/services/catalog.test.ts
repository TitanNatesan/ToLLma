import { describe, expect, it } from "vitest";
import {
  deriveConnectionTemplate,
  templateCredentials,
  templateFieldToCredentialKey,
} from "@/services/catalog";
import type { CatalogProvider } from "@/types/catalog";

const ROW = {
  id: "1",
  slug: "acme",
  name: "Acme",
  display_name: null,
  logo_url: null,
  doc_url: "https://acme.dev/docs",
  api_base_url: "https://api.acme.dev/v1",
  npm_package: "@ai-sdk/openai-compatible",
  env_vars: ["ACME_API_KEY"],
  source: "modelsdev",
  gateway_family: "CUSTOM",
  gateway_supported: true,
  capabilities: {},
  model_count: 3,
  is_active: true,
  created_at: "",
  updated_at: "",
} as CatalogProvider;

describe("deriveConnectionTemplate", () => {
  it("mirrors the backend template shape (raw env keys, optional base_url)", () => {
    const t = deriveConnectionTemplate(ROW);
    expect(t.suggested_provider_type).toBe("CUSTOM");
    expect(t.suggested_base_url).toBe("https://api.acme.dev/v1");
    expect(t.credential_fields).toEqual([
      { key: "ACME_API_KEY", label: "Acme Api Key", required: true, secret: true },
      { key: "base_url", label: "Base URL", required: false, secret: false },
    ]);
    expect(t.fallback).toBe(true);
  });

  it("nulls the suggested type for catalog-only rows", () => {
    const t = deriveConnectionTemplate({ ...ROW, gateway_family: null, gateway_supported: false });
    expect(t.suggested_provider_type).toBeNull();
  });
});

describe("templateFieldToCredentialKey", () => {
  it("maps env-style keys to adapter keys", () => {
    expect(templateFieldToCredentialKey("OPENAI_API_KEY")).toBe("api_key");
    expect(templateFieldToCredentialKey("AWS_ACCESS_KEY_ID")).toBe("access_key");
    expect(templateFieldToCredentialKey("AWS_SECRET_ACCESS_KEY")).toBe("secret_key");
    expect(templateFieldToCredentialKey("AWS_REGION")).toBe("region");
    expect(templateFieldToCredentialKey("base_url")).toBe("base_url");
  });
});

describe("templateCredentials", () => {
  it("translates field values to adapter credentials", () => {
    const t = deriveConnectionTemplate(ROW);
    expect(
      templateCredentials(t, { ACME_API_KEY: "k", base_url: "https://api.acme.dev/v1" }),
    ).toEqual({ api_key: "k", base_url: "https://api.acme.dev/v1" });
  });
});
