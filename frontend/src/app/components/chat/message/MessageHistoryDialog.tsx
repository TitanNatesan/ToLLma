"use client";

import { useState } from "react";
import { GitCompare, History } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/primitives";
import { useMessageHistory } from "@/hooks/useIntelligence";
import { diffLines } from "@/lib/diff";
import { cn } from "@/lib/utils";

export interface MessageHistoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  messageId: string | null;
}

/** Version timeline with a line diff against the selected version. */
export function MessageHistoryDialog({ open, onOpenChange, messageId }: MessageHistoryDialogProps) {
  const { data, isLoading } = useMessageHistory(open ? messageId : null);
  const [compareTo, setCompareTo] = useState<number | null>(null);

  const versions = data?.versions ?? [];
  const baseVersion = compareTo ?? (versions.length > 1 ? versions[versions.length - 2].version_number : null);
  const base = versions.find((version) => version.version_number === baseVersion) ?? null;
  const current = versions.find((version) => version.version_number === data?.current_version) ?? null;
  const diff = base && current ? diffLines(base.content, current.content) : [];

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-w-2xl gap-3" data-testid="message-history-dialog">
        <DialogTitle className="inline-flex items-center gap-2 text-sm font-semibold">
          <History className="size-4" /> Message history
        </DialogTitle>

        {isLoading && <p className="text-xs text-zinc-400">Loading versions…</p>}

        {data && (
          <>
            <div className="flex flex-wrap items-center gap-1.5" data-testid="history-versions">
              {versions.map((version) => (
                <button
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-xs transition-colors",
                    version.version_number === data.current_version
                      ? "border-tollma-500 bg-tollma-50 text-tollma-700 dark:bg-tollma-950/40 dark:text-tollma-300"
                      : "border-zinc-200 text-zinc-500 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800",
                  )}
                  data-testid={`history-version-${version.version_number}`}
                  key={version.id}
                  onClick={() => setCompareTo(version.version_number)}
                  type="button"
                >
                  v{version.version_number}
                </button>
              ))}
            </div>

            {versions.length < 2 && (
              <p className="text-xs text-zinc-400">
                Only one version exists. Editing the message creates a new version here.
              </p>
            )}

            {diff.length > 0 && (
              <div className="space-y-1.5">
                <p className="inline-flex items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                  <GitCompare className="size-3" />
                  v{base?.version_number} → v{current?.version_number}
                </p>
                <pre
                  className="max-h-72 overflow-auto rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-[11px] leading-relaxed dark:border-zinc-800 dark:bg-zinc-900"
                  data-testid="history-diff"
                >
                  {diff.map((line, index) => (
                    <div
                      className={cn(
                        "px-1",
                        line.type === "add" && "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300",
                        line.type === "remove" && "bg-red-50 text-red-700 line-through dark:bg-red-950/30 dark:text-red-300",
                        line.type === "same" && "text-zinc-500 dark:text-zinc-400",
                      )}
                      key={index}
                    >
                      <span className="mr-2 inline-block w-3 text-right text-[9px] opacity-50">
                        {line.type === "add" ? "+" : line.type === "remove" ? "−" : " "}
                      </span>
                      {line.text || " "}
                    </div>
                  ))}
                </pre>
              </div>
            )}

            <div className="space-y-2">
              <p className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                Generations ({data.generations.length})
              </p>
              <ul className="space-y-1" data-testid="history-generations">
                {data.generations.map((run) => (
                  <li
                    className="flex items-center justify-between gap-2 rounded-lg border border-zinc-200 px-3 py-1.5 text-xs dark:border-zinc-800"
                    key={run.id}
                  >
                    <span className="inline-flex items-center gap-2">
                      <span className="font-medium">#{run.generation_number}</span>
                      <span className="text-zinc-500 dark:text-zinc-400">
                        {run.model_name ?? "unknown model"}
                      </span>
                      {run.is_active && (
                        <span className="rounded-full bg-tollma-100 px-1.5 py-0.5 text-[10px] text-tollma-700 dark:bg-tollma-950/40 dark:text-tollma-300">
                          active
                        </span>
                      )}
                    </span>
                    <span className="text-[10px] text-zinc-400">
                      {run.status} · {run.total_tokens ?? 0} tok
                    </span>
                  </li>
                ))}
                {data.generations.length === 0 && (
                  <li className="text-xs text-zinc-400">No generations recorded yet.</li>
                )}
              </ul>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
