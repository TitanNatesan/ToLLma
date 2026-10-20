"use client";

import { useState } from "react";
import {
  CalendarClock,
  KeyRound,
  Loader2,
  Network,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Input,
  Select,
  Separator,
  Switch,
  Textarea,
} from "@/components/ui";
import { cn } from "@/lib/utils";
import { apiKeyErrorMessage } from "@/services/apiKeys";
import { IpRulesEditor, parseIpRules } from "./IpRulesEditor";
import { ModelPermissionsEditor } from "./ModelPermissionsEditor";
import { PolicyForm, hasPolicyValues, policyToInput } from "./PolicyForm";
import { Segmented } from "./SelectField";
import type {
  ApiKey,
  ApiKeyIpRuleInput,
  ApiKeyModelPermissionInput,
  ApiKeyPolicyInput,
  ApiKeyUpdateInput,
} from "@/types/apiKeys";
import type { AIModel } from "@/types";

/** Everything the create flow can submit (policy/IP/models empty = inherit). */
export interface KeyFormResult {
  name: string;
  description: string | null;
  expires_at: string | null;
  policy: ApiKeyPolicyInput | null;
  ipRules: ApiKeyIpRuleInput[];
  modelPermissions: ApiKeyModelPermissionInput[];
  /** Organization assignee (org scope only). */
  assigneeUserId: string | null;
}

export interface KeyAssignee {
  id: string;
  email: string;
}

interface KeyFormProps {
  mode: "create" | "edit";
  /** "org" adds a required assignee; every other section matches personal. */
  scope?: "personal" | "org";
  assignees?: KeyAssignee[];
  assigneeId?: string;
  onAssigneeChange?: (id: string) => void;
  /** Override the personal registry (e.g. org-scoped models/providers). */
  models?: AIModel[];
  providers?: Array<{ id: string; name: string; provider_type: string }>;
  configureHref?: string;
  apiKey?: ApiKey | null;
  onCreate?: (result: KeyFormResult) => Promise<void>;
  onUpdate?: (id: string, body: ApiKeyUpdateInput) => Promise<void>;
  onClose: () => void;
}

type ExpiryPreset = "never" | "1d" | "7d" | "30d" | "90d" | "custom";

const EXPIRY_DAYS: Record<"1d" | "7d" | "30d" | "90d", number> = {
  "1d": 1,
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

const EXPIRY_OPTIONS: ReadonlyArray<{ value: ExpiryPreset; label: string }> = [
  { value: "never", label: "Never" },
  { value: "1d", label: "1 day" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
  { value: "custom", label: "Custom" },
];

function toDateTimeLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Reverse-map a stored timestamp to its preset when it matches "now + N days". */
function detectExpiryPreset(iso: string | null | undefined): ExpiryPreset {
  if (!iso) return "never";
  const target = new Date(iso).getTime();
  if (isNaN(target)) return "never";
  const diffDays = (target - Date.now()) / 86_400_000;
  for (const [preset, days] of Object.entries(EXPIRY_DAYS)) {
    if (Math.abs(diffDays - days) < 1.5) return preset as ExpiryPreset;
  }
  return "custom";
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
          <Icon className="size-3" />
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

/** Create (full) and edit (metadata) dialog for a user API key. */
export function KeyForm({ mode, scope = "personal", assignees, assigneeId, onAssigneeChange, models: modelsOverride, providers: providersOverride, configureHref, apiKey, onCreate, onUpdate, onClose }: KeyFormProps) {
  const editing = mode === "edit" && !!apiKey;
  const isOrg = scope === "org" && !editing;

  const [name, setName] = useState(apiKey?.name ?? "");
  const [description, setDescription] = useState(apiKey?.description ?? "");
  const [expiresAt, setExpiresAt] = useState(toDateTimeLocal(apiKey?.expires_at));
  const [expiryPreset, setExpiryPreset] = useState<ExpiryPreset>(() =>
    detectExpiryPreset(apiKey?.expires_at),
  );
  const [enabled, setEnabled] = useState(apiKey?.enabled ?? true);
  const [policy, setPolicy] = useState<ApiKeyPolicyInput>(() => policyToInput(apiKey?.policy));
  const [allow, setAllow] = useState("");
  const [deny, setDeny] = useState("");
  const [modelPermissions, setModelPermissions] = useState<ApiKeyModelPermissionInput[]>([]);
  const [orgAssignee, setOrgAssignee] = useState(assigneeId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effectiveAssignee = assigneeId ?? orgAssignee;
  const setEffectiveAssignee = onAssigneeChange ?? setOrgAssignee;

  function applyExpiryPreset(preset: ExpiryPreset) {
    setExpiryPreset(preset);
    if (preset === "never") {
      setExpiresAt("");
      return;
    }
    if (preset === "custom") return;
    const days = EXPIRY_DAYS[preset];
    setExpiresAt(toDateTimeLocal(new Date(Date.now() + days * 86_400_000).toISOString()));
  }

  async function submit() {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Name is required.");
      return;
    }
    if (isOrg && !effectiveAssignee) {
      setError("Choose the member this key is assigned to.");
      return;
    }
    if (expiresAt && new Date(expiresAt).getTime() <= Date.now()) {
      setError("Expiration must be in the future.");
      return;
    }

    const parsedIp = editing ? { rules: [] as ApiKeyIpRuleInput[], invalid: [] as string[] } : parseIpRules(allow, deny);
    if (parsedIp.invalid.length > 0) {
      setError(`Invalid IP entries: ${parsedIp.invalid.join(", ")}`);
      return;
    }

    const expiresIso = expiresAt ? new Date(expiresAt).toISOString() : null;
    setBusy(true);
    setError(null);
    try {
      if (editing && apiKey) {
        await onUpdate?.(apiKey.id, {
          name: trimmedName,
          description: description.trim() || null,
          enabled,
          expires_at: expiresIso,
        });
      } else {
        await onCreate?.({
          name: trimmedName,
          description: description.trim() || null,
          expires_at: expiresIso,
          policy: hasPolicyValues(policy) ? policy : null,
          ipRules: parsedIp.rules,
          modelPermissions,
          assigneeUserId: isOrg ? effectiveAssignee || null : null,
        });
      }
    } catch (e) {
      setError(apiKeyErrorMessage(e, "Could not save the key."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
    >
      <DialogContent className="max-w-2xl p-5" data-testid="key-form-dialog">
        <DialogTitle className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          {editing ? "Edit API key" : isOrg ? "Create organization API key" : "Create API key"}
        </DialogTitle>
        <DialogDescription asChild>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            {editing
              ? "Update the key's metadata. Limits, network rules and model access are managed from the key's details panel."
              : isOrg
                ? "Keys are scoped to this organization and inherit its governance. The secret is shown once after creation."
                : "The secret is shown once after creation — copy it into your secret manager."}
          </p>
        </DialogDescription>

        <div className="mt-4 space-y-5">
          <div className="min-w-0 space-y-5">
          <Section
            icon={KeyRound}
            title="Basics"
            description={
              isOrg
                ? "Name, assignee, lifetime, limits and an optional note."
                : "Name, lifetime and an optional note for your team."
            }
          >
            {isOrg && (
              <div className="flex min-w-0 flex-col gap-1">
                <label
                  htmlFor="key-assignee-input"
                  className="text-[10px] font-medium uppercase tracking-wider text-zinc-400"
                >
                  Assignee (member)
                </label>
                <Select
                  id="key-assignee-input"
                  value={effectiveAssignee}
                  onChange={(event) => setEffectiveAssignee(event.target.value)}
                  disabled={busy}
                  data-testid="key-assignee-input"
                  aria-label="Assignee (member)"
                >
                  <option value="">Select a member…</option>
                  {(assignees ?? []).map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.email}
                    </option>
                  ))}
                  {(assignees ?? []).length === 0 && (
                    <option value="" disabled>
                      No eligible members
                    </option>
                  )}
                </Select>
                {(assignees ?? []).length === 0 && (
                  <p
                    className="text-[11px] text-zinc-500 dark:text-zinc-400"
                    data-testid="key-assignee-empty"
                  >
                    No active members in this organization to assign a key to.
                  </p>
                )}
              </div>
            )}
            <div className="flex min-w-0 flex-col gap-1">
              <label
                htmlFor="key-name-input"
                className="text-[10px] font-medium uppercase tracking-wider text-zinc-400"
              >
                Name
              </label>
              <Input
                id="key-name-input"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Production backend"
                maxLength={120}
                autoFocus
                className="h-9 text-sm"
                data-testid="key-name-input"
              />
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <span className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-zinc-400">
                <CalendarClock className="size-3" />
                Expiration
              </span>
              <Segmented
                value={expiryPreset}
                onChange={applyExpiryPreset}
                options={EXPIRY_OPTIONS}
                ariaLabel="Expiration preset"
                size="sm"
                disabled={busy}
                testId="key-expiry-preset"
              />
              {expiryPreset === "custom" && (
                <Input
                  type="datetime-local"
                  value={expiresAt}
                  onChange={(event) => setExpiresAt(event.target.value)}
                  className="mt-1 h-9 text-sm"
                  aria-label="Custom expiration"
                  data-testid="key-expires-input"
                />
              )}
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <label
                htmlFor="key-description-input"
                className="text-[10px] font-medium uppercase tracking-wider text-zinc-400"
              >
                Description
              </label>
              <Textarea
                id="key-description-input"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="What this key is used for, where it is deployed…"
                maxLength={500}
                className="min-h-16 text-sm"
                data-testid="key-description-input"
              />
            </div>
            {editing && (
              <div className="flex items-center justify-between rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-800">
                <div>
                  <p className="text-xs font-medium text-zinc-700 dark:text-zinc-300">Key enabled</p>
                  <p className="text-[10px] text-zinc-400">Disabled keys reject every request.</p>
                </div>
                <Switch checked={enabled} onCheckedChange={setEnabled} aria-label="Key enabled" />
              </div>
            )}
          </Section>

          {!editing && (
            <>
              <Separator />
              <Section
                icon={SlidersHorizontal}
                title="Limits"
                description="Leave a field empty for unlimited. Budget resets on the selected window."
              >
                <PolicyForm value={policy} onChange={setPolicy} disabled={busy} />
              </Section>

              <Separator />
              <Section
                icon={Network}
                title="Network access"
                description="Restrict which sources may use this key. Empty lists allow every source."
              >
                <IpRulesEditor
                  allow={allow}
                  deny={deny}
                  onAllowChange={setAllow}
                  onDenyChange={setDeny}
                  disabled={busy}
                />
              </Section>
            </>
          )}
          </div>

          {!editing && (
            <>
              <Separator />
              <Section
                icon={ShieldCheck}
                title="Model access"
                description="Restrict the key to selected models, with optional per-model caps. Empty selection allows all enabled models."
              >
                <ModelPermissionsEditor
                  value={modelPermissions}
                  onChange={setModelPermissions}
                  disabled={busy}
                  models={modelsOverride}
                  providers={providersOverride}
                  configureHref={configureHref}
                />
              </Section>
            </>
          )}
        </div>

        {error && (
          <p
            className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300"
            data-testid="key-form-error"
          >
            {error}
          </p>
        )}

        <div
          className={cn(
            "sticky bottom-0 -mx-5 mt-5 flex justify-end gap-2 border-t border-zinc-200 bg-white/95 px-5 pt-3 pb-1",
            "dark:border-zinc-800 dark:bg-zinc-950/95",
          )}
        >
          <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => void submit()} disabled={busy} data-testid="key-form-submit">
            {busy && <Loader2 className="size-3.5 animate-spin" />}
            {editing ? "Save changes" : "Create key"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
