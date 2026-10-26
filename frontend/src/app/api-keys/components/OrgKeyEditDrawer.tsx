"use client";

import { memo, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/notify";
import {
  CalendarClock,
  KeyRound,
  Loader2,
  Lock,
  Network,
  RotateCw,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";
import {
  Button,
  DetailPanel,
  Input,
  Separator,
  Switch,
  Textarea,
} from "@/components/ui";
import { cn } from "@/lib/utils";
import { useOrgModels, useOrgMutations, useOrgProviders } from "@/hooks/useOrgs";
import { updateKeyLoggingState } from "@/services/promptLogs";
import { usePromptLoggingSettings } from "@/hooks/usePromptLogs";
import { KeyLoggingField } from "./KeyLoggingField";
import { ApiKeyStatusPill, asNumber, fmtDateTime } from "./StatusPill";
import { orgKeyStatus } from "./orgKeyStatus";
import { IpRulesEditor, ipRulesToText, parseIpRules } from "./IpRulesEditor";
import { ModelPermissionsEditor } from "./ModelPermissionsEditor";
import { PolicyForm, hasPolicyValues } from "./PolicyForm";
import { Segmented } from "./SelectField";
import { EndpointPermissions } from "./EndpointPermissions";
import { KeyGuardrailsSection } from "@/app/guardrails/components/KeyGuardrailsSection";
import { parseApiError } from "@/lib/errors";
import type { OrgKey } from "@/types/orgs";
import type {
  ApiKeyIpRuleInput,
  ApiKeyModelPermissionInput,
  ApiKeyPolicyInput,
  Numeric,
} from "@/types/apiKeys";

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

const permKey = (providerId: string | null | undefined, modelId: string | null | undefined) =>
  `${providerId ?? ""}::${modelId ?? ""}`;

/** Org-key policy may use tolerant namings — normalize to editor input. */
function orgPolicyToInput(orgKey: OrgKey): ApiKeyPolicyInput {
  const raw = (orgKey.policy ?? {}) as Record<string, unknown>;
  const integer = (v: unknown): number | null =>
    typeof v === "number" && Number.isInteger(v) ? v : null;
  return {
    max_budget_usd: asNumber(raw.max_budget_usd as Numeric | null | undefined),
    budget_reset_days: integer(raw.budget_reset_days),
    rpm: integer(raw.rpm),
    rph: integer(raw.rph),
    rpd: integer(raw.rpd),
    tpm: integer(raw.tpm),
    tpd: integer(raw.tpd),
    daily_spend_limit: asNumber(raw.daily_spend_limit as Numeric | null | undefined),
    monthly_spend_limit: asNumber(raw.monthly_spend_limit as Numeric | null | undefined),
  };
}

/** Org model permissions tolerate string rows and alias key names. */
function orgPermissionsToInput(orgKey: OrgKey): ApiKeyModelPermissionInput[] {
  const perms = orgKey.model_permissions;
  if (!Array.isArray(perms)) return [];
  const out: ApiKeyModelPermissionInput[] = [];
  for (const entry of perms) {
    if (typeof entry === "string") {
      out.push({ provider_id: null, model_id: null, enabled: true });
      continue;
    }
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const modelId =
      typeof row.model_id === "string"
        ? row.model_id
        : typeof row.model === "string"
          ? row.model
          : null;
    const providerId =
      typeof row.provider_id === "string"
        ? row.provider_id
        : typeof row.provider === "string"
          ? row.provider
          : null;
    // A bare name row carries no IDs — keep it as an unrestricted marker.
    if (modelId === null && providerId === null && typeof row.model_name === "string") continue;
    out.push({
      provider_id: providerId,
      model_id: modelId,
      enabled: row.enabled !== false,
      max_budget: asNumber(row.max_budget as Numeric | null | undefined),
      rpm: typeof row.rpm === "number" ? row.rpm : null,
      tpm: typeof row.tpm === "number" ? row.tpm : null,
    });
  }
  return out;
}

/** Backend org key read carries IP rules as plain objects already. */
function orgIpRulesToInput(
  orgKey: OrgKey,
): Array<{ type: "allow" | "deny"; cidr: string }> {
  const rules = orgKey.ip_rules;
  if (!Array.isArray(rules)) return [];
  const out: Array<{ type: "allow" | "deny"; cidr: string }> = [];
  for (const rule of rules) {
    if (!rule || typeof rule !== "object") continue;
    const type = (rule as { type?: unknown }).type;
    const cidr = (rule as { cidr?: unknown }).cidr;
    if ((type === "allow" || type === "deny") && typeof cidr === "string") {
      out.push({ type, cidr });
    }
  }
  return out;
}

export interface OrgKeyEditDrawerProps {
  orgId: string;
  orgName?: string;
  /** Key being edited; null renders nothing. Remounted per key id. */
  orgKey: OrgKey | null;
  open: boolean;
  onClose: () => void;
  /** Called after a successful save (parent closes the drawer). */
  onSaved: () => void;
  /** Called with the fresh secret after an explicit rotation. */
  onRotated: (rawKey: string, name: string) => void;
  /** Read-only assignee label for the header/scope section. */
  assigneeLabel?: string;
}

/**
 * Org key editor: metadata PATCH plus policy/IP/model full-replace PUTs,
 * plus an explicit, separately-confirmed rotate. Mirrors KeyEditDrawer —
 * only changed sections are submitted, the secret never changes on edit.
 */
export function OrgKeyEditDrawer({
  orgId,
  orgName,
  orgKey,
  open,
  onClose,
  onSaved,
  onRotated,
  assigneeLabel,
}: OrgKeyEditDrawerProps) {
  if (!orgKey) return null;
  return (
    <OrgKeyEditContent
      key={orgKey.id}
      orgId={orgId}
      orgName={orgName}
      orgKey={orgKey}
      open={open}
      onClose={onClose}
      onSaved={onSaved}
      onRotated={onRotated}
      assigneeLabel={assigneeLabel}
    />
  );
}

const OrgKeyEditContent = memo(function OrgKeyEditContent({
  orgId,
  orgName,
  orgKey,
  open,
  onClose,
  onSaved,
  onRotated,
  assigneeLabel,
}: {
  orgId: string;
  orgName?: string;
  orgKey: OrgKey;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  onRotated: (rawKey: string, name: string) => void;
  assigneeLabel?: string;
}) {
  const mut = useOrgMutations(orgId);
  const qc = useQueryClient();
  const modelsQuery = useOrgModels(orgId);
  const providersQuery = useOrgProviders(orgId);
  const models = modelsQuery.data ?? [];
  const providers = (providersQuery.data ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    provider_type: p.provider_type ?? "custom",
  }));

  const enabledDefault =
    !orgKey.revoked && orgKey.status !== "revoked" && orgKey.status !== "disabled";
  const initialIp = useMemo(() => ipRulesToText(orgIpRulesToInput(orgKey)), [orgKey]);
  const initialPolicy = useMemo(() => orgPolicyToInput(orgKey), [orgKey]);
  const initialPermissions = useMemo(() => orgPermissionsToInput(orgKey), [orgKey]);
  const initialExpires = useMemo(() => toDateTimeLocal(orgKey.expires_at), [orgKey]);

  const [name, setName] = useState(orgKey.name);
  const [description, setDescription] = useState(orgKey.description ?? "");
  const [enabled, setEnabled] = useState(enabledDefault);
  const [expiresAt, setExpiresAt] = useState(initialExpires);
  const [expiryPreset, setExpiryPreset] = useState<ExpiryPreset>(() =>
    detectExpiryPreset(orgKey.expires_at),
  );
  const [policy, setPolicy] = useState<ApiKeyPolicyInput>(initialPolicy);
  const [allow, setAllow] = useState(initialIp.allow);
  const [deny, setDeny] = useState(initialIp.deny);
  const [permissions, setPermissions] =
    useState<ApiKeyModelPermissionInput[]>(initialPermissions);
  // Logging override: untouched until the user picks a value, so unrelated
  // edits never touch logging. The stored explicit value comes from policy.
  const [loggingTouched, setLoggingTouched] = useState<{ touched: boolean; value: boolean | null }>({
    touched: false,
    value: null,
  });
  const loggingSettings = usePromptLoggingSettings(orgId);
  const serverLogging: boolean | null =
    loggingSettings.data && typeof loggingSettings.data.key_states[orgKey.id] === "boolean"
      ? (loggingSettings.data.key_states[orgKey.id] as boolean)
      : null;
  const loggingValue = loggingTouched.touched ? loggingTouched.value : serverLogging;
  const loggingDirty =
    !loggingSettings.isError && !!loggingSettings.data && loggingTouched.touched && loggingTouched.value !== serverLogging;
  const keyTeamIds = orgKey.team_id ? [orgKey.team_id] : [];
  const [saving, setSaving] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [rotateArmed, setRotateArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsedIp = useMemo(() => parseIpRules(allow, deny), [allow, deny]);
  const status = orgKeyStatus(orgKey);

  const dirty = useMemo(() => {
    const metaDirty =
      name.trim() !== orgKey.name ||
      (description.trim() || "") !== (orgKey.description ?? "") ||
      enabled !== enabledDefault ||
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
    enabledDefault,
    expiresAt,
    initialExpires,
    orgKey,
    policy,
    initialPolicy,
    parsedIp,
    initialIp,
    permissions,
    initialPermissions,
  ]);
  const isDirty = dirty.meta || dirty.policy || dirty.ip || dirty.models || loggingDirty;

  function reset() {
    setName(orgKey.name);
    setDescription(orgKey.description ?? "");
    setEnabled(enabledDefault);
    setExpiresAt(initialExpires);
    setExpiryPreset(orgKey.expires_at ? "custom" : "never");
    setPolicy(initialPolicy);
    setAllow(initialIp.allow);
    setDeny(initialIp.deny);
    setPermissions(initialPermissions);
    setLoggingTouched({ touched: false, value: null });
    setRotateArmed(false);
    setError(null);
  }

  function selectAllModels() {
    const existing = new Map(permissions.map((p) => [permKey(p.provider_id, p.model_id), p]));
    const selected = models.map((model) => {
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
    for (const p of permissions) {
      if (!p.model_id && !selected.some((s) => permKey(s.provider_id, s.model_id) === permKey(p.provider_id, p.model_id))) {
        selected.push(p);
      }
    }
    setPermissions(selected);
  }

  function clearAllModels() {
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
        tasks.push(
          mut.updateKey.mutateAsync({
            keyId: orgKey.id,
            patch: {
              name: trimmedName,
              description: description.trim() || null,
              enabled,
              expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
            },
          }),
        );
      }
      if (dirty.policy) {
        tasks.push(
          mut.updateKeyPolicy.mutateAsync({ keyId: orgKey.id, policy: hasPolicyValues(policy) ? policy : {} }),
        );
      }
      if (dirty.ip) tasks.push(mut.updateKeyIpRules.mutateAsync({ keyId: orgKey.id, rules: parsedIp.rules }));
      if (dirty.models) {
        tasks.push(mut.updateKeyModelPermissions.mutateAsync({ keyId: orgKey.id, permissions }));
      }
      if (loggingDirty) {
        tasks.push(updateKeyLoggingState(orgId, orgKey.id, loggingValue));
      }
      await Promise.all(tasks);
      if (loggingDirty) await qc.invalidateQueries({ queryKey: ["prompt-logs"] });
      toast.success("Organization key updated.");
      onSaved();
    } catch (e) {
      setError(parseApiError(e).message);
    } finally {
      setSaving(false);
    }
  }

  async function rotate() {
    setRotating(true);
    setError(null);
    try {
      const res = await mut.rotateKey.mutateAsync(orgKey.id);
      const raw = res.raw_key;
      if (!raw) {
        throw new Error("The server did not return a key secret. The key may still have been rotated — check the list.");
      }
      toast.success(`Key "${orgKey.name}" rotated.`);
      onRotated(raw, orgKey.name);
    } catch (e) {
      setError(parseApiError(e).message);
    } finally {
      setRotating(false);
      setRotateArmed(false);
    }
  }

  return (
    <DetailPanel
      open={open}
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          <KeyRound className="size-3.5 shrink-0 text-zinc-400" aria-hidden="true" />
          Edit {orgKey.name}
        </span>
      }
      subtitle={
        <span className="font-mono">
          {orgKey.masked ?? orgKey.key_prefix ?? ""}
          {assigneeLabel ? ` · ${assigneeLabel}` : ""}
          {orgName ? ` · ${orgName}` : ""}
        </span>
      }
      actions={<ApiKeyStatusPill status={status} />}
      width="min(94vw,560px)"
      testId="org-key-edit-drawer"
      label={`Edit ${orgKey.name}`}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={reset} disabled={saving || rotating || !isDirty}>
            Reset
          </Button>
          <Button
            size="sm"
            onClick={() => void save()}
            disabled={saving || rotating || !isDirty || parsedIp.invalid.length > 0}
            data-testid="org-key-edit-save"
            className={cn(!isDirty && "opacity-70")}
          >
            {saving && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
            Save changes
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        <Section
          icon={KeyRound}
          title="General"
          description="Display name and an optional note. The secret is never shown here."
        >
          <div className="flex min-w-0 flex-col gap-1">
            <label
              htmlFor="org-key-edit-name"
              className="text-[10px] font-medium uppercase tracking-wider text-zinc-400"
            >
              Name
            </label>
            <Input
              id="org-key-edit-name"
              value={name}
              disabled={saving || rotating}
              onChange={(event) => setName(event.target.value)}
              placeholder="Backend service"
              maxLength={120}
              className="h-9 text-sm"
              data-testid="org-key-edit-name"
            />
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <label
              htmlFor="org-key-edit-description"
              className="text-[10px] font-medium uppercase tracking-wider text-zinc-400"
            >
              Description
            </label>
            <Textarea
              id="org-key-edit-description"
              value={description}
              disabled={saving || rotating}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What this key is used for, where it is deployed…"
              maxLength={500}
              className="min-h-16 text-sm"
              data-testid="org-key-edit-description"
            />
          </div>
          <div className="rounded-lg border border-zinc-200 px-3 py-2 transition-colors hover:border-zinc-300 dark:border-zinc-800 dark:hover:border-zinc-700">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-xs font-medium text-zinc-700 dark:text-zinc-300">Key enabled</p>
                <p className="text-[10px] text-zinc-400">
                  {orgKey.last_used_at || orgKey.used_at
                    ? `Last used ${fmtDateTime(orgKey.last_used_at ?? orgKey.used_at ?? null)}.`
                    : "Never used."}
                </p>
              </div>
              <Switch
                checked={enabled}
                disabled={saving || rotating}
                onCheckedChange={setEnabled}
                aria-label="Key enabled"
                data-testid="org-key-edit-enabled"
              />
            </div>
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
              if (next === "never") {
                setExpiresAt("");
                return;
              }
              if (next === "custom") {
                if (!expiresAt) setExpiresAt(initialExpires);
                return;
              }
              const days = EXPIRY_DAYS[next];
              setExpiresAt(toDateTimeLocal(new Date(Date.now() + days * 86_400_000).toISOString()));
            }}
            options={EXPIRY_OPTIONS}
            ariaLabel="Expiration preset"
            size="sm"
            disabled={saving || rotating}
            testId="org-key-edit-expiry-preset"
          />
          {expiryPreset === "custom" && (
            <Input
              type="datetime-local"
              value={expiresAt}
              disabled={saving || rotating}
              onChange={(event) => setExpiresAt(event.target.value)}
              className="h-9 text-sm"
              aria-label="Custom expiration"
              data-testid="org-key-edit-expires"
            />
          )}
        </Section>

        <Separator />

        <Section
          icon={SlidersHorizontal}
          title="Budget & limits"
          description="Hard cap, reset window, rate limits and spend caps. Empty = unlimited."
        >
          <PolicyForm value={policy} onChange={setPolicy} disabled={saving || rotating} />
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
            disabled={saving || rotating}
          />
        </Section>

        <Separator />

        <Section
          icon={ShieldCheck}
          title="Model access"
          description="Restrict the key to selected org models. Empty selection allows all org models."
        >
          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={saving || rotating}
              onClick={selectAllModels}
              data-testid="org-key-model-access-select-all"
            >
              Select all
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={saving || rotating}
              onClick={clearAllModels}
              data-testid="org-key-model-access-clear-all"
            >
              Clear all
            </Button>
          </div>
          <ModelPermissionsEditor
            value={permissions}
            onChange={setPermissions}
            disabled={saving || rotating}
            models={models}
            providers={providers}
            isPending={modelsQuery.isPending || providersQuery.isPending}
            configureHref={`/organizations/${orgId}?section=providers`}
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

        <Separator />

        <Section
          icon={ShieldCheck}
          title="Guardrails"
          description="Key-specific policies. Inherited global/provider and mandatory org policies apply automatically; saving here never rotates the key."
        >
          <KeyGuardrailsSection orgId={orgId} keyId={orgKey.id} disabled={saving || rotating} />
        </Section>

        {!loggingSettings.isError && (
          <>
            <Separator />

            <Section
              icon={ShieldCheck}
              title="Prompt logging"
              description="Override workspace logging for this key. Only sent when changed."
            >
              <KeyLoggingField
                orgId={orgId}
                keyId={orgKey.id}
                keyTeamIds={keyTeamIds}
                value={loggingValue}
                onChange={(v) => setLoggingTouched({ touched: true, value: v })}
                disabled={saving || rotating}
                testIdPrefix="org-key-edit"
              />
            </Section>
          </>
        )}

        <Separator />

        <Section
          icon={RotateCw}
          title="Rotate secret"
          description="Replaces the secret. The old key stops working immediately — a separate, deliberate action."
        >
          {!rotateArmed ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={saving || rotating}
              onClick={() => setRotateArmed(true)}
              data-testid="org-key-rotate-open"
            >
              Rotate secret…
            </Button>
          ) : (
            <div className="rounded-lg border border-red-200 bg-red-50/60 p-3 dark:border-red-900/50 dark:bg-red-950/20">
              <p className="text-xs font-medium text-red-800 dark:text-red-200">
                Rotate “{orgKey.name}”?
              </p>
              <p className="mt-0.5 text-[11px] text-red-700/80 dark:text-red-300/80">
                Applications using the current secret will be rejected immediately. This cannot be
                undone — the new secret is shown once.
              </p>
              <div className="mt-2 flex justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={rotating}
                  onClick={() => setRotateArmed(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  disabled={rotating}
                  onClick={() => void rotate()}
                  data-testid="org-key-rotate-confirm"
                >
                  {rotating && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
                  Rotate now
                </Button>
              </div>
            </div>
          )}
        </Section>

        {error && (
          <p
            className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300"
            data-testid="org-key-edit-error"
          >
            {error}
          </p>
        )}
      </div>
    </DetailPanel>
  );
});
