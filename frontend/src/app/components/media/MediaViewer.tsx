"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Maximize2, Minus, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface MediaViewerProps {
  open: boolean;
  onClose: () => void;
  kind: "image" | "video";
  src: string;
  filename: string;
  fileSize?: number | null;
  /** Intrinsic dimensions from message metadata (fallback for the footer). */
  width?: number | null;
  height?: number | null;
  durationSeconds?: number | null;
}

function formatBytes(bytes?: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Unified fullscreen media viewer (images + videos).
 *
 * Backdrop is a dark translucent overlay with a 24px Gaussian blur; content
 * occupies at most 90vw/90vh and stays centered. Images get a single toolbar
 * (zoom out/in, fit, 1:1, download, close) with wheel/pinch zoom and pan while
 * zoomed; videos autoplay with native controls and a download/close toolbar.
 * ESC, backdrop click, and the close button all dismiss.
 */
export function MediaViewer({
  open,
  onClose,
  kind,
  src,
  filename,
  fileSize,
  width,
  height,
  durationSeconds,
}: MediaViewerProps) {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [natural, setNatural] = useState(false);
  const [videoMeta, setVideoMeta] = useState<{
    width: number;
    height: number;
    duration: number;
  } | null>(null);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const pinch = useRef<{ distance: number; scale: number } | null>(null);
  const viewport = useRef<HTMLDivElement | null>(null);

  const reset = useCallback(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }, []);

  // Fresh media resets zoom/fit state without a state-setting effect: the
  // parent keys the viewer per attachment, so mount state is already clean.
  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  // Wheel zoom needs a non-passive native listener (React's onWheel is passive).
  useEffect(() => {
    const node = viewport.current;
    if (!open || kind !== "image" || !node) return;
    function onWheel(event: WheelEvent) {
      event.preventDefault();
      setScale((current) => Math.min(8, Math.max(0.2, current * (event.deltaY < 0 ? 1.15 : 0.87))));
    }
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, [open, kind]);

  if (!open) return null;

  const zoomBy = (factor: number) =>
    setScale((current) => Math.min(8, Math.max(0.2, current * factor)));

  const videoResolution =
    videoMeta && videoMeta.width > 0
      ? `${videoMeta.width}×${videoMeta.height}`
      : width && height
        ? `${width}×${height}`
        : null;
  const videoDuration =
    videoMeta && Number.isFinite(videoMeta.duration) && videoMeta.duration > 0
      ? `${Math.round(videoMeta.duration)}s`
      : durationSeconds
        ? `${Math.round(durationSeconds)}s`
        : null;

  return (
    <div
      aria-label="Media preview"
      aria-modal="true"
      className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/65 backdrop-blur-[24px]"
      data-testid="media-viewer"
      onClick={onClose}
      role="dialog"
    >
      {/* Single toolbar, top-right, aligned for both media kinds. */}
      <div
        className="absolute top-4 right-4 z-10 flex items-center gap-1 rounded-full border border-white/10 bg-black/40 p-1 backdrop-blur-md"
        onClick={(event) => event.stopPropagation()}
      >
        {kind === "image" && (
          <>
            <ToolbarButton label="Zoom out" onClick={() => zoomBy(0.8)} testid="lightbox-zoom-out">
              <Minus className="size-4" />
            </ToolbarButton>
            <ToolbarButton label="Zoom in" onClick={() => zoomBy(1.25)} testid="lightbox-zoom-in">
              <Plus className="size-4" />
            </ToolbarButton>
            <ToolbarButton
              label="Fit to screen"
              onClick={() => {
                setNatural(false);
                reset();
              }}
              testid="lightbox-fit"
            >
              <Maximize2 className="size-4" />
            </ToolbarButton>
            <button
              className={cn(
                "h-8 rounded-full px-2.5 text-[11px] font-medium text-white transition-colors hover:bg-white/15",
                natural && "bg-white/20",
              )}
              data-testid="lightbox-actual"
              onClick={() => {
                setNatural((current) => !current);
                reset();
              }}
              type="button"
            >
              1:1
            </button>
          </>
        )}
        <a
          aria-label="Download"
          className="flex size-8 items-center justify-center rounded-full text-white transition-colors hover:bg-white/15"
          data-testid="lightbox-download"
          download={filename}
          href={src}
        >
          <Download className="size-4" />
        </a>
        <ToolbarButton label="Close preview" onClick={onClose} testid="lightbox-close">
          <X className="size-4" />
        </ToolbarButton>
      </div>

      <div
        className="flex max-h-[90vh] max-w-[90vw] flex-col items-center gap-2"
        onClick={(event) => event.stopPropagation()}
      >
        {kind === "image" ? (
          <div
            className={cn(
              "relative flex max-h-[90vh] max-w-[90vw] items-center justify-center overflow-hidden",
              (scale > 1 || natural) && "cursor-grab active:cursor-grabbing",
            )}
            data-testid="lightbox-image-viewport"
            onPointerDown={(event) => {
              // Natural (1:1) mode can overflow the viewport even at scale 1:
              // still allow panning then.
              if (scale <= 1 && !natural) return;
              drag.current = { x: event.clientX, y: event.clientY, ox: offset.x, oy: offset.y };
              (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
            }}
            onPointerMove={(event) => {
              if (!drag.current) return;
              setOffset({
                x: drag.current.ox + (event.clientX - drag.current.x),
                y: drag.current.oy + (event.clientY - drag.current.y),
              });
            }}
            onPointerUp={() => {
              drag.current = null;
            }}
            onTouchMove={(event) => {
              if (event.touches.length !== 2) return;
              const [a, b] = [event.touches[0], event.touches[1]];
              const distance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
              if (!pinch.current) {
                pinch.current = { distance, scale };
                return;
              }
              setScale(
                Math.min(8, Math.max(0.2, pinch.current.scale * (distance / pinch.current.distance))),
              );
            }}
            onTouchEnd={() => {
              pinch.current = null;
            }}
            ref={viewport}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              alt={filename}
              className={cn(
                "animate-fade-in select-none rounded-lg object-contain",
                natural ? "max-h-none max-w-none" : "max-h-[90vh] max-w-[90vw]",
              )}
              data-testid="lightbox-image"
              draggable={false}
              src={src}
              style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }}
            />
          </div>
        ) : (
          <video
            autoPlay
            className="max-h-[90vh] max-w-[90vw] animate-fade-in rounded-lg bg-black"
            controls
            data-testid="lightbox-video"
            onLoadedMetadata={(event) =>
              setVideoMeta({
                width: event.currentTarget.videoWidth,
                height: event.currentTarget.videoHeight,
                duration: event.currentTarget.duration,
              })
            }
            src={src}
          />
        )}

        <div className="flex flex-wrap items-center justify-center gap-3 text-[11px] text-zinc-300">
          <span className="max-w-[60vw] truncate">{filename}</span>
          {kind === "video" && videoDuration && (
            <span data-testid="lightbox-video-duration">{videoDuration}</span>
          )}
          {kind === "video" && videoResolution && (
            <span data-testid="lightbox-video-resolution">{videoResolution}</span>
          )}
          {fileSize ? <span data-testid="lightbox-size">{formatBytes(fileSize)}</span> : null}
        </div>
      </div>
    </div>
  );
}

function ToolbarButton({
  label,
  onClick,
  testid,
  children,
}: {
  label: string;
  onClick: () => void;
  testid: string;
  children: React.ReactNode;
}) {
  return (
    <button
      aria-label={label}
      className="flex size-8 items-center justify-center rounded-full text-white transition-colors hover:bg-white/15"
      data-testid={testid}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}
