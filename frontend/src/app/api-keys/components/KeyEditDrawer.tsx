"use client";

import { memo, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  CalendarClock,
  KeyRound,
  Loader2,
  Lock,
  Network,
  ShieldCheck,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { Button, Input, Separator, Switch, Textarea } from "@/components/ui";
import { cn } from "@/lib/utils";
import { useModels } from "@/hooks/useRegistry";
import {
  apiKeyErrorMessage,
  updateApiKey,
  updateApiKeyIpRules,
  updateApiKeyModelPermissions,
  updateApiKeyPolicy,
} from "@/services/apiKeys";
import { EndpointPermissions } from "./EndpointPermissions";
import { IpRulesEditor, ipRulesToText, parseIpRules } from "./IpRulesEditor";
import { ModelPermissionsEditor, modelPermissionsToInput } from "./ModelPermissionsEditor";
import { PolicyForm, policyToInput } from "./PolicyForm";
import { Segmented } from "./SelectField";
import { ApiKeyStatusPill, apiKeyStatus, fmtDateTime } from "./StatusPill";
import type { AIModel } from "@/types";
import type {
  ApiKey,
  ApiKeyIpRuleInput,
  ApiKeyModelPermissionInput,
  ApiKeyPolicyInput,
} from "@/types/apiKeys";

// ---------------------------------------------------------------------------
// Shared drawer chrome (also used by the analytics drawer in KeyDetailsPanel)
// ---------------------------------------------------------------------------

/** Close the drawer on Escape. No-op while closed. */
export function useEscapeClose(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
}

/**
 * Dimmed backdrop shared by both key drawers: fixed full-viewport,
 * 8px blur over rgba(0,0,0,.35), fade transition, click-to-close.
 */
export function DrawerBackdrop({
  onClose,
  zIndex = 30,
  testId = "drawer-backdrop",
}: {
  onClose: () => void;
  zIndex?: number;
  testId?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      onClick={onClose}
      aria-hidden="true"
      data-testid={testId}
      className="fixed inset-0"
      style={{
        zIndex,
        backgroundColor: "rgba(0,0,0,.35)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Expiration helpers (parity with KeyForm presets; edit drawer owns its copy)
// ---------------------------------------------------------------------------

type ExpiryPreset = "never" | "custom";

const EDIT_EXPIRY_OPTIONS: ReadonlyArray<{ value: ExpiryPreset; label: string }> = [
  { value: "never", label: "Never expires" },
  { value: "custom", label: "Custom date" },
];

function toDateTimeLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function Section({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: typeof KeyRound;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-md border border-zinc-200 bg-zinc-50 text-zinc-400 dark:border-zinc-800 dark:bg-zinc-900">
          <Icon className="size-3" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            {title}
          </h3>
          {description && <p className="text-[10px] text-zinc-400">{description}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

export interface KeyEditDrawerProps {
  /** Key being edited; null renders nothing. Remounted per key id. */
  apiKey: ApiKey | null;
  open: boolean;
  onClose: () => void;
  /** Called after a successful save (parent closes the drawer). */
  onSaved: () => void;
}

/**
 * Dedicated edit drawer for a user API key. All configuration lives here —
 * the analytics drawer stays read-only. Only changed sections are submitted,
 * each through its own endpoint (metadata PATCH, policy/IP/models PUT).
 */
export function KeyEditDrawer({ apiKey, open, onClose, onSaved }: KeyEditDrawerProps) {
  useEscapeClose(open && !!apiKey, onClose);
  const show = open && !!apiKey;
  return (
    <>
      <AnimatePresence>
        {show && (
          <DrawerBackdrop
            key="edit-backdrop"
            onClose={onClose}
            zIndex={45}
            testId="key-edit-backdrop"
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {show && (
          <KeyEditContent
            key={apiKey.id}
            apiKey={apiKey}
            onClose={onClose}
            onSaved={onSaved}
          />
        )}
      </AnimatePresence>
    </>
  );
}

const permKey = (providerId: string | null | undefined, modelId: string | null | undefined) =>
  `${providerId ?? ""}::${modelId ?? ""}`;

const KeyEditContent = memo(function KeyEditContent({
  apiKey,
  onClose,
  onSaved,
}: {
  apiKey: ApiKey;
  onClose: () => void;
  onSaved: () => void;
}) {
  const qc = useQueryClient();
  const { data: models = [] } = useModels();

  const initialIp = useMemo(() => ipRulesToText(apiKey.ip_rules), [apiKey]);
  const initialPolicy = useMemo(() => policyToInput(apiKey.policy), [apiKey]);
  const initialPermissions = useMemo(
    () => modelPermissionsToInput(apiKey.model_permissions),
    [apiKey],
  );
  const initialExpires = useMemo(() => toDateTimeLocal(apiKey.expires_at), [apiKey]);

  const [name, setName] = useState(apiKey.name);
  const [description, setDescription] = useState(apiKey.description ?? "");
  const [enabled, setEnabled] = useState(apiKey.enabled);
  const [expiresAt, setExpiresAt] = useState(initialExpires);
  const [expiryPreset, setExpiryPreset] = useState<ExpiryPreset>(apiKey.expires_at ? "custom" : "never");
  const [policy, setPolicy] = useState<ApiKeyPolicyInput>(initialPolicy);
  const [allow, setAllow] = useState(initialIp.allow);
  const [deny, setDeny] = useState(initialIp.deny);
  const [permissions, setPermissions] =
    useState<ApiKeyModelPermissionInput[]>(initialPermissions);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsedIp = useMemo(() => parseIpRules(allow, deny), [allow, deny]);
  const status = apiKeyStatus(apiKey);

  const dirty = useMemo(() => {
    const metaDirty =
      name.trim() !== apiKey.name ||
      (description.trim() || "") !== (apiKey.description ?? "") ||
      enabled !== apiKey.enabled ||
      expiresAt !== initialExpires;
    return {
      meta: metaDirty,
      policy: JSON.stringify(policy) !== JSON.stringify(initialPolicy),
      ip:
        JSON.stringify(parsedIp.rules) !==
        JSON.stringify(parseIpRules(initialIp.allow, initialIp.deny).rules),
      models: JSON.stringify(permissions) !== JSON.stringify(initialPermissions),
    };
  }, [
    name,
    description,
    enabled,
    expiresAt,
    initialExpires,
    apiKey,
    policy,
    initialPolicy,
    parsedIp,
    initialIp,
    permissions,
    initialPermissions,
  ]);
  const isDirty = dirty.meta || dirty.policy || dirty.ip || dirty.models;

  function reset() {
    setName(apiKey.name);
    setDescription(apiKey.description ?? "");
    setEnabled(apiKey.enabled);
    setExpiresAt(initialExpires);
    setExpiryPreset(apiKey.expires_at ? "custom" : "never");
    setPolicy(initialPolicy);
    setAllow(initialIp.allow);
    setDeny(initialIp.deny);
    setPermissions(initialPermissions);
    setError(null);
  }

  function selectAllModels(registry: AIModel[]) {
    const existing = new Map(permissions.map((p) => [permKey(p.provider_id, p.model_id), p]));
    const selected: ApiKeyModelPermissionInput[] = registry.map((model) => {
      const key = permKey(model.provider_id, model.id);
      return (
        existing.get(key) ?? {
          provider_id: model.provider_id,
          model_id: model.id,
          enabled: true,
          max_budget: null,
          rpm: null,
          tpm: null,
        }
      );
    });
    // Provider-wide rules are API-managed, not part of the selection — keep them.
    for (const p of permissions) {
      if (!p.model_id && !selected.some((s) => permKey(s.provider_id, s.model_id) === permKey(p.provider_id, p.model_id))) {
        selected.push(p);
      }
    }
    setPermissions(selected);
  }

  function clearAllModels() {
    // Empty model selection = allow all models; provider-wide rules are preserved.
    setPermissions(permissions.filter((p) => !p.model_id));
  }

  async function save() {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Name is required.");
      return;
    }
    if (expiresAt && new Date(expiresAt).getTime() <= Date.now()) {
      setError("Expiration must be in the future.");
      return;
    }
    if (parsedIp.invalid.length > 0) {
      setError(`Invalid IP entries: ${parsedIp.invalid.join(", ")}`);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const tasks: Array<Promise<unknown>> = [];
      if (dirty.meta) {
        const body = {
          name: trimmedName,
          description: description.trim() || null,
          enabled,
          expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
        };
        tasks.push(updateApiKey(apiKey.id, body));
      }
      if (dirty.policy) tasks.push(updateApiKeyPolicy(apiKey.id, policy));
      if (dirty.ip) {
        const rules: ApiKeyIpRuleInput[] = parsedIp.rules;
        tasks.push(updateApiKeyIpRules(apiKey.id, rules));
      }
      if (dirty.models) tasks.push(updateApiKeyModelPermissions(apiKey.id, permissions));
      await Promise.all(tasks);
      await qc.invalidateQueries({ queryKey: ["api-keys"] });
      toast.success("Key updated");
      onSaved();
    } catch (e) {
      setError(apiKeyErrorMessage(e, "Could not save the key."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <motion.aside
      initial={{ x: "100%", opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: "100%", opacity: 0 }}
      transition={{ type: "spring", damping: 25, stiffness: 300 }}
      role="dialog"
      aria-modal="true"
      aria-label={`Edit ${apiKey.name}`}
          data-testid="key-edit-drawer"
          className="fixed inset-y-0 right-0 z-50 flex w-[min(94vw,560px)] flex-col border-l border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950"
        >
          <div className="flex items-center justify-between gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
            <div className="flex min-w-0 items-center gap-2">
              <KeyRound className="size-3.5 shrink-0 text-zinc-400" aria-hidden="true" />
              <div className="min-w-0">
                <h2 className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  Edit {apiKey.name}
                </h2>
                <p className="truncate font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
                  {apiKey.masked}
                </p>
              </div>
              <ApiKeyStatusPill status={status} />
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close edit drawer"
              className="shrink-0 rounded-md p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            >
              <X className="size-4" />
            </button>
          </div>

          <div className="flex-1 space-y-5 overflow-y-auto p-4">
            <Section
              icon={KeyRound}
              title="General"
              description="Display name and an optional note for your team."
            >
              <div className="flex min-w-0 flex-col gap-1">
                <label
                  htmlFor="edit-key-name"
                  className="text-[10px] font-medium uppercase tracking-wider text-zinc-400"
                >
                  Name
                </label>
                <Input
                  id="edit-key-name"
                  value={name}
                  disabled={saving}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Production backend"
                  maxLength={120}
                  className="h-9 text-sm"
                  data-testid="key-edit-name"
                />
              </div>
              <div className="flex min-w-0 flex-col gap-1">
                <label
                  htmlFor="edit-key-description"
                  className="text-[10px] font-medium uppercase tracking-wider text-zinc-400"
                >
                  Description
                </label>
                <Textarea
                  id="edit-key-description"
                  value={description}
                  disabled={saving}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="What this key is used for, where it is deployed…"
                  maxLength={500}
                  className="min-h-16 text-sm"
                  data-testid="key-edit-description"
                />
              </div>
            </Section>

            <Separator />

            <Section
              icon={Lock}
              title="Status"
              description="Disabled keys reject every request."
            >
              <div className="flex items-center justify-between rounded-lg border border-zinc-200 px-3 py-2 transition-colors hover:border-zinc-300 dark:border-zinc-800 dark:hover:border-zinc-700">
                <div>
                  <p className="text-xs font-medium text-zinc-700 dark:text-zinc-300">Key enabled</p>
                  <p className="text-[10px] text-zinc-400">
                    {fmtDateTime(apiKey.last_used_at) === "—"
                      ? "Never used."
                      : `Last used ${fmtDateTime(apiKey.last_used_at)}.`}
                  </p>
                </div>
                <Switch
                  checked={enabled}
                  disabled={saving}
                  onCheckedChange={setEnabled}
                  aria-label="Key enabled"
                  data-testid="key-edit-enabled"
                />
              </div>
            </Section>

            <Separator />

            <Section
              icon={CalendarClock}
              title="Expiration"
              description="Leave on never, or pick a custom expiry."
            >
              <Segmented
                value={expiryPreset}
                onChange={(next) => {
                  setExpiryPreset(next);
                  if (next === "never") setExpiresAt("");
                  else if (!expiresAt) setExpiresAt(initialExpires);
                }}
                options={EDIT_EXPIRY_OPTIONS}
                ariaLabel="Expiration preset"
                size="sm"
                disabled={saving}
                testId="key-edit-expiry-preset"
              />
              {expiryPreset === "custom" && (
                <Input
                  type="datetime-local"
                  value={expiresAt}
                  disabled={saving}
                  onChange={(event) => setExpiresAt(event.target.value)}
                  className="h-9 text-sm"
                  aria-label="Custom expiration"
                  data-testid="key-edit-expires"
                />
              )}
            </Section>

            <Separator />

            <Section
              icon={SlidersHorizontal}
              title="Budget & limits"
              description="Hard cap, reset window, rate limits and spend caps. Empty = unlimited."
            >
              <PolicyForm value={policy} onChange={setPolicy} disabled={saving} />
            </Section>

            <Separator />

            <Section
              icon={Network}
              title="IP rules"
              description="Restrict which sources may use this key. Empty lists allow every source."
            >
              <IpRulesEditor
                allow={allow}
                deny={deny}
                onAllowChange={setAllow}
                onDenyChange={setDeny}
                disabled={saving}
              />
            </Section>

            <Separator />

            <Section
              icon={ShieldCheck}
              title="Model access"
              description="Restrict the key to selected models. Empty selection allows all enabled models."
            >
              <div className="flex items-center justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={saving}
                  onClick={() => selectAllModels(models)}
                  data-testid="model-access-select-all"
                >
                  Select all
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={saving}
                  onClick={clearAllModels}
                  data-testid="model-access-clear-all"
                >
                  Clear all
                </Button>
              </div>
              <ModelPermissionsEditor
                value={permissions}
                onChange={setPermissions}
                disabled={saving}
              />
            </Section>

            <Separator />

            <Section
              icon={Lock}
              title="Endpoint permissions"
              description="Which gateway endpoints this key may call."
            >
              <EndpointPermissions />
            </Section>

            {error && (
              <p
                className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300"
                data-testid="key-edit-error"
              >
                {error}
              </p>
            )}
          </div>

          <div className="flex justify-end gap-2 border-t border-zinc-200 bg-white/95 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950/95">
            <Button variant="outline" size="sm" onClick={reset} disabled={saving || !isDirty}>
              Reset
            </Button>
            <Button
              size="sm"
              onClick={() => void save()}
              disabled={saving || !isDirty || parsedIp.invalid.length > 0}
              data-testid="key-edit-save"
              className={cn(!isDirty && "opacity-70")}
            >
              {saving && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
              Save changes
            </Button>
          </div>
        </motion.aside>
  );
});
