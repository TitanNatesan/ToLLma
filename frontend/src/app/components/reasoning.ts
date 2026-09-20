"use client";

/** Reasoning display helpers (AI SDK Elements Reasoning/Chain-of-Thought
 *  patterns, ToLLma-native). Pure functions — unit tested, no DOM. */

export type ReasoningStatus = "streaming" | "complete" | "interrupted" | "failed";

export const REASONING_STATUS_LABEL: Record<ReasoningStatus, string> = {
  streaming: "Thinking",
  complete: "Thinking",
  interrupted: "Stopped",
  failed: "Reasoning failed",
};

/** Human duration: "800ms", "8s", "1m 12s". Sub-second rounds to "<1s". */
export function formatReasoningDuration(ms: number): string {
  if (ms < 1000) return "<1s";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`;
}

/** Pill label per state — duration-aware, provider-blind. */
export function reasoningLabel(status: ReasoningStatus, durationMs?: number | null): string {
  switch (status) {
    case "streaming":
      return "Thinking…";
    case "interrupted":
      return durationMs != null ? `Stopped after ${formatReasoningDuration(durationMs)}` : "Stopped";
    case "failed":
      return "Reasoning failed";
    default:
      return durationMs != null ? `Thought for ${formatReasoningDuration(durationMs)}` : "Thinking";
  }
}
