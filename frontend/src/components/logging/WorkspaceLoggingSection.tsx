"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "@/lib/notify";
import { Button, ErrorState, LoadingState, SettingItem, Switch } from "@/components/ui";
import { ConfirmDialog } from "@/app/api-keys/components/ConfirmDialog";
import { toastApiError } from "@/lib/errors";
import {
  usePromptLoggingSettings,
  useUpdatePromptLoggingSettings,
} from "@/hooks/usePromptLogs";
import {
  GLOBAL_MANDATORY_COPY,
  buildSettingsPayload,
  formatEffectiveSummaryWithStates,
  isGlobalLoggingLocked,
  validateHierarchicalStates,
  type SettingsDraft,
} from "@/app/prompt-logs/components/promptLogLogic";

/**
 * Prompt Logging summary for workspace/org settings surfaces: global toggle
 * with mandatory-global explainer + confirm, effective summary line, and a
 * link to the full Prompt Logs controls. Reuses the settings primitives.
 */
export function WorkspaceLoggingSection({ orgId, canManage }: {
  orgId?: string;
  canManage: boolean;
}) {
  const settings = usePromptLoggingSettings(orgId);
  const update = useUpdatePromptLoggingSettings(orgId);
  const [confirmGlobal, setConfirmGlobal] = useState(false);

  if (settings.isPending) {
    return <LoadingState message="Loading logging policy…" />;
  }
  if (settings.isError || !settings.data) {
    return (
      <ErrorState
        title="Could not load logging policy"
        message="The logging service is unavailable."
        onRetry={() => void settings.refetch()}
      />
    );
  }
  const s = settings.data;
  const globalOn = isGlobalLoggingLocked(s);
  const readonly = !canManage;

  function draftFor(global: boolean): SettingsDraft {
    return {
      enabled: global,
      mode: global ? "global" : s.mode,
      team_ids: [...(s.team_ids ?? [])],
      key_ids: [...(s.key_ids ?? [])],
      capture_input: s.capture_input,
      capture_output: s.capture_output,
      retention_days: s.retention_days != null ? String(s.retention_days) : "",
    };
  }

  async function apply(global: boolean) {
    // Enabling global while explicit disables exist is a 422 — refuse early.
    if (global) {
      const err = validateHierarchicalStates({
        enabled: true,
        mode: "global",
        team_states: s.team_states,
        key_states: s.key_states,
      });
      if (err) {
        toast.error(err);
        return;
      }
    }
    try {
      await update.mutateAsync(buildSettingsPayload(draftFor(global), orgId ?? null));
      toast.success(global ? "Global logging enabled." : "Global logging disabled.");
    } catch (e) {
      toastApiError(e, { title: "Could not update logging policy" });
    }
  }

  return (
    <div data-testid="workspace-logging">
      <SettingItem
        label="Global logging"
        description="When on, every request in this workspace is recorded."
      >
        <Switch
          checked={globalOn}
          disabled={readonly || update.isPending}
          onCheckedChange={(v) => {
            if (readonly) return;
            if (v) setConfirmGlobal(true);
            else void apply(false);
          }}
          aria-label="Global prompt logging"
          data-testid="workspace-logging-global"
        />
      </SettingItem>
      <p className="py-2 text-xs text-zinc-600 dark:text-zinc-400" data-testid="workspace-logging-effective">
        {formatEffectiveSummaryWithStates(s.effective_summary, s)}
      </p>
      {globalOn && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300" data-testid="workspace-logging-global-note">
          {GLOBAL_MANDATORY_COPY}
        </p>
      )}
      {readonly && (
        <p className="py-1 text-[11px] text-zinc-400">
          You need logging-manage permission to change this.
        </p>
      )}
      <div className="flex justify-end pt-2">
        <Link href="/prompt-logs?tab=settings" data-testid="workspace-logging-open">
          <Button size="sm" variant="outline">Open Prompt Logs</Button>
        </Link>
      </div>
      <ConfirmDialog
        open={confirmGlobal}
        destructive
        title="Log every request in this workspace?"
        description={GLOBAL_MANDATORY_COPY}
        confirmLabel="Enable global logging"
        onClose={() => setConfirmGlobal(false)}
        onConfirm={() => apply(true).then(() => setConfirmGlobal(false))}
      />
    </div>
  );
}
