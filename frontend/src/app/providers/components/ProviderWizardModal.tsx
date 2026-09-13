"use client";

import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  Field,
  GhostButton,
  Input,
  Select,
  Textarea,
} from "@/components/ui";
import { CREDENTIAL_FIELDS, PROVIDER_TYPES } from "@/app/providers/fields";
import { useProviders, useProviderMutations } from "@/hooks/useRegistry";
import { useChatStore } from "@/store/chat";
import {
  draftValidateProvider,
  mapDiscoveredModels,
  registerProvider,
} from "@/services/api";
import type {
  DraftValidation,
  MappedModel,
  MatchType,
  Provider,
  ProviderType,
} from "@/types";
import { EMPTY_MODEL_FORM, ModelForm, fromSuggested, toPayload, type ModelFormState } from "./ModelForm";
import {
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Cpu,
  Eye,
  EyeOff,
  KeyRound,
  Layers,
  Loader2,
  Pencil,
  Sparkles,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface ProviderWizardModalProps {
  open: boolean;
  onClose: () => void;
  editingProvider?: Provider | null;
  onSaved?: (provider: Provider, discoveryMessage?: string) => void;
}

const PROVIDER_METAS: Record<
  ProviderType,
  { name: string; subtitle: string; iconLabel: string; popular?: boolean }
> = {
  OPENAI_RESPONSES: {
    name: "OpenAI Responses",
    subtitle: "New OpenAI /responses API endpoint",
    iconLabel: "OpenAI",
    popular: true,
  },
  OPENAI_CHAT: {
    name: "OpenAI Chat",
    subtitle: "Standard /v1/chat/completions",
    iconLabel: "OpenAI",
    popular: true,
  },
  ANTHROPIC_MESSAGES: {
    name: "Anthropic",
    subtitle: "Claude models via Anthropic /messages",
    iconLabel: "Anthropic",
    popular: true,
  },
  GEMINI: {
    name: "Google Gemini",
    subtitle: "Gemini Developer API (Google AI Studio)",
    iconLabel: "Gemini",
    popular: true,
  },
  VERTEX_AI: {
    name: "Google Cloud Vertex AI",
    subtitle: "Enterprise GCP Vertex AI endpoints",
    iconLabel: "Vertex",
  },
  BEDROCK_CONVERSE: {
    name: "AWS Bedrock",
    subtitle: "Converse API with IAM credentials",
    iconLabel: "Bedrock",
    popular: true,
  },
  CUSTOM: {
    name: "Custom / Local Gateway",
    subtitle: "vLLM, Ollama, LiteLLM, or OpenAI-compatible gateway",
    iconLabel: "Custom",
  },
};

const STEP_LABELS = ["1. Provider Type", "2. Credentials", "3. Validation", "4. Models", "5. Finish"];
const DRAFT_KEY = "tollma-wizard-draft";const MATCH_BADGE: Record<MatchType, string> = {
  provider_specific: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  global: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  fallback: "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
};
const CAP_FILTERS: Array<[string, string]> = [
  ["supports_text", "text"],
  ["supports_vision", "vision"],
  ["supports_audio_input", "audio-in"],
  ["supports_audio_output", "audio-out"],
  ["supports_image_generation", "img-gen"],
  ["supports_tool_calling", "tools"],
  ["supports_reasoning", "reasoning"],
  ["supports_streaming", "streaming"],
];

interface Draft {
  name: string;
  type: ProviderType;
  description: string;
  creds: Record<string, string>;
  step: number;
}

function loadDraft(): Draft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as Draft) : null;
  } catch {
    return null;
  }
}

interface CredentialFieldProps {
  fieldKey: string;
  spec: { label: string; secret?: boolean; multiline?: boolean; optional?: boolean };
  value: string;
  onChange: (v: string) => void;
  showSecret?: boolean;
  onToggleSecret?: () => void;
}

function CredentialField({
  fieldKey,
  spec,
  value,
  onChange,
  showSecret,
  onToggleSecret,
}: CredentialFieldProps) {
  const [supportsTextSecurity, setSupportsTextSecurity] = useState(true);

  useEffect(() => {
    if (typeof CSS !== "undefined" && typeof CSS.supports === "function") {
      setSupportsTextSecurity(CSS.supports("-webkit-text-security", "disc"));
    }
  }, []);

  const inputType = spec.secret && !showSecret
    ? (supportsTextSecurity ? "text" : "password")
    : "text";

  return (
    <Field label={spec.label + (spec.optional ? " (optional)" : "")}>
      {spec.multiline ? (
        <Textarea
          rows={3}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          data-testid={`cred-${fieldKey}`}
          placeholder={spec.secret ? "••••••••••••••••" : ""}
          name={`tollma_provider_param_${fieldKey}`}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          data-1p-ignore="true"
          data-lpignore="true"
          data-bwignore="true"
          data-form-type="other"
        />
      ) : (
        <div className="relative">
          <Input
            type={inputType}
            style={{
              WebkitTextSecurity: spec.secret && !showSecret ? "disc" : "none",
            } as React.CSSProperties}
            className={cn(
              "font-mono text-xs",
              spec.secret && !showSecret && "credential-masked",
              spec.secret && "pr-9",
            )}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            data-testid={`cred-${fieldKey}`}
            placeholder={spec.secret ? "••••••••••••••••" : ""}
            name={`tollma_provider_param_${fieldKey}`}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            data-1p-ignore="true"
            data-lpignore="true"
            data-bwignore="true"
            data-form-type="other"
          />
          {spec.secret && (
            <button
              type="button"
              onClick={onToggleSecret}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors p-0.5 rounded focus:outline-none"
              tabIndex={-1}
              aria-label={showSecret ? "Hide secret" : "Show secret"}
              title={showSecret ? "Hide secret" : "Show secret"}
            >
              {showSecret ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          )}
        </div>
      )}
    </Field>
  );
}

export function ProviderWizardModal({
  open,
  onClose,
  editingProvider,
  onSaved,
}: ProviderWizardModalProps) {
  const { data: providers = [] } = useProviders();
  const pm = useProviderMutations();
  const queryClient = useQueryClient();
  const { setSelectedProviderId } = useChatStore();
  const isEditing = !!editingProvider;

  // Fresh mount per open (parent remounts via key): initializers restore the draft.
  const [step, setStep] = useState(() => {
    if (isEditing) return 1;
    const d = loadDraft();
    return d?.step && d.step <= 2 ? d.step : 1;
  });
  const [name, setName] = useState(() => (isEditing ? (editingProvider?.name ?? "") : (loadDraft()?.name ?? "")));
  const [type, setType] = useState<ProviderType>(() =>
    isEditing ? (editingProvider?.provider_type ?? "OPENAI_CHAT") : (loadDraft()?.type ?? "OPENAI_CHAT"),
  );
  const [description, setDescription] = useState(() => (isEditing ? "" : (loadDraft()?.description ?? "")));
  const [creds, setCreds] = useState<Record<string, string>>(() => (isEditing ? {} : (loadDraft()?.creds ?? {})));
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [validation, setValidation] = useState<DraftValidation | null>(null);
  const [mapped, setMapped] = useState<MappedModel[] | null>(null);
  const [mapping, setMapping] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [forms, setForms] = useState<Record<string, ModelFormState>>({});
  const [search, setSearch] = useState("");
  const [matchFilter, setMatchFilter] = useState<"ALL" | MatchType>("ALL");
  const [capFilter, setCapFilter] = useState("ALL");
  const [priceFilter, setPriceFilter] = useState<"ALL" | "PRICED" | "FREE">("ALL");
  const [editingModelId, setEditingModelId] = useState<string | null>(null);
  const [bulkEndpoint, setBulkEndpoint] = useState("");
  const [bulkIn, setBulkIn] = useState("");
  const [bulkOut, setBulkOut] = useState("");

  // Auto-save draft progress (steps 1-2 carry the draft; nothing persisted server-side).
  useEffect(() => {
    if (!open || isEditing || step > 2) return;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ name, type, description, creds, step }));
    } catch {
      /* storage full/blocked: draft stays in memory */
    }
  }, [open, isEditing, name, type, description, creds, step]);

  async function runMapping() {
    if (!validation?.valid || mapping) return;
    setMapping(true);
    try {
      const res = await mapDiscoveredModels({
        provider_type: type,
        base_url: creds.base_url || undefined,
        model_ids: validation.discovered.map((d) => d.model_id),
      });
      setMapped(res.mapped);
      setForms(Object.fromEntries(res.mapped.map((m) => [m.model_id, fromSuggested(m.suggested, m.repository_model_key ?? "")])));
      setSelected(new Set(res.mapped.map((m) => m.model_id)));
    } catch (e) {
      toast.error("Model mapping failed", { description: e instanceof Error ? e.message : "Error" });
    } finally {
      setMapping(false);
    }
  }

  const nameTaken = providers.some((p) => p.name.toLowerCase() === name.trim().toLowerCase());
  const requiredCreds = (CREDENTIAL_FIELDS[type] ?? []).filter(([, spec]) => !spec.optional);
  const credsReady = requiredCreds.every(([key]) => (creds[key] ?? "").trim() !== "");

  const filtered = useMemo(() => {
    if (!mapped) return [];
    const q = search.trim().toLowerCase();
    return mapped.filter((m) => {
      if (matchFilter !== "ALL" && m.match_type !== matchFilter) return false;
      if (capFilter !== "ALL" && !(m.suggested[capFilter] as boolean)) return false;
      if (priceFilter !== "ALL") {
        const priced = parseFloat(String(m.suggested.input_price ?? "0")) > 0 || parseFloat(String(m.suggested.output_price ?? "0")) > 0;
        if (priceFilter === "PRICED" && !priced) return false;
        if (priceFilter === "FREE" && priced) return false;
      }
      if (q && !(m.model_id.toLowerCase().includes(q) || String(m.suggested.name ?? "").toLowerCase().includes(q))) return false;
      return true;
    });
  }, [mapped, search, matchFilter, capFilter, priceFilter]);

  const matchStats = useMemo(() => {
    const stats: Record<MatchType, number> = { provider_specific: 0, global: 0, fallback: 0 };
    for (const m of mapped ?? []) if (selected.has(m.model_id)) stats[m.match_type] += 1;
    return stats;
  }, [mapped, selected]);

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function applyBulk() {
    if (selected.size === 0) return;
    setForms((prev) => {
      const next = { ...prev };
      for (const id of selected) {
        const f = next[id];
        if (!f) continue;
        next[id] = {
          ...f,
          endpoint_type: (bulkEndpoint as ModelFormState["endpoint_type"]) || f.endpoint_type,
          input_price: bulkIn !== "" ? bulkIn : f.input_price,
          output_price: bulkOut !== "" ? bulkOut : f.output_price,
        };
      }
      return next;
    });
    toast.success(`Bulk update applied to ${selected.size} models`);
  }

  async function runValidation() {
    setBusy(true);
    try {
      const credentials = Object.fromEntries(Object.entries(creds).filter(([, v]) => v !== ""));
      const res = await draftValidateProvider({ provider_type: type, credentials });
      setValidation(res);
      if (res.valid) toast.success(`Credentials valid — ${res.discovered.length} models found`);
      else toast.error("Validation failed", { description: res.message });
    } catch (e) {
      toast.error("Validation error", { description: e instanceof Error ? e.message : "Error" });
    } finally {
      setBusy(false);
    }
  }

  async function handleRegister() {
    if (!mapped) return;
    setBusy(true);
    try {
      const credentials = Object.fromEntries(Object.entries(creds).filter(([, v]) => v !== ""));
      const matchById = Object.fromEntries(mapped.map((m) => [m.model_id, m]));
      const models = [...selected].map((id) => {
        const { provider_id: _omit, ...rest } = toPayload("wizard", forms[id] ?? fromSuggested(matchById[id].suggested, matchById[id].repository_model_key ?? ""));
        return { ...rest, repository_match: matchById[id].repository_match };
      });
      const res = await registerProvider({
        name: name.trim(),
        provider_type: type,
        description: description.trim() || undefined,
        credentials,
        validation_status: "valid",
        validation_message: validation?.message ?? "validated in wizard",
        models,
      });
      try {
        localStorage.removeItem(DRAFT_KEY);
      } catch {
        /* ignore */
      }
      await queryClient.invalidateQueries({ queryKey: ["providers"] });
      await queryClient.invalidateQueries({ queryKey: ["models"] });
      setSelectedProviderId(res.provider.id);
      toast.success(`Provider registered with ${res.models_created} models`);
      onSaved?.(res.provider, `${res.models_created} models registered`);
      onClose();
    } catch (e) {
      toast.error("Registration failed", { description: e instanceof Error ? e.message : "Error" });
    } finally {
      setBusy(false);
    }
  }

  function close() {
    setShowSecrets({});
    onClose();
  }

  const canNext1 = name.trim() !== "" && !nameTaken;
  const canNext2 = credsReady;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-3xl p-0 overflow-hidden shadow-2xl">
        <form
          data-testid="provider-form"
          className="flex flex-col"
          autoComplete="off"
          onSubmit={(e) => e.preventDefault()}
          data-1p-ignore="true"
          data-lpignore="true"
          data-bwignore="true"
          data-form-type="other"
        >
          <div className="border-b border-zinc-200 px-6 py-4 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-900/60">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                  {isEditing ? "Edit Provider" : "Add Provider Connection"}
                </h2>
                <p className="text-xs text-zinc-500">
                  {isEditing
                    ? "Update provider settings"
                    : "Provider is only registered after step 5 — nothing is saved before that"}
                </p>
              </div>
              <Badge variant="outline" className="text-xs font-mono">
                Step {isEditing ? 1 : step} of 5
              </Badge>
            </div>
            {!isEditing && (
              <div className="mt-3 flex items-center justify-between text-[11px] font-medium text-zinc-400">
                {STEP_LABELS.map((label, i) => (
                  <span key={label} className="flex items-center gap-2">
                    <span className={cn(step === i + 1 && "text-zinc-900 dark:text-zinc-100 font-semibold")}>
                      {label}
                    </span>
                    {i < STEP_LABELS.length - 1 && <ChevronRight className="size-3 text-zinc-300 dark:text-zinc-700" />}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="p-6 space-y-4 max-h-[65vh] overflow-y-auto" data-testid="wizard-step-body">
            {isEditing ? (
              <EditBody
                name={name}
                setName={setName}
                type={type}
                creds={creds}
                setCreds={setCreds}
                busy={busy}
                onSave={() => void handleEditSave()}
              />
            ) : (
              <>
                {step === 1 && (
                  <div className="space-y-4" data-testid="wizard-step-1">
                    <div className="flex items-center gap-2">
                      <Field label="Provider Name">
                        <Input
                          value={name}
                          placeholder={`e.g. Production ${type}`}
                          onChange={(e) => setName(e.target.value)}
                          data-testid="provider-name"
                          autoFocus
                          autoComplete="off"
                          autoCorrect="off"
                          autoCapitalize="none"
                          spellCheck={false}
                          data-1p-ignore="true"
                          data-lpignore="true"
                          data-bwignore="true"
                          data-form-type="other"
                        />
                      </Field>
                      <div className="w-1/2">
                        <Field label="Provider Type">
                          <Select
                            value={type}
                            onChange={(e) => setType(e.target.value as ProviderType)}
                            data-testid="provider-type"
                          >
                            {PROVIDER_TYPES.map((t) => (
                              <option key={t} value={t}>
                                {PROVIDER_METAS[t]?.name ?? t}
                              </option>
                            ))}
                          </Select>
                        </Field>
                      </div>
                    </div>
                    {nameTaken && name.trim() && (
                      <p className="text-xs text-red-500">A provider with this name already exists.</p>
                    )}
                    <Field label="Description (optional)">
                      <Input
                        value={description}
                        placeholder="e.g. Team production key"
                        onChange={(e) => setDescription(e.target.value)}
                        data-testid="provider-description"
                        autoComplete="off"
                        autoCorrect="off"
                        autoCapitalize="none"
                        spellCheck={false}
                        data-1p-ignore="true"
                        data-lpignore="true"
                        data-bwignore="true"
                        data-form-type="other"
                      />
                    </Field>
                    <div className="space-y-2">
                      <label className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                        Select Provider Platform
                      </label>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                        {PROVIDER_TYPES.map((t) => {
                          const meta = PROVIDER_METAS[t];
                          const isSelected = type === t;
                          return (
                            <button
                              key={t}
                              type="button"
                              onClick={() => setType(t)}
                              className={cn(
                                "flex flex-col items-start p-3 rounded-lg border text-left transition-all",
                                isSelected
                                  ? "border-zinc-800 bg-zinc-900 text-white dark:border-zinc-200 dark:bg-zinc-100 dark:text-zinc-900 shadow-sm"
                                  : "border-zinc-200 bg-white hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900/60 dark:hover:border-zinc-700",
                              )}
                            >
                              <div className="flex items-center justify-between w-full">
                                <span className="font-semibold text-xs">{meta.name}</span>
                                {isSelected && <Check className="size-3.5" />}
                              </div>
                              <span className={cn("text-[10px] mt-1 line-clamp-2", isSelected ? "text-zinc-300 dark:text-zinc-600" : "text-zinc-500")}>
                                {meta.subtitle}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}

                {step === 2 && (
                  <div className="space-y-3" data-testid="wizard-step-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                        Authentication & Credentials
                      </span>
                      <span className="text-[11px] text-zinc-400">Keys are stored encrypted on your server</span>
                    </div>
                    {CREDENTIAL_FIELDS[type]?.map(([fieldKey, spec]) => (
                      <CredentialField
                        key={fieldKey}
                        fieldKey={fieldKey}
                        spec={spec}
                        value={creds[fieldKey] ?? ""}
                        onChange={(v) => setCreds((prev) => ({ ...prev, [fieldKey]: v }))}
                        showSecret={showSecrets[fieldKey]}
                        onToggleSecret={() =>
                          setShowSecrets((prev) => ({
                            ...prev,
                            [fieldKey]: !prev[fieldKey],
                          }))
                        }
                      />
                    ))}
                  </div>
                )}

                {step === 3 && (
                  <div className="space-y-3" data-testid="wizard-step-3">
                    <p className="text-xs text-zinc-500">
                      Credentials are tested with a temporary adapter — nothing is saved yet.
                    </p>
                    <Button onClick={() => void runValidation()} disabled={busy} data-testid="wiz-validate">
                      {busy ? <Loader2 className="size-3.5 animate-spin" /> : <KeyRound className="size-3.5" />}
                      <span className="ml-1.5">Validate credentials</span>
                    </Button>
                    {validation && (
                      <div
                        className={cn(
                          "p-3 rounded-lg border text-xs flex items-start gap-2.5",
                          validation.valid
                            ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-200"
                            : "border-red-200 bg-red-50 text-red-900 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-200",
                        )}
                        data-testid="wiz-validation-result"
                      >
                        {validation.valid ? <CheckCircle2 className="size-4 text-emerald-600 shrink-0 mt-0.5" /> : <XCircle className="size-4 text-red-600 shrink-0 mt-0.5" />}
                        <div>
                          <div className="font-semibold">
                            {validation.valid
                              ? `Validation successful — ${validation.discovered.length} models discovered (${validation.latency_ms.toFixed(0)}ms)`
                              : "Validation failed"}
                          </div>
                          {validation.message && <div className="text-[11px] opacity-80 mt-0.5">{validation.message}</div>}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {step === 4 && (
                  <div className="space-y-3" data-testid="wizard-step-4">
                    {mapping || !mapped ? (
                      <p className="text-xs text-zinc-500 flex items-center gap-2">
                        <Loader2 className="size-3.5 animate-spin" /> Mapping discovered models against the repository…
                      </p>
                    ) : (
                      <>
                        <div className="flex flex-wrap items-center gap-2">
                          <Input
                            placeholder="Search models…"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            data-testid="wiz-model-search"
                            className="max-w-48 text-xs"
                          />
                          <Select value={matchFilter} onChange={(e) => setMatchFilter(e.target.value as typeof matchFilter)} data-testid="wiz-match-filter" className="max-w-40 text-xs">
                            <option value="ALL">All matches</option>
                            <option value="provider_specific">Provider-specific</option>
                            <option value="global">Global</option>
                            <option value="fallback">Unknown</option>
                          </Select>
                          <Select value={capFilter} onChange={(e) => setCapFilter(e.target.value)} data-testid="wiz-cap-filter" className="max-w-36 text-xs">
                            <option value="ALL">All caps</option>
                            {CAP_FILTERS.map(([k, label]) => (
                              <option key={k} value={k}>{label}</option>
                            ))}
                          </Select>
                          <Select value={priceFilter} onChange={(e) => setPriceFilter(e.target.value as typeof priceFilter)} data-testid="wiz-price-filter" className="max-w-32 text-xs">
                            <option value="ALL">Any price</option>
                            <option value="PRICED">Priced</option>
                            <option value="FREE">Free</option>
                          </Select>
                          <Button variant="ghost" size="sm" onClick={() => setSelected(new Set(filtered.map((m) => m.model_id)))} data-testid="wiz-select-filtered" className="text-xs">
                            Select filtered ({filtered.length})
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => setSelected((s) => { const n = new Set(s); for (const m of filtered) n.delete(m.model_id); return n; })} data-testid="wiz-deselect-filtered" className="text-xs">
                            Deselect filtered
                          </Button>
                        </div>

                        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-200 p-2 dark:border-zinc-800" data-testid="wiz-bulk-bar">
                            <span className="text-[11px] text-zinc-500">Bulk edit {selected.size} selected:</span>
                            <Select value={bulkEndpoint} onChange={(e) => setBulkEndpoint(e.target.value)} data-testid="wiz-bulk-endpoint" className="max-w-40 text-xs">
                              <option value="">Endpoint…</option>
                              <option value="responses">responses</option>
                              <option value="chat_completions">chat_completions</option>
                              <option value="messages">messages</option>
                              <option value="converse">converse</option>
                            </Select>
                            <Input value={bulkIn} onChange={(e) => setBulkIn(e.target.value)} placeholder="In $/1M" data-testid="wiz-bulk-in" className="max-w-28 text-xs" />
                            <Input value={bulkOut} onChange={(e) => setBulkOut(e.target.value)} placeholder="Out $/1M" data-testid="wiz-bulk-out" className="max-w-28 text-xs" />
                            <Button size="sm" variant="secondary" onClick={applyBulk} disabled={selected.size === 0} data-testid="wiz-bulk-apply" className="text-xs">
                              Apply
                            </Button>
                        </div>

                        <p className="text-xs text-zinc-500" data-testid="wiz-selection-count">
                          {selected.size} of {mapped.length} models selected
                        </p>
                        <div className="flex max-h-72 flex-col gap-1.5 overflow-y-auto pr-1">
                          {filtered.map((m) => {
                            const f = forms[m.model_id];
                            const checked = selected.has(m.model_id);
                            return (
                              <div
                                key={m.model_id}
                                className={cn("flex items-start gap-2 rounded-lg border p-2 text-xs", checked ? "border-zinc-300 dark:border-zinc-600" : "border-zinc-200 opacity-70 dark:border-zinc-800")}
                                data-testid={`wiz-model-${m.model_id}`}
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => toggle(m.model_id)}
                                  data-testid={`wiz-select-${m.model_id}`}
                                  className="mt-1"
                                  aria-label={`Select ${m.model_id}`}
                                />
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-1.5">
                                    <Cpu className="size-3.5 shrink-0 text-zinc-400" />
                                    <span className="truncate font-medium">{String(f?.name || m.suggested.name || m.model_id)}</span>
                                    <span className={cn("rounded px-1 py-0.5 text-[10px] font-medium", MATCH_BADGE[m.match_type])} data-testid={`wiz-match-${m.model_id}`}>
                                      {m.match_type === "provider_specific" ? "provider" : m.match_type}
                                    </span>
                                  </div>
                                  <div className="mt-0.5 font-mono text-[10px] text-zinc-500">
                                    {m.model_id}
                                    {f?.context_window ? ` · ctx ${Number(f.context_window).toLocaleString()}` : ""}
                                    {f?.max_output_tokens ? ` · max ${Number(f.max_output_tokens).toLocaleString()}` : ""}
                                    {` · in $${f?.input_price ?? 0}/1M · out $${f?.output_price ?? 0}/1M`}
                                  </div>
                                </div>
                                <Button size="sm" variant="ghost" onClick={() => setEditingModelId(m.model_id)} data-testid={`wiz-edit-${m.model_id}`} title="Edit model" className="h-7 w-7 p-0">
                                  <Pencil className="size-3.5" />
                                </Button>
                              </div>
                            );
                          })}
                          {filtered.length === 0 && <p className="text-xs text-zinc-400">No models match the filters.</p>}
                        </div>
                      </>
                    )}
                  </div>
                )}

                {step === 5 && (
                  <div className="space-y-3 text-xs" data-testid="wizard-step-5">
                    <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
                      <p className="font-semibold text-sm">{name || "(unnamed)"} <span className="font-normal text-zinc-500">· {type}</span></p>
                      <p className="mt-1 text-zinc-500">
                        Validation: {validation?.valid ? `valid (${validation.latency_ms.toFixed(0)}ms)` : "not validated"}
                      </p>
                    </div>
                    <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800" data-testid="wiz-summary-models">
                      <p className="font-semibold">{selected.size} models selected</p>
                      <p className="mt-1 text-zinc-500" data-testid="wiz-summary-matches">
                        Matched provider models: {matchStats.provider_specific} · Matched global models: {matchStats.global} · Unknown models: {matchStats.fallback}
                      </p>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          <div className="border-t border-zinc-200 px-6 py-3 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 flex items-center justify-between">
            <GhostButton onClick={close} type="button">
              {step === 5 && !isEditing ? "Close" : "Cancel"}
            </GhostButton>
            <div className="flex items-center gap-2">
              {!isEditing && step > 1 && (
                <Button variant="ghost" onClick={() => setStep((s) => Math.max(1, s - 1))} data-testid="wiz-back" className="gap-1">
                  <ChevronLeft className="size-3.5" /> Back
                </Button>
              )}
              {!isEditing && step === 1 && (
                <Button onClick={() => setStep(2)} disabled={!canNext1} data-testid="wiz-next" className="gap-1">
                  Next <ChevronRight className="size-3.5" />
                </Button>
              )}
              {!isEditing && step === 2 && (
                <Button onClick={() => { setValidation(null); setStep(3); }} disabled={!canNext2} data-testid="wiz-next" className="gap-1">
                  Next <ChevronRight className="size-3.5" />
                </Button>
              )}
              {!isEditing && step === 3 && (
                <Button onClick={() => { setMapped(null); setStep(4); void runMapping(); }} disabled={!validation?.valid || busy} data-testid="wiz-next" className="gap-1">
                  Next <ChevronRight className="size-3.5" />
                </Button>
              )}
              {!isEditing && step === 4 && (
                <Button onClick={() => setStep(5)} disabled={selected.size === 0 || mapping} data-testid="wiz-next" className="gap-1">
                  Review <ChevronRight className="size-3.5" />
                </Button>
              )}
              {!isEditing && step === 5 && (
                <Button onClick={() => void handleRegister()} disabled={busy || selected.size === 0} data-testid="wiz-register" className="gap-1.5">
                  {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Layers className="size-3.5" />}
                  Register {selected.size} model{selected.size === 1 ? "" : "s"}
                </Button>
              )}
            </div>
          </div>
        </form>
      </DialogContent>

      {editingModelId && (
        <Dialog open onOpenChange={(o) => !o && setEditingModelId(null)}>
          <DialogContent className="max-w-2xl p-4" data-testid="wiz-edit-drawer">
            <ModelForm
              initial={editingModelId && forms[editingModelId] ? forms[editingModelId] : EMPTY_MODEL_FORM}
              onSubmit={(f) => {
                setForms((prev) => ({ ...prev, [editingModelId]: f }));
                setEditingModelId(null);
                toast.success("Model updated — saved on registration");
              }}
              onCancel={() => setEditingModelId(null)}
            />
          </DialogContent>
        </Dialog>
      )}
    </Dialog>
  );

  async function handleEditSave() {
    // Edit mode keeps the direct-save path (provider already exists).
    if (!editingProvider) return;
    setBusy(true);
    try {
      const credentials = Object.fromEntries(Object.entries(creds).filter(([, v]) => v !== ""));
      const saved = await pm.update.mutateAsync({
        id: editingProvider.id,
        body: { name, ...(Object.keys(credentials).length ? { credentials } : {}) },
      });
      toast.success("Provider updated");
      onSaved?.(saved);
      onClose();
    } catch (e) {
      toast.error("Save failed", { description: e instanceof Error ? e.message : "Error" });
    } finally {
      setBusy(false);
    }
  }
}

function EditBody({
  name,
  setName,
  type,
  creds,
  setCreds,
  busy,
  onSave,
}: {
  name: string;
  setName: (v: string) => void;
  type: ProviderType;
  creds: Record<string, string>;
  setCreds: (v: Record<string, string>) => void;
  busy: boolean;
  onSave: () => void;
}) {
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});

  return (
    <div className="space-y-3" data-testid="wizard-edit-body">
      <Field label="Provider Name">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          data-testid="provider-name"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          data-1p-ignore="true"
          data-lpignore="true"
          data-bwignore="true"
          data-form-type="other"
        />
      </Field>
      {CREDENTIAL_FIELDS[type]?.map(([fieldKey, spec]) => (
        <CredentialField
          key={fieldKey}
          fieldKey={fieldKey}
          spec={spec}
          value={creds[fieldKey] ?? ""}
          onChange={(v) => setCreds({ ...creds, [fieldKey]: v })}
          showSecret={showSecrets[fieldKey]}
          onToggleSecret={() =>
            setShowSecrets((prev) => ({
              ...prev,
              [fieldKey]: !prev[fieldKey],
            }))
          }
        />
      ))}
      <Button onClick={onSave} disabled={!name.trim() || busy} data-testid="save-provider">
        Save Provider
      </Button>
    </div>
  );
}
