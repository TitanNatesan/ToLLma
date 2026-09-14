"use client";

import { FileText, Music, Film, X } from "lucide-react";
import type { AttachmentKind, ComposerAttachment } from "./capabilities";

const KIND_ICON = { image: null, file: FileText, audio: Music, video: Film } as const;

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Preview chips for staged attachments, removable before send. */
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
        return (
          <span
            key={a.id}
            data-testid={`attachment-chip-${a.id}`}
            className="inline-flex max-w-48 items-center gap-1.5 rounded-md border border-tollma-200 bg-tollma-50 py-1 pl-1 pr-1.5 text-xs text-zinc-700 dark:border-tollma-800 dark:bg-tollma-950 dark:text-zinc-300"
          >
            {a.kind === "image" && a.previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={a.previewUrl} alt={a.name} className="size-6 rounded object-cover" />
            ) : (
              Icon && <Icon className="size-3.5 shrink-0 text-tollma-600 dark:text-tollma-400" />
            )}
            <span className="truncate font-medium">{a.name}</span>
            <span className="shrink-0 text-[10px] text-zinc-400">{formatSize(a.size)}</span>
            <button
              type="button"
              aria-label={`Remove ${a.name}`}
              onClick={() => onRemove(a.id)}
              className="flex size-4 shrink-0 items-center justify-center rounded text-zinc-400 hover:bg-zinc-200 hover:text-zinc-600 dark:hover:bg-zinc-700 dark:hover:text-zinc-300"
            >
              <X className="size-3" />
            </button>
          </span>
        );
      })}
    </div>
  );
}
