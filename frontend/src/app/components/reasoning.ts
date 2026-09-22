"use client";

/** Reasoning display helpers (AI SDK Elements Reasoning & Chain-of-Thought
 *  patterns, ToLLma-native). Pure functions — unit tested, no DOM. */

export type ReasoningStatus = "thinking" | "streaming" | "complete" | "interrupted" | "failed";

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

export interface ReasoningStep {
  title: string;
  body: string;
}

export interface ReasoningOutline {
  preamble: string;
  steps: ReasoningStep[];
}

/** Line-leading step marker: "1.", "2)", "Step 3:", "### Step 4". */
const STEP_MARKER = /^(?:#{1,4}\s*)?(?:Step\s*\d+[:.]?|\d+[.)])\s*/i;

/**
 * Splits structured reasoning into a preamble plus steps, preserving each
 * step's body (title = marker line, body = the prose that follows it).
 * Returns null for unstructured content or fewer than two steps so callers
 * can fall back to the plain reasoning text.
 */
export function splitReasoningSteps(content: string): ReasoningOutline | null {
  const trimmed = content.trim();
  if (!trimmed) return null;

  const steps: ReasoningStep[] = [];
  const preamble: string[] = [];
  let current: ReasoningStep | null = null;

  for (const line of trimmed.split("\n")) {
    const marker = line.match(STEP_MARKER);
    if (marker) {
      current = { title: line.slice(marker[0].length).trim(), body: "" };
      steps.push(current);
      continue;
    }
    if (current) {
      current.body = current.body ? `${current.body}\n${line}` : line;
    } else {
      preamble.push(line);
    }
  }

  if (steps.length < 2) return null;
  return { preamble: preamble.join("\n").trim(), steps };
}
