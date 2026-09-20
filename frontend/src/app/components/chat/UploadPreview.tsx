"use client";

import { AlertCircle, FileText, Film, Loader2, Music, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AttachmentKind, ComposerAttachment } from "./capabilities";

const KIND_ICON = { image: null, file: FileText, audio: Music, video: Film } as const;

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Attachment chips with upload lifecycle states (AI SDK Attachments
 *  pattern): uploading (progress), ready, error — removable before send. */
export function UploadPreview({
  attachments,
  onRemove,
}: {
  attachments: ComposerAttachment[];
  onRemove: (id: string) => void;
}) {
  if (attachments.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5 px-0.5 pb-1.5" data-testid="upload-preview">
      {attachments.map((a) => {
        const Icon = KIND_ICON[a.kind as Exclude<AttachmentKind, "image">];
        const pct = Math.round((a.progress ?? 0) * 100);
        return (
          <span
            key={a.id}
            data-testid={`attachment-chip-${a.id}`}
            data-status={a.status}
            title={a.status === "error" ? a.error : a.name}
            className={cn(
              "relative inline-flex max-w-48 items-center gap-1.5 overflow-hidden rounded-md border py-1 pl-1 pr-1.5 text-xs",
              a.status === "error"
                ? "border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300"
                : "border-tollma-200 bg-tollma-50 text-zinc-700 dark:border-tollma-800 dark:bg-tollma-950 dark:text-zinc-300",
            )}
          >
            {a.kind === "image" && a.previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={a.previewUrl}
                alt={a.name}
                className={cn("size-6 rounded object-cover", a.status === "uploading" && "opacity-60")}
              />
            ) : a.status === "uploading" ? (
              <Loader2 className="size-3.5 shrink-0 animate-spin text-tollma-600 dark:text-tollma-400" />
            ) : a.status === "error" ? (
              <AlertCircle className="size-3.5 shrink-0 text-red-500" />
            ) : (
              Icon && <Icon className="size-3.5 shrink-0 text-tollma-600 dark:text-tollma-400" />
            )}
            <span className="truncate font-medium">{a.name}</span>
            <span className="shrink-0 font-mono text-[10px] text-zinc-400">
              {a.status === "uploading" ? `${pct}%` : a.status === "error" ? "failed" : formatSize(a.size)}
            </span>
            <button
              type="button"
              aria-label={`Remove ${a.name}`}
              onClick={() => onRemove(a.id)}
              className="flex size-4 shrink-0 items-center justify-center rounded text-zinc-400 hover:bg-zinc-200 hover:text-zinc-600 dark:hover:bg-zinc-700 dark:hover:text-zinc-300"
            >
              <X className="size-3" />
            </button>
            {/* Progress rail pinned to the chip's bottom edge */}
            {a.status === "uploading" && (
              <span className="absolute inset-x-0 bottom-0 h-0.5 bg-tollma-200/60 dark:bg-tollma-900">
                <span
                  className="block h-full bg-tollma-500 transition-[width] duration-150"
                  style={{ width: `${pct}%` }}
                />
              </span>
            )}
          </span>
        );
      })}
    </div>
  );
}
