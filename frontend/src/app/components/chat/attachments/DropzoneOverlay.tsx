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
 * AI SDK Elements Drag-and-Drop Overlay Component.
 *
 * Renders an accessible, beautiful dropzone overlay when files are dragged
 * over the chat composer.
 */
function DropzoneOverlayInner({ isDragging, className, acceptLabel }: DropzoneOverlayProps) {
  if (!isDragging) return null;

  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center rounded-2xl",
        "border-2 border-dashed border-tollma-500 bg-tollma-50/90 p-4 text-center backdrop-blur-xs",
        "dark:border-tollma-400 dark:bg-tollma-950/90 animate-in fade-in-0 duration-150",
        className,
      )}
      data-testid="composer-dropzone"
      data-dropzone="true"
    >
      <div className="flex size-12 items-center justify-center rounded-full bg-tollma-100 text-tollma-700 shadow-sm dark:bg-tollma-900 dark:text-tollma-300">
        <UploadCloud className="size-6 animate-bounce" />
      </div>
      <p className="mt-2 text-sm font-semibold text-tollma-900 dark:text-tollma-100">
        Drop files here to attach
      </p>
      {acceptLabel && (
        <p className="mt-0.5 text-xs text-tollma-700/80 dark:text-tollma-300/80">
          Supported: {acceptLabel}
        </p>
      )}
    </div>
  );
}

export const DropzoneOverlay = memo(DropzoneOverlayInner);
