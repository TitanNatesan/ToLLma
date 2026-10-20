"use client";

import { memo } from "react";
import { UploadCloud } from "lucide-react";
import { cn } from "@/lib/utils";

export interface DropzoneOverlayProps {
  isDragging: boolean;
  className?: string;
  acceptLabel?: string;
}

/**
 * Full-viewport drag-and-drop overlay (AI SDK Elements Attachments pattern).
 *
 * Fixed to the viewport so a drag anywhere in the app is a drop target —
 * callers keep the window-level drag listeners; this is presentation only.
 */
function DropzoneOverlayInner({ isDragging, className, acceptLabel }: DropzoneOverlayProps) {
  if (!isDragging) return null;

  return (
    <div
      className={cn(
        "pointer-events-none fixed inset-0 z-[60] flex items-center justify-center",
        "bg-zinc-950/60 backdrop-blur-sm dark:bg-zinc-950/70",
        "animate-in fade-in-0 duration-150",
        className,
      )}
      data-testid="composer-dropzone"
      data-dropzone="true"
    >
      <div className="mx-4 flex flex-col items-center rounded-3xl border-2 border-dashed border-tollma-400 bg-white/95 px-10 py-8 text-center shadow-2xl animate-in zoom-in-95 duration-150 dark:border-tollma-500 dark:bg-zinc-900/95">
        <div className="flex size-12 items-center justify-center rounded-full bg-tollma-100 text-tollma-700 shadow-sm dark:bg-tollma-900 dark:text-tollma-300">
          <UploadCloud className="size-6 animate-bounce" />
        </div>
        <p className="mt-3 text-base font-semibold text-zinc-900 dark:text-zinc-100">
          Drop files to attach
        </p>
        {acceptLabel && (
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Supported: {acceptLabel}
          </p>
        )}
      </div>
    </div>
  );
}

export const DropzoneOverlay = memo(DropzoneOverlayInner);
