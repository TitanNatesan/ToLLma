"use client";

/** Reasoning display helpers (AI SDK Elements Reasoning & Chain-of-Thought
 *  patterns, ToLLma-native). Pure functions — unit tested, no DOM. */

export type ReasoningStatus = "thinking" | "streaming" | "complete" | "interrupted" | "failed";

export const REASONING_STATUS_LABEL: Record<ReasoningStatus, string> = {
  thinking: "Thinking…",
  streaming: "Thinking…",
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
    case "thinking":
    case "streaming":
      return "Thinking…";
    case "interrupted":
      return durationMs != null ? `Stopped after ${formatReasoningDuration(durationMs)}` : "Stopped";
    case "failed":
      return "Reasoning failed";
    case "complete":
    default:
      return durationMs != null ? `Thought for ${formatReasoningDuration(durationMs)}` : "Thinking";
  }
}

/**
 * Extracts distinct reasoning steps if present in structured chain-of-thought text
 * (e.g. "Step 1: ...", "1. ...", "### Step 1: ...").
 * Returns an array of detected steps, or empty array if unstructured.
 */
export function extractReasoningSteps(content: string): string[] {
  const trimmed = content.trim();
  if (!trimmed) return [];

  // Match numbered steps like:
  // 1. Step description...
  // Step 1: Description...
  // ### Step 1: Description...
  const stepRegex = /(?:^|\n)(?:(?:#{1,4}\s*)?(?:Step\s*\d+[:.]?|\d+\.)\s*)([^\n]+)/gi;
  const matches: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = stepRegex.exec(trimmed)) !== null) {
    const title = match[1]?.trim();
    if (title && title.length > 2 && !matches.includes(title)) {
      matches.push(title);
    }
  }
  return matches;
}
