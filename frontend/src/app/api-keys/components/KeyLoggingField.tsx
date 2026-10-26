"use client";

import { Badge, LoadingState, Select } from "@/components/ui";
import { usePromptLoggingSettings } from "@/hooks/usePromptLogs";
import {
  isGlobalLoggingLocked,
  resolveKeyLogging,
  scopeEffectiveLine,
  type ScopeLoggingView,
} from "@/app/prompt-logs/components/promptLogLogic";

export interface KeyLoggingFieldProps {
  /** Undefined = personal scope. */
  orgId?: string;
  /** Null in create mode (no stored override yet). */
  keyId?: string | null;
  /** Owning team ids for team-override inheritance (org keys). */
  keyTeamIds?: string[];
  /** Explicit override; null = inherit. Controlled by the parent form. */
  value: boolean | null;
  onChange: (value: boolean | null) => void;
  disabled?: boolean;
  testIdPrefix: string;
}

/**
 * Prompt-logging override picker for API-key forms. Never renders key
 * secrets — names/prefixes only, like every other key surface. Returns null
 * while the policy loads and hides entirely when the backend has no
 * hierarchical support (404) so old backends keep today's behavior.
 */
export function KeyLoggingField({
  orgId,
  keyId,
  keyTeamIds = [],
  value,
  onChange,
  disabled = false,
  testIdPrefix,
}: KeyLoggingFieldProps) {
  const settings = usePromptLoggingSettings(orgId);

  if (settings.isPending) {
    return <LoadingState message="Loading logging policy…" />;
  }
  if (settings.isError || !settings.data) return null;

  const st = settings.data;
  const locked = isGlobalLoggingLocked(st);
  // The parent's controlled value wins (pending edits included); inherit
  // resolves the full chain for stored keys, or the new-key default on create.
  const view: ScopeLoggingView = locked
    ? { explicit: value, effective: true, locked, source: "Global policy" }
    : value !== null
      ? { explicit: value, effective: value, locked, source: "Key override" }
      : keyId
        ? resolveKeyLogging(st, keyId, keyTeamIds)
        : { explicit: null, effective: defaultForNewKey(st), locked, source: "Workspace default" };
  const selected = value === null ? "inherit" : value ? "on" : "off";

  return (
    <div className="flex flex-col gap-1.5" data-testid={`${testIdPrefix}-logging`}>
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={selected}
          onChange={(e) => {
            const raw = (e.target as HTMLSelectElement).value;
            onChange(raw === "inherit" ? null : raw === "on");
          }}
          disabled={disabled || locked}
          sizeVariant="sm"
          className="w-32"
          aria-label="Prompt logging for this key"
          data-testid={`${testIdPrefix}-logging-select`}
        >
          <option value="inherit">Inherited</option>
          <option value="on">On</option>
          <option value="off">Off</option>
        </Select>
        <Badge variant={view.effective ? "success" : "outline"}>
          {view.effective ? "ON" : "OFF"}
        </Badge>
        {locked && <Badge variant="secondary">locked</Badge>}
      </div>
      <p className="text-[11px] text-zinc-500" data-testid={`${testIdPrefix}-logging-effective`}>
        {scopeEffectiveLine(view)}
        {view.explicit !== null && !locked && !disabled && keyId && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="ml-2 font-medium text-tollma-600 underline-offset-2 hover:underline dark:text-tollma-400"
            data-testid={`${testIdPrefix}-logging-reset`}
          >
            Reset to inherit
          </button>
        )}
      </p>
      {locked && (
        <p className="text-[11px] text-zinc-400">
          Locked on by the global workspace policy — per-key controls are disabled.
        </p>
      )}
    </div>
  );
}

/** Workspace default for a key that does not exist yet (no id/teams). */
function defaultForNewKey(s: {
  enabled: boolean;
  mode: string;
  key_ids: string[];
}): boolean {
  if (!s.enabled) return false;
  if (s.mode === "global") return true;
  if (s.mode !== "teams") return true;
  return false;
}
