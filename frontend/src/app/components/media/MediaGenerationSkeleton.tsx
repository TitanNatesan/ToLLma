"use client";

import { ImageIcon, Video } from "lucide-react";
import { cn } from "@/lib/utils";

export interface MediaGenerationSkeletonProps {
  kind: "image" | "video";
  /** Human state label (e.g. "Generating image…", "Uploading…"). */
  label?: string;
  /** Total planned images for multi-image runs: one skeleton + badge. */
  total?: number;
  className?: string;
}

/**
 * Shimmer placeholder shown the moment a media generation starts, so the
 * assistant card is never blank. Same width caps as the final card (512px
 * images / 720px video), an indeterminate progress sweep, and a live state
 * label. Multi-image runs render ONE skeleton with a count badge — never a
 * stack of loaders. Replaced in place — the media card fades in as this
 * unmounts.
 */
export function MediaGenerationSkeleton({ kind, label, total, className }: MediaGenerationSkeletonProps) {
  const Icon = kind === "image" ? ImageIcon : Video;
  const showTotal = kind === "image" && typeof total === "number" && total > 1;
  return (
    <div className={cn("my-1.5 w-full space-y-1.5", className)} data-testid={`media-skeleton-${kind}`}>
      <div
        className={cn(
          "relative animate-pulse overflow-hidden rounded-xl border border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900",
          kind === "image" ? "aspect-square w-full max-w-[512px]" : "aspect-video w-full max-w-[720px]",
        )}
      >
        {/* Shimmer sweep */}
        <div
          aria-hidden="true"
          className="media-progress-sweep absolute inset-y-0 -left-1/3 w-1/3 bg-gradient-to-r from-transparent via-white/50 to-transparent dark:via-white/10"
        />
        {/* Secondary drifting glow for depth */}
        <div
          aria-hidden="true"
          className="media-progress-glow absolute inset-y-0 -left-1/2 w-1/4 bg-gradient-to-r from-transparent via-tollma-400/20 to-transparent dark:via-tollma-400/10"
        />
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-zinc-400" aria-hidden="true">
          <Icon className="size-8" />
        </div>
        {showTotal && (
          <div
            className="absolute top-2 right-2 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-semibold text-white backdrop-blur-sm"
            data-testid="media-skeleton-count"
          >
            ×{total}
          </div>
        )}
        {/* Indeterminate progress indicator */}
        <div
          aria-hidden="true"
          className="absolute inset-x-3 bottom-3 h-1 overflow-hidden rounded-full bg-zinc-200/80 dark:bg-zinc-800"
        >
          <div className="media-progress-bar h-full w-1/3 rounded-full bg-tollma-500/80" />
        </div>
      </div>
      {(label || showTotal) && (
        <p className="text-xs text-zinc-500" data-testid="media-skeleton-label">
          {label}
          {showTotal && <span className="ml-1 font-medium">· {total} images</span>}
        </p>
      )}
    </div>
  );
}
