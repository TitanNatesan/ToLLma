"use client";

import { useState } from "react";
import { toast } from "sonner";
import { CREDENTIAL_FIELDS, PROVIDER_TYPES } from "@/app/providers/fields";
import { CheckCircle2, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Field, GhostButton, Input, Select, Switch, Textarea } from "@/components/ui";
import { useModelMutations, useModels, useProviderMutations, useProviders } from "@/hooks/useRegistry";
import type { AIModel, EndpointType, Provider, ProviderType } from "@/types";
import { cn } from "@/lib/utils";

const ENDPOINTS: EndpointType[] = ["responses", "chat_completions", "messages", "converse"];
const CAPS: Array<[string, string]> = [
  ["supports_text", "text"],
  ["supports_vision", "vision"],
  ["supports_audio_input", "audio-in"],
  ["supports_audio_output", "audio-out"],
  ["supports_image_generation", "img-gen"],
  ["supports_tool_calling", "tools"],
  ["supports_reasoning", "reasoning"],
  ["supports_streaming", "streaming"],
];

function CredentialInputs({ type, values, onChange }: { type: ProviderType; values: Record<string, string>; onChange: (v: Record<string, string>) => void }) {
  return (
    <>
      {CREDENTIAL_FIELDS[type].map(([name, spec]) => (
        <Field key={name} label={spec.label + (spec.optional ? " (optional)" : "")}>
          {spec.multiline ? (
            <Textarea rows={3} value={values[name] ?? ""} onChange={(e) => onChange({ ...values, [name]: e.target.value })} data-testid={`cred-${name}`} />
          ) : (
            <Input type={spec.secret ? "password" : "text"} value={values[name] ?? ""} onChange={(e) => onChange({ ...values, [name]: e.target.value })} data-testid={`cred-${name}`} />
          )}
        </Field>
      ))}
    </>
  );
}

interface ModelFormState {
  name: string;
  model_id: string;
  endpoint_type: EndpointType;
  input_price: string;
  output_price: string;
  cache_read_price: string;
  cache_write_price: string;
  context_window: string;
  max_output_tokens: string;
  description: string;
  release_date: string;
  caps: Record<string, boolean>;
}

const EMPTY_MODEL_FORM: ModelFormState = {
  name: "",
  model_id: "",
  endpoint_type: "chat_completions",
  input_price: "0",
  output_price: "0",
  cache_read_price: "0",
  cache_write_price: "0",
  context_window: "",
  max_output_tokens: "",
  description: "",
  release_date: "",
  caps: { supports_text: true, supports_streaming: true },
};

function ModelForm({ initial, onSubmit, onCancel }: { initial: ModelFormState; onSubmit: (f: ModelFormState) => void; onCancel: () => void }) {
  const [form, setForm] = useState(initial);
  const set = (k: keyof ModelFormState, v: string) => setForm((f) => ({ ...f, [k]: v }));
  return (
    <Card data-testid="model-form">
      <CardContent className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Model name">
            <Input value={form.name} onChange={(e) => set("name", e.target.value)} data-testid="madd-name" />
          </Field>
          <Field label="Model ID">
            <Input value={form.model_id} onChange={(e) => set("model_id", e.target.value)} data-testid="madd-model-id" />
          </Field>
          <Field label="Endpoint type">
            <Select value={form.endpoint_type} onChange={(e) => set("endpoint_type", e.target.value)} data-testid="madd-endpoint">
              {ENDPOINTS.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </Select>
          </Field>
          <Field label="Description">
            <Input value={form.description} onChange={(e) => set("description", e.target.value)} data-testid="madd-description" />
          </Field>
          <Field label="Input $/1M">
            <Input value={form.input_price} onChange={(e) => set("input_price", e.target.value)} data-testid="madd-input-price" />
          </Field>
          <Field label="Output $/1M">
            <Input value={form.output_price} onChange={(e) => set("output_price", e.target.value)} data-testid="madd-output-price" />
          </Field>
          <Field label="Cache read $/1M">
            <Input value={form.cache_read_price} onChange={(e) => set("cache_read_price", e.target.value)} data-testid="madd-cache-read" />
          </Field>
          <Field label="Cache write $/1M">
            <Input value={form.cache_write_price} onChange={(e) => set("cache_write_price", e.target.value)} data-testid="madd-cache-write" />
          </Field>
          <Field label="Context window">
            <Input value={form.context_window} onChange={(e) => set("context_window", e.target.value)} data-testid="madd-context" />
          </Field>
          <Field label="Max output tokens">
            <Input value={form.max_output_tokens} onChange={(e) => set("max_output_tokens", e.target.value)} data-testid="madd-max-tokens" />
          </Field>
          <Field label="Release date">
            <Input type="date" value={form.release_date} onChange={(e) => set("release_date", e.target.value)} data-testid="madd-release" />
          </Field>
        </div>
        <fieldset>
          <legend className="text-sm font-medium">Capabilities</legend>
          <div className="mt-1 flex flex-wrap gap-3">
            {CAPS.map(([key, label]) => (
              <label key={key} className="flex items-center gap-1 text-sm">
                <input
                  type="checkbox"
                  checked={!!form.caps[key]}
                  onChange={(e) => setForm((f) => ({ ...f, caps: { ...f.caps, [key]: e.target.checked } }))}
                  data-testid={`madd-cap-${key}`}
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="flex gap-2">
          <Button onClick={() => onSubmit(form)} disabled={!form.name.trim() || !form.model_id.trim()} data-testid="madd-save">
            Save model
          </Button>
          <GhostButton onClick={onCancel}>Cancel</GhostButton>
        </div>
      </CardContent>
    </Card>
  );
}

function toPayload(providerId: string, f: ModelFormState): Record<string, unknown> {
  const caps = Object.fromEntries(CAPS.map(([k]) => [k, !!f.caps[k]]));
  return {
    provider_id: providerId,
    name: f.name.trim(),
    model_id: f.model_id.trim(),
    endpoint_type: f.endpoint_type,
    input_price: f.input_price || "0",
    output_price: f.output_price || "0",
    cache_read_price: f.cache_read_price || "0",
    cache_write_price: f.cache_write_price || "0",
    context_window: f.context_window ? Number(f.context_window) : null,
    max_output_tokens: f.max_output_tokens ? Number(f.max_output_tokens) : null,
    description: f.description || null,
    release_date: f.release_date || null,
    ...caps,
  };
}

function fromModel(m: AIModel): ModelFormState {
  return {
    ...EMPTY_MODEL_FORM,
    name: m.name,
    model_id: m.model_id,
    endpoint_type: m.endpoint_type,
    input_price: m.input_price,
    output_price: m.output_price,
    cache_read_price: m.cache_read_price,
    cache_write_price: m.cache_write_price,
    context_window: m.context_window?.toString() ?? "",
    max_output_tokens: m.max_output_tokens?.toString() ?? "",
    description: m.description ?? "",
    release_date: m.release_date ?? "",
    caps: Object.fromEntries(CAPS.map(([k]) => [k, (m as unknown as Record<string, boolean>)[k]])),
  };
}

export default function ProvidersPage() {
  const { data: providers, isLoading } = useProviders();
  const { data: allModels } = useModels();
  const pm = useProviderMutations();
  const mm = useModelMutations();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Provider | null>(null);
  const [name, setName] = useState("");
  const [type, setType] = useState<ProviderType>("CUSTOM");
  const [creds, setCreds] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [discoverMsg, setDiscoverMsg] = useState<Record<string, string>>({});
  const [showModelForm, setShowModelForm] = useState(false);
  const [editingModel, setEditingModel] = useState<AIModel | null>(null);
  const [providerSearch, setProviderSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<ProviderType | "ALL">("ALL");

  const filteredProviders = (providers ?? []).filter((p) => {
    const matchSearch = !providerSearch || p.name.toLowerCase().includes(providerSearch.toLowerCase());
    const matchType = typeFilter === "ALL" || p.provider_type === typeFilter;
    return matchSearch && matchType;
  });

  const selected = (providers ?? []).find((p) => p.id === selectedId) ?? null;
  const selectedModels = (allModels ?? []).filter((m) => m.provider_id === selectedId);

  function openCreate() {
    setEditing(null);
    setName("");
    setType("CUSTOM");
    setCreds({});
    setShowForm(true);
  }

  function openEdit(p: Provider) {
    setEditing(p);
    setName(p.name);
    setType(p.provider_type);
    setCreds({});
    setShowForm(true);
  }

  // Save -> validate -> discover, with toasts at each step.
  async function save() {
    const credentials = Object.fromEntries(Object.entries(creds).filter(([, v]) => v !== ""));
    setBusy("save");
    try {
      const saved = editing
        ? await pm.update.mutateAsync({ id: editing.id, body: { name, ...(Object.keys(credentials).length ? { credentials } : {}) } })
        : await pm.create.mutateAsync({ name, provider_type: type, credentials });
      setShowForm(false);
      setSelectedId(saved.id);
      toast.success(`Provider ${editing ? "updated" : "created"}`);
      setBusy(`validate:${saved.id}`);
      const result = await pm.validate.mutateAsync(saved.id);
      if (result.valid) {
        toast.success("Credentials valid", { description: `${result.latency_ms.toFixed(0)}ms` });
        setBusy(`discover:${saved.id}`);
        const disc = await pm.discover.mutateAsync(saved.id);
        setDiscoverMsg((s) => ({ ...s, [saved.id]: disc.message }));
        toast.success("Model discovery finished", { description: disc.message });
      } else {
        toast.error("Credentials invalid", { description: result.message });
      }
    } catch (e) {
      toast.error("Save failed", { description: e instanceof Error ? e.message : "unknown error" });
    } finally {
      setBusy(null);
    }
  }

  async function runValidate(id: string) {
    setBusy(`validate:${id}`);
    try {
      const r = await pm.validate.mutateAsync(id);
      r.valid ? toast.success("Credentials valid") : toast.error("Credentials invalid", { description: r.message });
    } finally {
      setBusy(null);
    }
  }

  async function runDiscover(id: string) {
    setBusy(`discover:${id}`);
    try {
      const d = await pm.discover.mutateAsync(id);
      setDiscoverMsg((s) => ({ ...s, [id]: d.message }));
      toast.success("Model discovery finished", { description: d.message });
    } finally {
      setBusy(null);
    }
  }

  function validationBadge(p: Provider) {
    if (p.validation_status === "valid") return <Badge variant="success">Valid</Badge>;
    if (p.validation_status === "invalid") return <Badge variant="destructive">Invalid</Badge>;
    return <Badge>Unvalidated</Badge>;
  }

  return (
    <main className="flex min-h-0 flex-1 gap-4 p-4">
      <section className="flex w-80 shrink-0 flex-col gap-3 overflow-y-auto min-h-[300px]" aria-label="Provider list">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold">Providers</h1>
          <Button size="sm" className="ml-auto gap-1.5" onClick={openCreate} data-testid="add-provider">
            <Plus className="size-3.5" />
            Add
          </Button>
        </div>
        {/* Search + filter */}
        <div className="flex flex-col gap-1.5">
          <Input
            placeholder="Search providers…"
            value={providerSearch}
            onChange={(e) => setProviderSearch(e.target.value)}
            aria-label="Search providers"
            data-testid="provider-search"
            className="h-7 text-xs"
          />
          <div className="flex flex-wrap gap-1">
            {(["ALL", ...PROVIDER_TYPES] as Array<ProviderType | "ALL">).map((t) => (
              <button
                key={t}
                onClick={() => setTypeFilter(t)}
                data-testid={`type-filter-${t}`}
                className={cn(
                  "rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors",
                  typeFilter === t
                    ? "border-zinc-700 bg-zinc-700 text-white dark:border-zinc-300 dark:bg-zinc-300 dark:text-zinc-900"
                    : "border-zinc-200 text-zinc-500 hover:border-zinc-400 dark:border-zinc-700 dark:hover:border-zinc-500",
                )}
              >
                {t === "ALL" ? "All" : t}
              </button>
            ))}
          </div>
        </div>
        {showForm && (
          <Card data-testid="provider-form">
            <CardContent className="flex flex-col gap-3">
              <h2 className="font-semibold">{editing ? "Edit provider" : "Add provider"}</h2>
              <Field label="Name">
                <Input value={name} onChange={(e) => setName(e.target.value)} data-testid="provider-name" />
              </Field>
              {!editing && (
                <Field label="Type">
                  <Select value={type} onChange={(e) => setType(e.target.value as ProviderType)} data-testid="provider-type">
                    {PROVIDER_TYPES.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </Select>
                </Field>
              )}
              <CredentialInputs type={editing?.provider_type ?? type} values={creds} onChange={setCreds} />
              <div className="flex gap-2">
                <Button onClick={save} disabled={!name.trim() || busy === "save"} data-testid="save-provider">
                  {busy === "save" ? "Saving…" : "Save"}
                </Button>
                <GhostButton onClick={() => setShowForm(false)}>Cancel</GhostButton>
              </div>
            </CardContent>
          </Card>
        )}
        {isLoading && <p className="text-sm text-zinc-500">Loading…</p>}
        {filteredProviders.map((p) => {
          const count = (allModels ?? []).filter((m) => m.provider_id === p.id).length;
          return (
            <Card
              key={p.id}
              data-testid={`provider-card-${p.id}`}
              className={cn("cursor-pointer", selectedId === p.id && "ring-2 ring-zinc-500")}
              onClick={() => setSelectedId(p.id)}
            >
              <CardContent className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{p.name}</span>
                  <Badge>{p.provider_type}</Badge>
                  {!p.is_active && <Badge variant="destructive">Inactive</Badge>}
                </div>
                <div className="flex items-center gap-2 text-xs text-zinc-500">
                  {validationBadge(p)}
                  <span data-testid={`model-count-${p.id}`}>{count} model{count === 1 ? "" : "s"}</span>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </section>

      <section className="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto min-h-[300px]" aria-label="Provider details">
        {!selected ? (
          <Card className="m-auto max-w-md text-center" data-testid="no-provider-selected">
            <CardContent>
              <h2 className="font-semibold">Select a provider</h2>
              <p className="mt-1 text-sm text-zinc-500">Choose a provider to manage its credentials and models.</p>
            </CardContent>
          </Card>
        ) : (
          <>
            <Card data-testid="provider-detail">
              <CardHeader>
                <CardTitle>{selected.name}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge>{selected.provider_type}</Badge>
                  {validationBadge(selected)}
                  {selected.last_validated_at && (
                    <span className="text-xs text-zinc-500" data-testid={`validation-time-${selected.id}`} title={selected.validation_message ?? ""}>
                      checked {new Date(selected.last_validated_at).toLocaleString()}
                    </span>
                  )}
                </div>
                {selected.validation_message && (
                  <p className="text-xs text-zinc-500" data-testid={`validation-${selected.id}`}>{selected.validation_message}</p>
                )}
                <dl className="grid grid-cols-2 gap-x-4 text-xs text-zinc-500">
                  {Object.entries(selected.credentials_masked).map(([k, v]) => (
                    <div key={k} className="flex gap-2"><dt>{k}:</dt><dd>{v}</dd></div>
                  ))}
                </dl>
                <div className="flex flex-wrap gap-2">
                  <GhostButton size="sm" className="gap-1.5" onClick={() => runValidate(selected.id)} disabled={busy !== null} data-testid={`validate-${selected.id}`}>
                    <CheckCircle2 className="size-3.5" />
                    {busy === `validate:${selected.id}` ? "Checking…" : "Validate"}
                  </GhostButton>
                  <GhostButton size="sm" className="gap-1.5" onClick={() => runDiscover(selected.id)} disabled={busy !== null} data-testid={`discover-${selected.id}`}>
                    <RefreshCw className={cn("size-3.5", busy === `discover:${selected.id}` && "animate-spin")} />
                    {busy === `discover:${selected.id}` ? "Discovering…" : "Refresh models"}
                  </GhostButton>
                  <GhostButton size="sm" className="gap-1.5" onClick={() => openEdit(selected)}>
                    <Pencil className="size-3.5" />
                    Edit
                  </GhostButton>
                  <GhostButton size="sm" className="gap-1.5 text-red-600 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/20" onClick={() => { pm.remove.mutate(selected.id); setSelectedId(null); toast.success("Provider deleted"); }}>
                    <Trash2 className="size-3.5" />
                    Delete
                  </GhostButton>
                </div>
                {discoverMsg[selected.id] && (
                  <p className="text-xs text-zinc-500" data-testid={`discover-result-${selected.id}`}>{discoverMsg[selected.id]}</p>
                )}
              </CardContent>
            </Card>

            <div className="flex items-center gap-2">
              <h2 className="font-semibold">Models</h2>
              <Button size="sm" className="ml-auto gap-1.5" onClick={() => { setEditingModel(null); setShowModelForm(true); }} data-testid="add-model">
                <Plus className="size-3.5" />
                Add model
              </Button>
            </div>
            {showModelForm && (
              <ModelForm
                initial={editingModel ? fromModel(editingModel) : EMPTY_MODEL_FORM}
                onCancel={() => { setShowModelForm(false); setEditingModel(null); }}
                onSubmit={async (f) => {
                  try {
                    if (editingModel) {
                      const { model_id: _omit, provider_id: _omit2, ...rest } = toPayload(selected.id, f);
                      await mm.update.mutateAsync({ id: editingModel.id, body: rest });
                      toast.success("Model updated");
                    } else {
                      await mm.create.mutateAsync(toPayload(selected.id, f));
                      toast.success("Model created");
                    }
                    setShowModelForm(false);
                    setEditingModel(null);
                  } catch (e) {
                    toast.error("Save failed", { description: e instanceof Error ? e.message : "unknown error" });
                  }
                }}
              />
            )}
            <div className="grid gap-3 xl:grid-cols-2">
              {selectedModels.map((m) => (
                <Card key={m.id} data-testid={`model-row-${m.id}`} className={cn(!m.is_active && "opacity-60")}>
                  <CardContent className="flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{m.name}</span>
                      <Badge>{m.endpoint_type}</Badge>
                      {!m.is_active && <Badge variant="destructive">Disabled</Badge>}
                      <label className="ml-auto flex items-center gap-1 text-xs">
                        <Switch
                          checked={m.is_active}
                          onCheckedChange={(v) => mm.update.mutate({ id: m.id, body: { is_active: v } })}
                          aria-label={`Enable ${m.name}`}
                          data-testid={`model-toggle-${m.id}`}
                        />
                        {m.is_active ? "On" : "Off"}
                      </label>
                    </div>
                    <p className="text-xs text-zinc-500">
                      {m.model_id} · in ${m.input_price}/1M · out ${m.output_price}/1M
                      {m.context_window ? ` · ctx ${m.context_window}` : ""}
                      {m.max_output_tokens ? ` · max ${m.max_output_tokens}` : ""}
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {CAPS.filter(([k]) => (m as unknown as Record<string, boolean>)[k]).map(([, label]) => (
                        <Badge key={label}>{label}</Badge>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <GhostButton size="sm" className="gap-1.5" onClick={() => { setEditingModel(m); setShowModelForm(true); }} data-testid={`model-edit-${m.id}`}>
                        <Pencil className="size-3.5" />
                        Edit
                      </GhostButton>
                      <GhostButton size="sm" className="gap-1.5 text-red-600 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/20" onClick={() => mm.remove.mutate(m.id)} data-testid={`model-delete-${m.id}`}>
                        <Trash2 className="size-3.5" />
                        Delete
                      </GhostButton>
                    </div>
                  </CardContent>
                </Card>
              ))}
              {selectedModels.length === 0 && !showModelForm && (
                <p className="text-sm text-zinc-500" data-testid="no-models">No models yet — refresh to discover, or add one manually.</p>
              )}
            </div>
          </>
        )}
      </section>
    </main>
  );
}
