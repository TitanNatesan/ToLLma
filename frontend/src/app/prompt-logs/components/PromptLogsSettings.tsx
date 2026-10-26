"use client";

import { useMemo, useState } from "react";
import { ScrollText } from "lucide-react";
import {
  Button,
  Checkbox,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  SearchInput,
  Select,
  SettingItem,
  SettingsSection,
  Switch,
} from "@/components/ui";
import { ConfirmDialog } from "@/app/api-keys/components/ConfirmDialog";
import { toast } from "@/lib/notify";
import { parseApiError, toastApiError } from "@/lib/errors";
import { ApiError } from "@/services/api";
import {
  usePromptLogRetention,
  usePromptLogTeams,
  usePromptLoggingSettings,
  useUpdatePromptLoggingSettings,
} from "@/hooks/usePromptLogs";
import { useChatKeys } from "@/hooks/useChatKeys";
import { useOrgKeys } from "@/hooks/useOrgs";
import {
  buildSettingsPayload,
  formatEffectiveSummary,
  formatLogTime,
  loggingPrecedenceCopy,
  validateSettingsDraft,
  type SettingsDraft,
} from "./promptLogLogic";

/** Selectable key target: names/prefixes only — secrets never render here. */
interface KeyOption {
  id: string;
  name: string;
  hint: string | null;
}

function isNotFound(e: unknown): boolean {
  return e instanceof ApiError && e.status === 404;
}

export function PromptLogsSettings({
  orgId,
  isOrg,
  canManage,
}: {
  orgId?: string;
  isOrg: boolean;
  canManage: boolean;
}) {
  const settings = usePromptLoggingSettings(orgId);
  const teams = usePromptLogTeams(orgId, isOrg && canManage);
  const retention = usePromptLogRetention(orgId, true);
  const update = useUpdatePromptLoggingSettings(orgId);
  // Personal key targets: the user's eligible chat keys (never secrets).
  const chatKeys = useChatKeys();
  // Org key targets: same source as OrgKeysPanel (names/prefixes only).
  const orgKeys = useOrgKeys(orgId ?? "", { enabled: isOrg && !!orgId, params: { limit: 200 } });

  // User edits overlay the persisted policy: null draft means "show the
  // server values". No seeding effect and no render-phase setState — server
  // refetches never clobber in-progress edits, and the form never displays
  // unpersisted policy.
  const [draft, setDraft] = useState<SettingsDraft | null>(null);
  const [keySearch, setKeySearch] = useState("");
  const [confirmGlobal, setConfirmGlobal] = useState(false);
  const s = settings.data;

  const keyOptions: KeyOption[] = useMemo(() => {
    if (!isOrg) {
      return (chatKeys.data ?? [])
        .filter((k) => k.enabled !== false)
        .map((k) => ({
          id: k.id,
          name: k.name,
          hint: k.scope === "organization" ? (k.org_name ?? "org key") : null,
        }));
    }
    return (orgKeys.data ?? []).map((k) => ({
      id: k.id,
      name: k.name,
      hint: k.key_prefix ?? k.masked ?? null,
    }));
  }, [isOrg, chatKeys.data, orgKeys.data]);

  const visibleKeys = useMemo(() => {
    const q = keySearch.trim().toLowerCase();
    if (!q) return keyOptions;
    return keyOptions.filter(
      (k) => k.name.toLowerCase().includes(q) || (k.hint ?? "").toLowerCase().includes(q),
    );
  }, [keyOptions, keySearch]);

  const keysPending = isOrg ? orgKeys.isPending : chatKeys.isPending;
  const keysError = isOrg ? orgKeys.error : chatKeys.error;
  const refetchKeys = isOrg ? () => void orgKeys.refetch() : () => void chatKeys.refetch();

  if (settings.isPending) {
    return <LoadingState message="Loading logging settings…" className="py-12" />;
  }
  if (settings.error || !s) {
    return (
      <div className="p-4">
        <ErrorState
          title="Could not load logging settings"
          message={settings.error ? parseApiError(settings.error).message : "Not found"}
          onRetry={() => void settings.refetch()}
        />
      </div>
    );
  }
  const readonly = !canManage;
  const serverDraft: SettingsDraft = {
    enabled: s.enabled,
    mode: s.mode,
    team_ids: [...(s.team_ids ?? [])],
    key_ids: [...(s.key_ids ?? [])],
    capture_input: s.capture_input,
    capture_output: s.capture_output,
    retention_days: s.retention_days != null ? String(s.retention_days) : "",
  };
  // Non-nullable capture: narrowing on the state binding does not persist
  // into the onSave closure, so bind it once here.
  const form: SettingsDraft = draft ?? serverDraft;
  // Primitives survive closure capture (same narrowing caveat as above).
  const serverIsEnabledGlobal = s.enabled && s.mode === "global";
  /** Patch the overlay, basing untouched fields on the persisted policy. */
  const edit = (patch: Partial<SettingsDraft>) => setDraft({ ...form, ...patch });
  const validationError = validateSettingsDraft(form);
  const metadataOnly = !form.capture_input && !form.capture_output;

  function toggleKey(id: string) {
    if (readonly) return;
    edit({
      key_ids: form.key_ids.includes(id)
        ? form.key_ids.filter((k) => k !== id)
        : [...form.key_ids, id],
    });
  }

  async function persist(current: SettingsDraft) {
    try {
      // One shape for the PUT body (personal scope keeps key targets; teams stay empty).
      await update.mutateAsync(buildSettingsPayload(current, orgId));
      // Drop the overlay: the hook invalidates + refetches the persisted
      // policy, which the form now follows.
      setDraft(null);
      toast.success("Logging settings saved.");
    } catch (e) {
      toastApiError(e, { title: "Save failed", onRetry: () => void persist(current) });
    }
  }

  async function onSave() {
    const current: SettingsDraft = form;
    const err = validateSettingsDraft(current);
    if (err) {
      toast.error(err);
      return;
    }
    // Enabling global, or switching scope to global, broadens capture to
    // every request and clears stored team/key targets — confirm first.
    const broadens =
      current.enabled && current.mode === "global" && !serverIsEnabledGlobal;
    if (broadens) {
      setConfirmGlobal(true);
      return;
    }
    await persist(current);
  }

  return (
    <div className="space-y-2 p-4" data-testid="prompt-logs-settings">
      {!isOrg && (
        <p className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400" data-testid="prompt-logs-personal-note">
          Personal workspace: logs cover only requests made with your personal keys. Organization keys never appear here.
        </p>
      )}

      <SettingsSection title="Capture" description={formatEffectiveSummary(s.effective_summary)}>
        <SettingItem label="Enabled" description="When off, new requests are not recorded.">
          <Switch
            checked={form.enabled}
            onCheckedChange={(v) => !readonly && edit({ enabled: v })}
            disabled={readonly}
            aria-label="Logging enabled"
            data-testid="prompt-settings-enabled"
          />
        </SettingItem>
        <SettingItem label="Scope" description={isOrg ? "Global logs every org request; team mode logs only requests matching the selected teams or keys. Team mode with no teams and no keys logs nothing." : "Global logs every personal request; selected-keys mode logs only requests matching the chosen keys. With no keys selected, nothing is logged."}>
          <Select
            value={form.mode}
            onChange={(e) => !readonly && edit({ mode: e.target.value })}
            disabled={readonly}
            aria-label="Logging scope"
            data-testid="prompt-settings-mode"
          >
            <option value="global">Global (whole workspace)</option>
            {isOrg ? (
              <option value="teams">Selected teams and keys</option>
            ) : (
              <option value="teams">Selected keys</option>
            )}
          </Select>
        </SettingItem>
        {isOrg && form.mode === "teams" && (
          <div className="py-2" data-testid="prompt-settings-teams">
            {teams.isPending ? (
              <LoadingState message="Loading teams…" />
            ) : teams.error || !teams.data ? (
              <ErrorState
                title="Could not load teams"
                message={teams.error ? parseApiError(teams.error).message : "Not found"}
                onRetry={() => void teams.refetch()}
              />
            ) : teams.data.length === 0 ? (
              <p className="text-xs text-zinc-500">No teams in this organization yet.</p>
            ) : (
              <div className="flex flex-wrap gap-3">
                {teams.data.map((t) => (
                  <Checkbox
                    key={t.id}
                    label={t.name}
                    checked={form.team_ids.includes(t.id)}
                    disabled={readonly}
                    onChange={() =>
                      !readonly &&
                      edit({
                        team_ids: form.team_ids.includes(t.id)
                          ? form.team_ids.filter((id) => id !== t.id)
                          : [...form.team_ids, t.id],
                      })
                    }
                    data-testid={`prompt-settings-team-${t.id}`}
                  />
                ))}
              </div>
            )}
          </div>
        )}
        {form.mode !== "global" && (
          <div className="py-2" data-testid="prompt-settings-keys">
            <p className="mb-1 text-xs font-medium text-zinc-800 dark:text-zinc-200">
              Keys {form.key_ids.length > 0 && <span className="font-normal text-zinc-500">({form.key_ids.length} selected)</span>}
            </p>
            <div className="mb-2 max-w-xs">
              <SearchInput
                value={keySearch}
                onChange={(e) => setKeySearch(e.target.value)}
                onClear={() => setKeySearch("")}
                placeholder="Search keys…"
                aria-label="Search keys"
                data-testid="prompt-settings-key-search"
              />
            </div>
            {keysPending ? (
              <LoadingState message="Loading keys…" />
            ) : keysError ? (
              isNotFound(keysError) ? (
                <p className="text-xs text-zinc-500">{isOrg ? "Organization keys aren&apos;t available yet." : "Personal keys aren&apos;t available yet."}</p>
              ) : (
                <ErrorState
                  title="Could not load keys"
                  message={parseApiError(keysError).message}
                  onRetry={refetchKeys}
                />
              )
            ) : keyOptions.length === 0 ? (
              <p className="text-xs text-zinc-500">{isOrg ? "No keys in this organization yet." : "No eligible personal keys yet."}</p>
            ) : visibleKeys.length === 0 ? (
              <p className="text-xs text-zinc-500">No keys match this search.</p>
            ) : (
              <div className="flex max-h-44 flex-col gap-2 overflow-y-auto pr-1">
                {visibleKeys.map((k) => (
                  <Checkbox
                    key={k.id}
                    label={
                      <span className="inline-flex min-w-0 items-baseline gap-1.5">
                        <span className="truncate">{k.name}</span>
                        {k.hint && (
                          <span className="shrink-0 font-mono text-[10px] text-zinc-400">{k.hint}</span>
                        )}
                      </span>
                    }
                    checked={form.key_ids.includes(k.id)}
                    disabled={readonly}
                    onChange={() => toggleKey(k.id)}
                    data-testid={`prompt-settings-key-${k.id}`}
                  />
                ))}
              </div>
            )}
          </div>
        )}
        <p className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400" data-testid="prompt-settings-precedence">
          {loggingPrecedenceCopy(form)}
        </p>
        <SettingItem label="Capture prompt input" description="Store request message bodies.">
          <Checkbox
            checked={form.capture_input}
            disabled={readonly}
            onChange={() => !readonly && edit({ capture_input: !form.capture_input })}
            aria-label="Capture prompt input"
            data-testid="prompt-settings-capture-input"
          />
        </SettingItem>
        <SettingItem label="Capture completion output" description="Store response message bodies.">
          <Checkbox
            checked={form.capture_output}
            disabled={readonly}
            onChange={() => !readonly && edit({ capture_output: !form.capture_output })}
            aria-label="Capture completion output"
            data-testid="prompt-settings-capture-output"
          />
        </SettingItem>
        {metadataOnly && (
          <p className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400" data-testid="prompt-settings-metadata-note">
            Both captures are off: logs record metadata only (timing, tokens, status) with no message bodies.
          </p>
        )}
      </SettingsSection>

      <SettingsSection title="Retention">
        <SettingItem
          label="Retention days"
          description={retention.data ? `Effective: ${retention.data.effective_days} days (default ${retention.data.default_days}). Next cleanup: ${formatLogTime(retention.data.next_run)}.` : "How long message bodies are kept before expiry."}
        >
          <Input
            type="number"
            min={1}
            step={1}
            value={form.retention_days}
            disabled={readonly}
            onChange={(e) => !readonly && edit({ retention_days: e.target.value })}
            placeholder={retention.data ? String(retention.data.default_days) : "30"}
            aria-label="Retention days"
            className="h-8 w-28 text-xs"
            data-testid="prompt-settings-retention"
          />
        </SettingItem>
      </SettingsSection>

      <div className="flex items-center justify-between gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
        <p className="text-[11px] text-zinc-400" data-testid="prompt-settings-audit">
          {s.updated_by ? `Last changed by ${s.updated_by}` : "Never changed"}
          {s.updated_at ? ` · ${formatLogTime(s.updated_at)}` : ""} · v{s.version}
        </p>
        {!readonly && (
          <Button
            size="sm"
            onClick={() => void onSave()}
            disabled={update.isPending || validationError !== null}
            data-testid="prompt-settings-save"
          >
            {update.isPending ? "Saving…" : "Save settings"}
          </Button>
        )}
      </div>
      {readonly && (
        <EmptyState
          icon={ScrollText}
          title="Read-only"
          description="You need the PromptLogs.Manage permission to change logging settings."
          testId="prompt-settings-readonly"
        />
      )}
      <ConfirmDialog
        open={confirmGlobal}
        destructive
        title="Log every request in this workspace?"
        description={isOrg ? "Global scope records all organization requests and clears any stored team and key targets. Narrower targeting is lost." : "Global scope records all personal requests and clears any stored key targets. Narrower targeting is lost."}
        confirmLabel="Enable global logging"
        onClose={() => setConfirmGlobal(false)}
        onConfirm={() => {
          setConfirmGlobal(false);
          return persist(form);
        }}
      />
    </div>
  );
}
