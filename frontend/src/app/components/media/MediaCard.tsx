"use client";

import { useState } from "react";
import { Download, Maximize2 } from "lucide-react";
import { cn, fmtCost } from "@/lib/utils";

export interface MediaCardProps {
  kind: "image" | "video";
  src: string;
  filename: string;
  fileSize?: number | null;
  /** Message generation metadata (resolution/quality/cost/filename). */
  metadata?: Record<string, unknown>;
  /** Message cost columns; metadata.estimated_cost wins when present. */
  cost?: string | null;
  /** False when the cost came from provider usage instead of a rate card. */
  costEstimated?: boolean;
  onOpen: () => void;
  className?: string;
}

function formatBytes(bytes?: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function metaString(metadata: Record<string, unknown> | undefined, key: string): string | null {
  const value = metadata?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function ExpandBadge() {
  return (
    <span className="pointer-events-none absolute right-2 bottom-2 flex size-7 items-center justify-center rounded-full bg-black/50 text-white opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100">
      <Maximize2 className="size-3.5" />
    </span>
  );
}

/**
 * One generated media card: preview plus a metadata footer (filename,
 * resolution, size, cost) inside a single bordered container, centered and
 * width-capped (512px images / 720px video) so media messages align with the
 * rest of the assistant message.
 */
export function MediaCard({
  kind,
  src,
  filename,
  fileSize,
  metadata,
  cost,
  costEstimated = true,
  onOpen,
  className,
}: MediaCardProps) {
  const [dims, setDims] = useState<{ width: number; height: number } | null>(null);
  const [loaded, setLoaded] = useState(false);

  const metadataResolution = metaString(metadata, "resolution");
  const metadataSize = metaString(metadata, "size");
  const resolution =
    dims && dims.width > 0
      ? `${dims.width}×${dims.height}`
      : metadataResolution ?? metadataSize;
  const metadataCost = metaString(metadata, "estimated_cost");
  const displayCost = metadataCost ?? cost ?? null;
  const metadataEstimated = metadata?.cost_estimated;
  const estimated = typeof metadataEstimated === "boolean" ? metadataEstimated : costEstimated;
  const costSource = metaString(metadata, "cost_source");
  const quality = metaString(metadata, "quality");
  const seconds = metaString(metadata, "seconds");

  return (
    <figure
      className={cn(
        "overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xs dark:border-zinc-800 dark:bg-zinc-900/40",
        kind === "image" ? "w-full max-w-[512px]" : "w-full max-w-[720px]",
        className,
      )}
      data-testid={`media-card-${kind}`}
    >
      {kind === "image" ? (
        <button
          aria-label={`Open ${filename} in the media viewer`}
          className="group relative block w-full cursor-zoom-in bg-zinc-950/5 dark:bg-black/40"
          data-testid={`message-image-${filename}`}
          onClick={onOpen}
          type="button"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            alt={filename}
            className={cn(
              "max-h-[70vh] w-full object-contain transition-opacity duration-300",
              loaded ? "opacity-100" : "opacity-0",
            )}
            data-testid={`message-image-preview-${filename}`}
            onLoad={(event) => {
              setLoaded(true);
              setDims({
                width: event.currentTarget.naturalWidth,
                height: event.currentTarget.naturalHeight,
              });
            }}
            src={src}
          />
          <ExpandBadge />
        </button>
      ) : (
        <div className="group relative w-full bg-black" data-testid={`message-video-${filename}`}>
          <video
            className={cn(
              "max-h-[70vh] w-full object-contain transition-opacity duration-300",
              loaded ? "opacity-100" : "opacity-0",
            )}
            controls
            onClick={(event) => {
              // The native control bar occupies the bottom ~48px: play/pause
              // there, open the viewer when the frame itself is clicked.
              const rect = event.currentTarget.getBoundingClientRect();
              if (event.clientY - rect.top < rect.height - 48) onOpen();
            }}
            onLoadedMetadata={(event) => {
              setLoaded(true);
              setDims({
                width: event.currentTarget.videoWidth,
                height: event.currentTarget.videoHeight,
              });
            }}
            preload="metadata"
            src={src}
          />
          <ExpandBadge />
        </div>
      )}

      <figcaption className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-zinc-100 px-3 py-2 text-[11px] text-zinc-500 dark:border-zinc-800">
        <span className="max-w-[240px] truncate font-medium text-zinc-600 dark:text-zinc-300">
          {filename}
        </span>
        {kind === "video" && seconds && <span>{seconds}s</span>}
        {resolution && <span>{resolution}</span>}
        {fileSize ? <span>{formatBytes(fileSize)}</span> : null}
        {kind === "image" && quality && <span className="capitalize">{quality}</span>}
        {displayCost && (
          <span
            className="font-medium text-tollma-600 dark:text-tollma-400"
            data-testid="media-card-cost"
            title={`${costSource ?? (estimated ? "estimated" : "actual")} cost`}
          >
            {fmtCost(displayCost)}
            {estimated ? " est." : ""}
          </span>
        )}
        <a
          className="ml-auto inline-flex items-center gap-1 text-tollma-600 transition-colors hover:text-tollma-700 dark:text-tollma-400 dark:hover:text-tollma-300"
          data-testid="media-card-download"
          download={filename}
          href={src}
        >
          <Download className="size-3" /> Download
        </a>
      </figcaption>
    </figure>
  );
}
