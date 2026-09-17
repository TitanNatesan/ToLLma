"use client";

/** Shared <think> contract with the backend reasoning pipeline.
 *
 * Every provider adapter normalizes reasoning into <think>…</think> spans
 * embedded in the assistant text (see services/gateway/adapters/base.py
 * THINK_OPEN/THINK_CLOSE). Both markdown renderers split on these spans —
 * one implementation, provider-blind. Persisted rows keep the spans, so
 * refresh restores reasoning for free.
 */

export interface ThinkPart {
  type: "think" | "text";
  content: string;
}

const THINK_RE = /<think>([\s\S]*?)<\/think>/g;

export function splitThinkBlocks(content: string): ThinkPart[] {
  const parts: ThinkPart[] = [];
  THINK_RE.lastIndex = 0;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = THINK_RE.exec(content)) !== null) {
    if (m.index > last) parts.push({ type: "text", content: content.slice(last, m.index) });
    parts.push({ type: "think", content: m[1] });
    last = m.index + m[0].length;
  }
  if (last < content.length) parts.push({ type: "text", content: content.slice(last) });
  return parts;
}

/** Word count for the Thinking pill label. */
export function countThinkWords(content: string): number {
  const trimmed = content.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}
