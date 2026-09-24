"use client";

import { ImageIcon, Video } from "lucide-react";
import { cn } from "@/lib/utils";

export interface MediaGenerationSkeletonProps {
  kind: "image" | "video";
  /** Human state label (e.g. "Generating image…", "Uploading…"). */
  label?: string;
  className?: string;
}

/**
 * Shimmer placeholder shown the moment a media generation starts, so the
 * assistant card is never blank. Replaced by the real attachment on completion.
 */
export function MediaGenerationSkeleton({ kind, label, className }: MediaGenerationSkeletonProps) {
  return (
    <div className={cn("my-1.5 space-y-1.5", className)} data-testid={`media-skeleton-${kind}`}>
      <div
        className={cn(
          "relative w-full animate-pulse overflow-hidden rounded-xl border border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900",
          kind === "image" ? "aspect-square max-w-md" : "aspect-video max-w-2xl",
        )}
      >
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-zinc-400">
          {kind === "image" ? <ImageIcon className="size-7" /> : <Video className="size-7" />}
          <span className="text-[10px] font-semibold tracking-widest uppercase">
            {kind === "image" ? "Image generating" : "Video generating"}
          </span>
        </div>
      </div>
      {label && (
        <p className="text-xs text-zinc-500" data-testid="media-skeleton-label">
          {label}
        </p>
      )}
    </div>
  );
}
