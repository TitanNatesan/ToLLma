"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button, Card, CardContent, Checkbox, Field, Input, Select } from "@/components/ui";
import { lookupRepositoryModel } from "@/services/api";
import type { AIModel } from "@/types";
import { stripTrailingZeros } from "@/lib/utils";
import {
  ENDPOINT_OPTIONS,
  endpointTypeFromWire,
  endpointWireFromLegacy,
  resolveWireEndpoint,
} from "@/app/providers/fields";

export const CAPS: Array<[string, string]> = [
  ["supports_text", "text"],
  ["supports_vision", "vision"],
  ["supports_audio_input", "audio-in"],
  ["supports_audio_output", "audio-out"],
  ["supports_image_generation", "img-gen"],
  ["supports_tool_calling", "tools"],
  ["supports_reasoning", "reasoning"],
  ["supports_embeddings", "embeddings"],
  ["supports_streaming", "streaming"],
];

export interface ModelFormState {
  name: string;
  model_id: string;
  /** Primary endpoint as a wire path (e.g. "responses", "images/generations"). */
  primary_endpoint: string;
  supported_endpoints: string[];
  input_price: string;
  output_price: string;
  cache_read_price: string;
  cache_write_price: string;
  context_window: string;
  max_output_tokens: string;
  description: string;
  release_date: string;
  repository_model_key: string;
  caps: Record<string, boolean>;
  // Extended composer capabilities, stored in the model's metadata JSONB
  // (no extra columns). reasoning_levels is comma-separated editor text.
  meta: { supports_files: boolean; supports_video_input: boolean; reasoning_levels: string };
  // Untouched metadata keys (repository_snapshot, repository_match, …) that
  // must survive the full-replace PATCH on update.
  existingMetadata: Record<string, unknown>;
}

export const EMPTY_MODEL_FORM: ModelFormState = {
  name: "",
  model_id: "",
  primary_endpoint: "chat_completions",
  supported_endpoints: ["chat_completions"],
  input_price: "0",
  output_price: "0",
  cache_read_price: "0",
  cache_write_price: "0",
  context_window: "",
  max_output_tokens: "",
  description: "",
  release_date: "",
  repository_model_key: "",
  caps: { supports_text: true, supports_streaming: true },
  meta: { supports_files: false, supports_video_input: false, reasoning_levels: "" },
  existingMetadata: {},
};

/** Read extended composer capabilities out of model/suggestion metadata. */
export function metaFromRecord(source: unknown): ModelFormState["meta"] {
  const md = (source as { metadata?: unknown } | null)?.metadata;
  const m = (md && typeof md === "object" ? md : {}) as Record<string, unknown>;
  const levels = Array.isArray(m.reasoning_levels)
    ? m.reasoning_levels.filter((l): l is string => typeof l === "string")
    : [];
  return {
    supports_files: m.supports_files === true,
    supports_video_input: m.supports_video_input === true,
    reasoning_levels: levels.join(", "),
  };
}

function parseLevels(text: string): string[] {
  return text.split(",").map((s) => s.trim()).filter(Boolean);
}

export function ModelForm({
  initial,
  onSubmit,
  onCancel,
}: {
  initial: ModelFormState;
  onSubmit: (f: ModelFormState) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState(initial);
  const [repoQuery, setRepoQuery] = useState("");
  const [importing, setImporting] = useState(false);
  const set = (k: keyof ModelFormState, v: string) =>
    setForm((f) => ({ ...f, [k]: v }));
  const setPrimaryEndpoint = (value: string) =>
    setForm((f) => ({
      ...f,
      primary_endpoint: value,
      supported_endpoints: f.supported_endpoints.includes(value)
        ? f.supported_endpoints
        : [value, ...f.supported_endpoints],
    }));

  async function importFromRepository() {
    const q = repoQuery.trim() || form.model_id.trim();
    if (!q) {
      toast.error("Enter a model ID to search the repository");
      return;
    }
    setImporting(true);
    try {
      const { entry, suggested } = await lookupRepositoryModel(q);
      const str = (v: unknown, fallback = "") =>
        v === null || v === undefined ? fallback : String(v);
      setForm((f) => {
        const isSpecialized = f.primary_endpoint !== "chat_completions";
        const repoEndpoint =
          endpointWireFromLegacy(str(suggested.primary_endpoint)) ??
          endpointWireFromLegacy(str(suggested.endpoint_type)) ??
          f.primary_endpoint;
        const endpoint = isSpecialized && repoEndpoint === "chat_completions" ? f.primary_endpoint : repoEndpoint;
        const repoSupported = Array.isArray(suggested.supported_endpoints)
          ? suggested.supported_endpoints.filter((v): v is string => typeof v === "string")
          : [];
        const supported = repoSupported.length ? repoSupported : f.supported_endpoints;
        return {
          ...f,
          name: str(suggested.name, f.name),
          model_id: str(suggested.model_id, f.model_id),
          primary_endpoint: endpoint,
          supported_endpoints: supported.includes(endpoint) ? supported : [endpoint, ...supported],
          input_price: stripTrailingZeros(suggested.input_price, f.input_price),
          output_price: stripTrailingZeros(suggested.output_price, f.output_price),
          cache_read_price: stripTrailingZeros(suggested.cache_read_price, f.cache_read_price),
          cache_write_price: stripTrailingZeros(suggested.cache_write_price, f.cache_write_price),
        context_window: str(suggested.context_window),
        max_output_tokens: str(suggested.max_output_tokens),
        description: str(suggested.description),
        release_date: str(suggested.release_date),
        repository_model_key: entry.model_key,
        caps: Object.fromEntries(
          CAPS.map(([k]) => [k, !!(suggested as Record<string, unknown>)[k]]),
        ),
        meta: metaFromRecord({ metadata: (suggested as Record<string, unknown>).metadata }),
        // Top-level reasoning_options (see fromSuggested): preserve for chat.
        existingMetadata: {
          ...(((suggested as Record<string, unknown>).metadata ?? {}) as Record<string, unknown>),
          ...(Array.isArray((suggested as Record<string, unknown>).reasoning_options)
            ? { reasoning_options: (suggested as Record<string, unknown>).reasoning_options }
            : {}),
        },
      };
    });
      toast.success(`Imported ${entry.display_name ?? entry.model_key} from repository`);
    } catch {
      toast.error("No repository match — enter details manually");
    } finally {
      setImporting(false);
    }
  }

  return (
    <Card data-testid="model-form" className="shadow-lg border-zinc-300 dark:border-zinc-700">
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex gap-2">
          <Input
            placeholder="Search Model Intelligence Repository…"
            value={repoQuery}
            onChange={(e) => setRepoQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void importFromRepository()}
            data-testid="madd-repo-search"
          />
          <Button
            onClick={() => void importFromRepository()}
            disabled={importing}
            data-testid="madd-repo-import"
            className="shrink-0 text-xs"
          >
            {importing ? "Importing…" : "Import"}
          </Button>
        </div>
        {form.repository_model_key && (
          <p className="text-xs text-zinc-500 font-mono" data-testid="madd-repo-key">
            Linked to repository: {form.repository_model_key} (edits are overrides)
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Model name">
            <Input
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              data-testid="madd-name"
            />
          </Field>
          <Field label="Model ID">
            <Input
              value={form.model_id}
              onChange={(e) => set("model_id", e.target.value)}
              data-testid="madd-model-id"
            />
          </Field>
          <Field label="Primary endpoint">
            <Select
              value={form.primary_endpoint}
              onChange={(e) => setPrimaryEndpoint(e.target.value)}
              data-testid="madd-endpoint"
            >
              {ENDPOINT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Description">
            <Input
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
              data-testid="madd-description"
            />
          </Field>
          <Field label="Input $/1M">
            <Input
              value={form.input_price}
              onChange={(e) => set("input_price", e.target.value)}
              data-testid="madd-input-price"
            />
          </Field>
          <Field label="Output $/1M">
            <Input
              value={form.output_price}
              onChange={(e) => set("output_price", e.target.value)}
              data-testid="madd-output-price"
            />
          </Field>
          <Field label="Cache read $/1M">
            <Input
              value={form.cache_read_price}
              onChange={(e) => set("cache_read_price", e.target.value)}
              data-testid="madd-cache-read"
            />
          </Field>
          <Field label="Cache write $/1M">
            <Input
              value={form.cache_write_price}
              onChange={(e) => set("cache_write_price", e.target.value)}
              data-testid="madd-cache-write"
            />
          </Field>
          <Field label="Context window">
            <Input
              value={form.context_window}
              onChange={(e) => set("context_window", e.target.value)}
              data-testid="madd-context"
            />
          </Field>
          <Field label="Max output tokens">
            <Input
              value={form.max_output_tokens}
              onChange={(e) => set("max_output_tokens", e.target.value)}
              data-testid="madd-max-tokens"
            />
          </Field>
          <Field label="Release date">
            <Input
              type="date"
              value={form.release_date}
              onChange={(e) => set("release_date", e.target.value)}
              data-testid="madd-release"
            />
          </Field>
        </div>
        <fieldset data-testid="madd-supported-endpoints">
          <legend className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-1.5">
            Supported endpoints
          </legend>
          <div className="flex flex-wrap gap-x-4 gap-y-2.5 rounded-lg border border-zinc-200/80 bg-zinc-50/50 p-2.5 dark:border-zinc-800/80 dark:bg-zinc-900/30">
            {ENDPOINT_OPTIONS.map((o) => {
              const isPrimary = form.primary_endpoint === o.value;
              return (
                <Checkbox
                  key={o.value}
                  label={o.label}
                  checked={form.supported_endpoints.includes(o.value)}
                  onChange={(e) => {
                    if (!e.target.checked && isPrimary) return;
                    setForm((f) => ({
                      ...f,
                      supported_endpoints: e.target.checked
                        ? [...f.supported_endpoints, o.value]
                        : f.supported_endpoints.filter((v) => v !== o.value),
                    }));
                  }}
                  data-testid={`madd-supported-endpoint-${o.value}`}
                />
              );
            })}
          </div>
        </fieldset>
        <fieldset>
          <legend className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-1.5">
            Capabilities
          </legend>
          <div className="flex flex-wrap gap-x-4 gap-y-2.5 rounded-lg border border-zinc-200/80 bg-zinc-50/50 p-2.5 dark:border-zinc-800/80 dark:bg-zinc-900/30">
            {CAPS.map(([key, label]) => (
              <Checkbox
                key={key}
                label={label}
                checked={!!form.caps[key]}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    caps: { ...f.caps, [key]: e.target.checked },
                  }))
                }
                data-testid={`madd-cap-${key}`}
              />
            ))}
            <Checkbox
              label="files"
              checked={form.meta.supports_files}
              onChange={(e) =>
                setForm((f) => ({ ...f, meta: { ...f.meta, supports_files: e.target.checked } }))
              }
              data-testid="madd-cap-supports_files"
            />
            <Checkbox
              label="video-in"
              checked={form.meta.supports_video_input}
              onChange={(e) =>
                setForm((f) => ({ ...f, meta: { ...f.meta, supports_video_input: e.target.checked } }))
              }
              data-testid="madd-cap-supports_video_input"
            />
          </div>
        </fieldset>
        <Field label="Reasoning levels (comma-separated, blank = low, medium, high; None is always offered)">
          <Input
            placeholder="low, medium, high"
            value={form.meta.reasoning_levels}
            onChange={(e) =>
              setForm((f) => ({ ...f, meta: { ...f.meta, reasoning_levels: e.target.value } }))
            }
            data-testid="madd-reasoning-levels"
          />
        </Field>
        <div className="flex gap-2 pt-2">
          <Button
            onClick={() => onSubmit(form)}
            disabled={!form.name.trim() || !form.model_id.trim()}
            data-testid="madd-save"
            className="text-xs"
          >
            Save model
          </Button>
          <Button variant="outline" onClick={onCancel} className="text-xs">
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function toPayload(providerId: string, f: ModelFormState): Record<string, unknown> {
  const caps = Object.fromEntries(CAPS.map(([k]) => [k, !!f.caps[k]]));
  const levels = parseLevels(f.meta.reasoning_levels);
  return {
    provider_id: providerId,
    name: f.name.trim(),
    model_id: f.model_id.trim(),
    primary_endpoint: f.primary_endpoint,
    supported_endpoints: f.supported_endpoints,
    endpoint_type: endpointTypeFromWire(f.primary_endpoint),
    input_price: f.input_price || "0",
    output_price: f.output_price || "0",
    cache_read_price: f.cache_read_price || "0",
    cache_write_price: f.cache_write_price || "0",
    context_window: f.context_window ? Number(f.context_window) : null,
    max_output_tokens: f.max_output_tokens ? Number(f.max_output_tokens) : null,
    description: f.description || null,
    release_date: f.release_date || null,
    ...(f.repository_model_key ? { repository_model_key: f.repository_model_key } : {}),
    ...caps,
    metadata: {
      ...f.existingMetadata,
      supports_files: f.meta.supports_files,
      supports_video_input: f.meta.supports_video_input,
      ...(levels.length > 0 ? { reasoning_levels: levels } : { reasoning_levels: undefined }),
    },
  };
}

export function fromModel(m: AIModel): ModelFormState {
  const primary = resolveWireEndpoint(m.primary_endpoint, m.endpoint_type);
  const stored = Array.isArray(m.supported_endpoints) ? m.supported_endpoints : [];
  return {
    ...EMPTY_MODEL_FORM,
    name: m.name,
    model_id: m.model_id,
    primary_endpoint: primary,
    supported_endpoints: stored.includes(primary) ? stored : [primary, ...stored],
    input_price: stripTrailingZeros(m.input_price, "0"),
    output_price: stripTrailingZeros(m.output_price, "0"),
    cache_read_price: stripTrailingZeros(m.cache_read_price, "0"),
    cache_write_price: stripTrailingZeros(m.cache_write_price, "0"),
    context_window: m.context_window?.toString() ?? "",
    max_output_tokens: m.max_output_tokens?.toString() ?? "",
    description: m.description ?? "",
    release_date: m.release_date ?? "",
    repository_model_key: m.repository_model_key ?? "",
    caps: Object.fromEntries(CAPS.map(([k]) => [k, (m as unknown as Record<string, boolean>)[k]])),
    meta: metaFromRecord(m),
    existingMetadata: { ...((m.metadata ?? {}) as Record<string, unknown>) },
  };
}

/** Build a ModelFormState from a repository map suggestion (wizard + import flows). */
export function fromSuggested(
  suggested: Record<string, unknown>,
  repositoryModelKey: string,
  defaultEndpoint?: string,
): ModelFormState {
  const str = (v: unknown, fallback = "") =>
    v === null || v === undefined ? fallback : String(v);
  const endpointCandidate =
    endpointWireFromLegacy(str(suggested.primary_endpoint)) ??
    endpointWireFromLegacy(str(suggested.endpoint_type));
  let endpoint = endpointWireFromLegacy(defaultEndpoint) ?? "chat_completions";
  if (endpointCandidate) {
    endpoint = endpointCandidate;
  }
  if (defaultEndpoint && defaultEndpoint !== "chat_completions" && endpoint === "chat_completions") {
    endpoint = defaultEndpoint;
  }
  const suggestedSupported = Array.isArray(suggested.supported_endpoints)
    ? suggested.supported_endpoints.filter((v): v is string => typeof v === "string")
    : [];
  const supported = [...new Set(suggestedSupported)];
  return {
    ...EMPTY_MODEL_FORM,
    name: str(suggested.name),
    model_id: str(suggested.model_id),
    primary_endpoint: endpoint,
    supported_endpoints: supported.includes(endpoint) ? supported : [endpoint, ...supported],
    input_price: stripTrailingZeros(suggested.input_price, "0"),
    output_price: stripTrailingZeros(suggested.output_price, "0"),
    cache_read_price: stripTrailingZeros(suggested.cache_read_price, "0"),
    cache_write_price: stripTrailingZeros(suggested.cache_write_price, "0"),
    context_window: str(suggested.context_window),
    max_output_tokens: str(suggested.max_output_tokens),
    description: str(suggested.description),
    release_date: str(suggested.release_date),
    repository_model_key: repositoryModelKey,
    caps: Object.fromEntries(CAPS.map(([k]) => [k, !!suggested[k]])),
    meta: metaFromRecord({ metadata: suggested.metadata }),
    // reasoning_options rides at the top level of the suggest payload
    // (not inside metadata): carry it into existingMetadata so the
    // submit payload preserves it for the chat reasoning controls.
    existingMetadata: {
      ...((suggested.metadata ?? {}) as Record<string, unknown>),
      ...(Array.isArray(suggested.reasoning_options)
        ? { reasoning_options: suggested.reasoning_options }
        : {}),
    },
  };
}
