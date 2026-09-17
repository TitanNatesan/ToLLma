"use client";

// Minimal stream timing instrumentation (Problem 5 deliverable).
// Bounded in-memory ring + console.debug lines; no UI, no network.
// Inspect live via window.__tollmaPerf.last().

export interface ChatPerfSample {
  startedAt: number;
  firstTokenAt: number | null;
  doneAt: number | null;
  status: string | null;
  deltas: number;
  snapshotBytes: number;
}

const HISTORY_LIMIT = 20;
const history: ChatPerfSample[] = [];
let current: ChatPerfSample | null = null;

export function perfSend(): void {
  current = { startedAt: performance.now(), firstTokenAt: null, doneAt: null, status: null, deltas: 0, snapshotBytes: 0 };
}

export function perfSnapshot(bytes: number): void {
  if (!current || current.firstTokenAt !== null) return;
  if (bytes > 0) {
    current.firstTokenAt = performance.now();
    current.snapshotBytes = bytes;
  }
}

export function perfDelta(): void {
  if (!current) return;
  if (current.firstTokenAt === null) current.firstTokenAt = performance.now();
  current.deltas += 1;
}

export function perfDone(status?: string | null): ChatPerfSample | null {
  if (!current) return null;
  current.doneAt = performance.now();
  current.status = status ?? null;
  const sample = current;
  current = null;
  history.push(sample);
  if (history.length > HISTORY_LIMIT) history.shift();
  const ttf = sample.firstTokenAt !== null ? `${Math.round(sample.firstTokenAt - sample.startedAt)}ms` : "n/a";
  const total = sample.doneAt !== null ? `${Math.round(sample.doneAt - sample.startedAt)}ms` : "n/a";
  console.debug(`[tollma-perf] first-token=${ttf} total=${total} deltas=${sample.deltas} status=${sample.status}`);
  return sample;
}

export function perfLast(): ChatPerfSample | null {
  return history.length > 0 ? history[history.length - 1] : null;
}

if (typeof window !== "undefined") {
  (window as unknown as { __tollmaPerf: unknown }).__tollmaPerf = { last: perfLast, history: () => [...history] };
}
