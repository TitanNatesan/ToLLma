"use client";

import { useState } from "react";
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
import { useProviderMutations } from "@/hooks/useRegistry";
import { useChatStore } from "@/store/chat";
import type { Provider, ProviderType } from "@/types";
import {
  Check,
  CheckCircle2,
  ChevronRight,
  Cpu,
  HelpCircle,
  KeyRound,
  Layers,
  Loader2,
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

export function ProviderWizardModal({
  open,
  onClose,
  editingProvider,
  onSaved,
}: ProviderWizardModalProps) {
  const pm = useProviderMutations();
  const { setSelectedProviderId } = useChatStore();

  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [name, setName] = useState(editingProvider?.name ?? "");
  const [type, setType] = useState<ProviderType>(
    editingProvider?.provider_type ?? "OPENAI_CHAT",
  );
  const [creds, setCreds] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [validationResult, setValidationResult] = useState<{
    valid: boolean;
    latency_ms: number;
    message?: string;
  } | null>(null);
  const [discoveryResult, setDiscoveryResult] = useState<{
    discovered: string[];
    created: number;
    message: string;
  } | null>(null);
  const [savedProvider, setSavedProvider] = useState<Provider | null>(null);

  // Initialize or reset
  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      onClose();
      // reset after close animation
      setTimeout(() => {
        setStep(1);
        setName("");
        setType("OPENAI_CHAT");
        setCreds({});
        setValidationResult(null);
        setDiscoveryResult(null);
        setSavedProvider(null);
      }, 200);
    }
  };

  const isEditing = !!editingProvider;

  // Complete creation or direct save
  async function handleSave() {
    setBusy(true);
    const credentials = Object.fromEntries(
      Object.entries(creds).filter(([, v]) => v !== ""),
    );

    try {
      let saved: Provider;
      if (isEditing) {
        saved = await pm.update.mutateAsync({
          id: editingProvider.id,
          body: {
            name,
            ...(Object.keys(credentials).length ? { credentials } : {}),
          },
        });
        toast.success("Provider updated");
      } else {
        saved = await pm.create.mutateAsync({
          name: name.trim() || `${type} Provider`,
          provider_type: type,
          credentials,
        });
        toast.success("Provider created");
      }

      setSavedProvider(saved);
      setSelectedProviderId(saved.id);

      let discMsg: string | undefined;

      // Auto-validate
      try {
        const valRes = await pm.validate.mutateAsync(saved.id);
        setValidationResult({
          valid: valRes.valid,
          latency_ms: valRes.latency_ms,
          message: valRes.message,
        });

        if (valRes.valid) {
          // Auto-discover
          const discRes = await pm.discover.mutateAsync(saved.id);
          setDiscoveryResult(discRes);
          discMsg = discRes.message;
        }
      } catch {
        // Validation/discovery failure non-blocking for creation
      }

      onSaved?.(saved, discMsg);
      handleOpenChange(false);
    } catch (e) {
      toast.error("Save failed", {
        description: e instanceof Error ? e.message : "Error saving provider",
      });
    } finally {
      setBusy(false);
    }
  }

  // Live validate credentials before finish
  async function testValidation() {
    // If not created yet, create or validate
    if (!savedProvider) {
      await handleSave();
    } else {
      setBusy(true);
      try {
        const valRes = await pm.validate.mutateAsync(savedProvider.id);
        setValidationResult({
          valid: valRes.valid,
          latency_ms: valRes.latency_ms,
          message: valRes.message,
        });
        if (valRes.valid) {
          toast.success("Credentials valid");
        } else {
          toast.error("Credentials invalid", { description: valRes.message });
        }
      } catch (e) {
        toast.error("Validation error", {
          description: e instanceof Error ? e.message : "Error",
        });
      } finally {
        setBusy(false);
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl p-0 overflow-hidden shadow-2xl">
        <div data-testid="provider-form" className="flex flex-col">
          {/* Header & Step progress */}
          <div className="border-b border-zinc-200 px-6 py-4 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-900/60">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                  {isEditing ? "Edit Provider" : "Add Provider Connection"}
                </h2>
                <p className="text-xs text-zinc-500">
                  Configure an LLM provider and discover its available models
                </p>
              </div>
              <Badge variant="outline" className="text-xs font-mono">
                Step {step} of 5
              </Badge>
            </div>

            {/* Stepper tabs */}
            {!isEditing && (
              <div className="mt-3 flex items-center justify-between text-[11px] font-medium text-zinc-400">
                <span className={cn(step === 1 && "text-zinc-900 dark:text-zinc-100 font-semibold")}>
                  1. Provider Type
                </span>
                <ChevronRight className="size-3 text-zinc-300 dark:text-zinc-700" />
                <span className={cn(step === 2 && "text-zinc-900 dark:text-zinc-100 font-semibold")}>
                  2. Credentials
                </span>
                <ChevronRight className="size-3 text-zinc-300 dark:text-zinc-700" />
                <span className={cn(step === 3 && "text-zinc-900 dark:text-zinc-100 font-semibold")}>
                  3. Validation
                </span>
                <ChevronRight className="size-3 text-zinc-300 dark:text-zinc-700" />
                <span className={cn(step === 4 && "text-zinc-900 dark:text-zinc-100 font-semibold")}>
                  4. Models
                </span>
                <ChevronRight className="size-3 text-zinc-300 dark:text-zinc-700" />
                <span className={cn(step === 5 && "text-zinc-900 dark:text-zinc-100 font-semibold")}>
                  5. Finish
                </span>
              </div>
            )}
          </div>

          {/* Body Content */}
          <div className="p-6 space-y-4 max-h-[65vh] overflow-y-auto">
            {/* Hidden/Synced select so automated tests calling page.getByTestId("provider-type").selectOption(...) continue to work 100% */}
            <div className="flex items-center gap-2">
              <Field label="Provider Name">
                <Input
                  value={name}
                  placeholder={`e.g. Production ${type}`}
                  onChange={(e) => setName(e.target.value)}
                  data-testid="provider-name"
                  autoFocus
                />
              </Field>

              <div className="w-1/2">
                <Field label="Provider Type">
                  <Select
                    value={type}
                    onChange={(e) => setType(e.target.value as ProviderType)}
                    data-testid="provider-type"
                    disabled={isEditing}
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

            {/* Step 1: Provider Type Cards */}
            {step === 1 && !isEditing && (
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
                        <span
                          className={cn(
                            "text-[10px] mt-1 line-clamp-2",
                            isSelected
                              ? "text-zinc-300 dark:text-zinc-600"
                              : "text-zinc-500",
                          )}
                        >
                          {meta.subtitle}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Step 2: Dynamic Credentials Fields */}
            {(step === 2 || isEditing || step === 1) && (
              <div className="space-y-3 pt-2 border-t border-zinc-100 dark:border-zinc-800">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                    Authentication & Credentials
                  </span>
                  <span className="text-[11px] text-zinc-400">
                    Keys are stored encrypted on your server
                  </span>
                </div>

                <div className="space-y-3">
                  {CREDENTIAL_FIELDS[type]?.map(([fieldKey, spec]) => (
                    <Field
                      key={fieldKey}
                      label={spec.label + (spec.optional ? " (optional)" : "")}
                    >
                      {spec.multiline ? (
                        <Textarea
                          rows={3}
                          value={creds[fieldKey] ?? ""}
                          onChange={(e) =>
                            setCreds({ ...creds, [fieldKey]: e.target.value })
                          }
                          data-testid={`cred-${fieldKey}`}
                          placeholder={spec.secret ? "••••••••••••••••" : ""}
                        />
                      ) : (
                        <Input
                          type={spec.secret ? "password" : "text"}
                          value={creds[fieldKey] ?? ""}
                          onChange={(e) =>
                            setCreds({ ...creds, [fieldKey]: e.target.value })
                          }
                          data-testid={`cred-${fieldKey}`}
                          placeholder={spec.secret ? "••••••••••••••••" : ""}
                        />
                      )}
                    </Field>
                  ))}
                </div>
              </div>
            )}

            {/* Step 3: Validation status */}
            {(step === 3 || step === 5) && validationResult && (
              <div
                className={cn(
                  "p-3 rounded-lg border text-xs flex items-start gap-2.5",
                  validationResult.valid
                    ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-200"
                    : "border-red-200 bg-red-50 text-red-900 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-200",
                )}
              >
                {validationResult.valid ? (
                  <CheckCircle2 className="size-4 text-emerald-600 shrink-0 mt-0.5" />
                ) : (
                  <XCircle className="size-4 text-red-600 shrink-0 mt-0.5" />
                )}
                <div>
                  <div className="font-semibold">
                    {validationResult.valid
                      ? `Credentials verified (${validationResult.latency_ms.toFixed(0)}ms)`
                      : "Validation failed"}
                  </div>
                  {validationResult.message && (
                    <div className="text-[11px] opacity-80 mt-0.5">
                      {validationResult.message}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Step 4: Discovered models feedback */}
            {(step === 4 || step === 5) && discoveryResult && (
              <div className="p-3 rounded-lg border border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-900/50 dark:bg-blue-950/20 dark:text-blue-200 text-xs">
                <div className="flex items-center gap-2 font-semibold">
                  <Sparkles className="size-4 text-blue-600 shrink-0" />
                  <span>Model Discovery</span>
                </div>
                <div className="mt-1 text-[11px] opacity-80">
                  {discoveryResult.message}
                </div>
                {discoveryResult.discovered.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {discoveryResult.discovered.slice(0, 8).map((m) => (
                      <span
                        key={m}
                        className="rounded bg-white/80 dark:bg-black/40 px-1.5 py-0.5 text-[10px] font-mono"
                      >
                        {m}
                      </span>
                    ))}
                    {discoveryResult.discovered.length > 8 && (
                      <span className="text-[10px] text-zinc-500">
                        +{discoveryResult.discovered.length - 8} more
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer Actions */}
          <div className="border-t border-zinc-200 px-6 py-3 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 flex items-center justify-between">
            <GhostButton onClick={() => handleOpenChange(false)} type="button">
              {step === 5 ? "Close" : "Cancel"}
            </GhostButton>

            <div className="flex items-center gap-2">
              {step < 5 ? (
                <>
                  {/* Primary Save Button - keeping data-testid="save-provider" */}
                  <Button
                    onClick={handleSave}
                    disabled={!name.trim() || busy}
                    data-testid="save-provider"
                    className="gap-1.5"
                  >
                    {busy ? (
                      <>
                        <Loader2 className="size-3.5 animate-spin" />
                        <span>Saving…</span>
                      </>
                    ) : (
                      <>
                        <span>Save Provider</span>
                        <ChevronRight className="size-3.5" />
                      </>
                    )}
                  </Button>
                </>
              ) : (
                <Button onClick={() => handleOpenChange(false)}>
                  Done
                </Button>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
