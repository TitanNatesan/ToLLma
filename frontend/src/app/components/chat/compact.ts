import type { CompactResult } from "@/types";
import { ApiError } from "@/services/api";
import { fmtTokens } from "@/lib/utils";

/** Exact-match slash command. Leading/trailing whitespace is ignored;
 *  anything else (`/compactanything`, `/compact now`) is ordinary text. */
export const COMPACT_COMMAND = "/compact";

export function isCompactCommand(text: string): boolean {
  return text.trim() === COMPACT_COMMAND;
}

/** Manual compaction only runs past 20% of the model's context window. */
export const COMPACT_THRESHOLD_FRACTION = 0.2;

function usageSuffix(usage: number | null, window: number | null): string {
  if (usage == null || window == null) return "";
  return ` Current usage is ${fmtTokens(usage)} of ${fmtTokens(window)} tokens.`;
}

export function compactNoConversationMessage(): string {
  return "Start or open a conversation first — /compact needs an active conversation.";
}

export function compactBusyMessage(): string {
  return "A generation or compaction is already running — wait for it to finish, then re-enter /compact.";
}

/** Below-threshold copy. Usage/window append when the backend supplied them. */
export function compactThresholdMessage(usage: number | null, window: number | null): string {
  return (
    "Conversation compaction is available once the context usage exceeds 20%." +
    usageSuffix(usage, window)
  );
}

export function compactSuccessMessage(result: CompactResult): string {
  const { tokens_before, tokens_after } = result;
  if (tokens_before != null && tokens_after != null) {
    return `Conversation compacted: ${fmtTokens(tokens_before)} → ${fmtTokens(tokens_after)} tokens.`;
  }
  return "Conversation compacted.";
}

export type CompactFailureKind = "threshold" | "busy" | "not-found" | "error";

export interface CompactFailure {
  kind: CompactFailureKind;
  title: string;
  description: string;
}

/** Backend detail message, tolerant of envelope/string/empty bodies. */
function detailOf(error: unknown): string {
  const data = error instanceof ApiError ? error.data : null;
  if (typeof data === "string" && data.trim()) return data.slice(0, 300);
  if (data && typeof data === "object") {
    const rec = data as Record<string, unknown>;
    const err = rec.error as Record<string, unknown> | undefined;
    const msg = err?.message ?? rec.message ?? rec.detail;
    if (typeof msg === "string" && msg.trim()) return msg.slice(0, 300);
  }
  return "";
}

/** Map the compact endpoint's failures to actionable copy. 422 below 20%
 *  prefers the backend's message, then the caller's live usage/window
 *  fallback (older backends send only a message — the threshold sentence
 *  still stands on its own). */
/** Config failures share the 422 status with below-threshold rejections and
 *  the backend envelope carries the same VALIDATION_ERROR code for both, so
 *  branch on the distinct detail text (backend: compaction.py). */
function isConfigError(detail: string): boolean {
  const text = detail.toLowerCase();
  return text.includes("no active model") || text.includes("no context-window metadata");
}

/** Window for the below-threshold fallback copy. Usage belongs to the
 *  conversation's model, not the composer's selection: prefer the
 *  conversation model's own window; when it names a different model than the
 *  selection, return null so no mixed-model percentage renders as fact. */
export function resolveFallbackWindow(
  convModelId: string | null | undefined,
  selectedModelId: string | null | undefined,
  models: ReadonlyArray<{ id: string; context_window: number | null }>,
): number | null {
  if (convModelId) {
    if (convModelId !== selectedModelId) return null;
    return models.find((m) => m.id === convModelId)?.context_window ?? null;
  }
  if (!selectedModelId) return null;
  return models.find((m) => m.id === selectedModelId)?.context_window ?? null;
}

export function describeCompactFailure(error: unknown, thresholdFallback?: string): CompactFailure {
  const status = error instanceof ApiError ? error.status : 0;
  const detail = detailOf(error);
  if (status === 422) {
    if (isConfigError(detail)) {
      return {
        kind: "error",
        title: "Compaction unavailable",
        description: detail,
      };
    }
    return {
      kind: "threshold",
      title: "Not enough context to compact",
      description: detail || thresholdFallback || compactThresholdMessage(null, null),
    };
  }
  if (status === 409) {
    return {
      kind: "busy",
      title: "Compaction already running",
      description: detail || compactBusyMessage(),
    };
  }
  if (status === 404) {
    return {
      kind: "not-found",
      title: "Conversation not found",
      description: detail || "That conversation no longer exists.",
    };
  }
  return {
    kind: "error",
    title: "Compaction failed",
    description: detail || "Something went wrong — re-enter /compact to retry.",
  };
}

/** Summary-node trigger badge. The backend nests it at
 *  `metadata.compaction.trigger` ("auto" | "manual"); flat variants are
 *  accepted for tolerance. Absent on older responses — null renders no badge. */
export function getSummaryTrigger(metadata: Record<string, unknown> | undefined): "auto" | "manual" | null {
  const nested = metadata?.compaction as Record<string, unknown> | undefined;
  const raw = nested?.trigger ?? metadata?.compaction_trigger ?? metadata?.trigger;
  return raw === "auto" || raw === "manual" ? raw : null;
}
