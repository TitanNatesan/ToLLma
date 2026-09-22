"use client";

/** Shared <think> contract with the backend reasoning pipeline.
 *
 * Every provider adapter normalizes reasoning into <think>…</think> spans
 * embedded in the assistant text (see services/gateway/adapters/base.py
 * THINK_OPEN/THINK_CLOSE). Both markdown renderers split on these spans —
 * one implementation, provider-blind. Persisted rows keep the spans, so
 * refresh restores reasoning for free. An unclosed trailing span (mid-stream)
 * renders as thinking too, so reasoning never blends into the answer.
 */

export interface ThinkPart {
  type: "think" | "text";
  content: string;
}

const OPEN_TAG = "<think>";
const CLOSE_TAG = "</think>";

export function splitThinkBlocks(content: string): ThinkPart[] {
  const parts: ThinkPart[] = [];
  let i = 0;
  while (i < content.length) {
    const start = content.indexOf(OPEN_TAG, i);
    if (start === -1) {
      parts.push({ type: "text", content: content.slice(i) });
      break;
    }
    if (start > i) parts.push({ type: "text", content: content.slice(i, start) });
    const end = content.indexOf(CLOSE_TAG, start + OPEN_TAG.length);
    if (end === -1) {
      // Still streaming: render the open span as thinking immediately
      // (never leak `<think>`/reasoning into the answer text).
      parts.push({ type: "think", content: content.slice(start + OPEN_TAG.length) });
      break;
    }
    parts.push({ type: "think", content: content.slice(start + OPEN_TAG.length, end) });
    i = end + CLOSE_TAG.length;
  }
  return parts;
}
