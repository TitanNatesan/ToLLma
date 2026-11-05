"use client";

import { useState } from "react";
import { BookOpen, Eye, EyeOff } from "lucide-react";
import { Field, Input, ProviderLogo } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { ConnectionTemplate } from "@/types/catalog";

/** Host of an API base URL for compact display (falls back to the raw value). */
export function apiBaseHost(baseUrl: string | null | undefined): string | null {
  if (!baseUrl) return null;
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

/**
 * Metadata-driven credential renderer: one component for all catalog
 * providers, no per-provider switch. Secret fields are masked with a
 * show/hide toggle; required fields are flagged; the base-url field shows
 * the suggested default as its placeholder.
 */
export function ConnectionTemplateFields({ template, creds, onChange }: {
  template: ConnectionTemplate;
  creds: Record<string, string>;
  onChange: (key: string, value: string) => void;
}) {
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});
  const host = apiBaseHost(template.api_base_url);

  return (
    <div className="space-y-3" data-testid="connection-template-fields">
      <div className="flex items-center gap-2.5 rounded-lg border border-zinc-200 bg-zinc-50/50 p-2.5 dark:border-zinc-800 dark:bg-zinc-900/30">
        <ProviderLogo logoUrl={template.logo_url} name={template.name} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold">{template.name}</p>
          <p className="truncate font-mono text-[11px] text-zinc-500">
            /{template.slug}
            {host ? ` · ${host}` : ""}
          </p>
        </div>
        {template.doc_url && (
          <a
            href={template.doc_url}
            target="_blank"
            rel="noreferrer"
            aria-label={`${template.name} documentation`}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800"
            data-testid="template-doc-link"
          >
            <BookOpen className="size-3.5" aria-hidden />
          </a>
        )}
      </div>

      {template.fallback && (
        <p
          className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] font-medium text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200"
          data-testid="template-fallback-notice"
        >
          These fields are inferred from catalog metadata and may be incomplete — verify them
          against the provider&apos;s documentation before saving.
        </p>
      )}

      {template.credential_fields.map((f) => {
        const isBaseUrl = f.key === "base_url";
        const shown = showSecrets[f.key] ?? false;
        const placeholder = isBaseUrl
          ? (template.suggested_base_url ?? template.api_base_url ?? "")
          : f.secret
            ? "••••••••••••••••"
            : "";
        return (
          <Field
            key={f.key}
            label={`${f.label}${f.required ? " *" : " (optional)"}`}
          >
            <div className="relative">
              <Input
                type={f.secret && !shown ? "password" : "text"}
                value={creds[f.key] ?? ""}
                onChange={(e) => onChange(f.key, e.target.value)}
                data-testid={`cred-${f.key}`}
                placeholder={placeholder}
                required={f.required}
                aria-required={f.required}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                data-1p-ignore="true"
                data-lpignore="true"
                data-bwignore="true"
                data-form-type="other"
                className={cn("font-mono text-xs", f.secret && "pr-9")}
              />
              {f.secret && (
                <button
                  type="button"
                  onClick={() => setShowSecrets((p) => ({ ...p, [f.key]: !p[f.key] }))}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-zinc-400 transition-colors hover:text-zinc-600 focus:outline-none dark:hover:text-zinc-200"
                  tabIndex={-1}
                  aria-label={shown ? "Hide secret" : "Show secret"}
                  title={shown ? "Hide secret" : "Show secret"}
                >
                  {shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              )}
            </div>
          </Field>
        );
      })}

      {template.credential_fields.length === 0 && (
        <p className="text-xs text-zinc-400" data-testid="template-no-fields">
          No credentials expected for this provider.
        </p>
      )}
    </div>
  );
}
