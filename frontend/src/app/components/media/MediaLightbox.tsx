"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Maximize2, Minus, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface MediaLightboxProps {
  open: boolean;
  onClose: () => void;
  kind: "image" | "video";
  src: string;
  filename: string;
  fileSize?: number | null;
}

function formatBytes(bytes?: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Fullscreen media preview (ChatGPT-style): 90vw/90vh content on a blurred
 * black backdrop. Images support wheel/pinch zoom, pan while zoomed, fit and
 * 1:1 buttons; videos use native controls. ESC, backdrop and the close button
 * dismiss.
 */
export function MediaLightbox({ open, onClose, kind, src, filename, fileSize }: MediaLightboxProps) {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [videoMeta, setVideoMeta] = useState<{ width: number; height: number; duration: number } | null>(null);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const pinch = useRef<{ distance: number; scale: number } | null>(null);
  const viewport = useRef<HTMLDivElement | null>(null);

  const reset = useCallback(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }, []);

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

  if (!open) return null;

  const zoomBy = (factor: number) =>
    setScale((current) => Math.min(8, Math.max(0.2, current * factor)));

  return (
    <div
      aria-label="Media preview"
      aria-modal="true"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-md"
      data-testid="media-lightbox"
      onClick={onClose}
      role="dialog"
    >
      <div className="absolute top-3 right-3 flex items-center gap-1.5" onClick={(event) => event.stopPropagation()}>
        {kind === "image" && (
          <>
            <button
              aria-label="Zoom out"
              className="flex size-8 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
              data-testid="lightbox-zoom-out"
              onClick={() => zoomBy(0.8)}
              type="button"
            >
              <Minus className="size-4" />
            </button>
            <button
              aria-label="Zoom in"
              className="flex size-8 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
              data-testid="lightbox-zoom-in"
              onClick={() => zoomBy(1.25)}
              type="button"
            >
              <Plus className="size-4" />
            </button>
            <button
              aria-label="Fit to screen"
              className="flex size-8 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
              data-testid="lightbox-fit"
              onClick={reset}
              type="button"
            >
              <Maximize2 className="size-4" />
            </button>
            <button
              className="rounded-full bg-white/10 px-2.5 py-1.5 text-[11px] font-medium text-white hover:bg-white/20"
              data-testid="lightbox-actual"
              onClick={() => {
                setScale(1);
                setOffset({ x: 0, y: 0 });
              }}
              type="button"
            >
              1:1
            </button>
          </>
        )}
        <a
          aria-label="Download"
          className="flex size-8 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
          data-testid="lightbox-download"
          download={filename}
          href={src}
        >
          <Download className="size-4" />
        </a>
        <button
          aria-label="Close preview"
          className="flex size-8 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
          data-testid="lightbox-close"
          onClick={onClose}
          type="button"
        >
          <X className="size-4" />
        </button>
      </div>

      <div
        className="flex max-h-[90vh] max-w-[90vw] flex-col items-center gap-2"
        onClick={(event) => event.stopPropagation()}
      >
        {kind === "image" ? (
          <div
            className={cn("relative flex items-center justify-center overflow-hidden", scale > 1 && "cursor-grab")}
            data-testid="lightbox-image-viewport"
            onPointerDown={(event) => {
              if (scale <= 1) return;
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
              setScale(Math.min(8, Math.max(0.2, pinch.current.scale * (distance / pinch.current.distance))));
            }}
            onTouchEnd={() => {
              pinch.current = null;
            }}
            onWheel={(event) => {
              event.preventDefault();
              zoomBy(event.deltaY < 0 ? 1.15 : 0.87);
            }}
            ref={viewport}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              alt={filename}
              className="max-h-[90vh] max-w-[90vw] select-none rounded-lg object-contain"
              data-testid="lightbox-image"
              draggable={false}
              src={src}
              style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }}
            />
          </div>
        ) : (
          <video
            autoPlay
            className="max-h-[90vh] max-w-[90vw] rounded-lg bg-black"
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
        <div className="flex flex-wrap items-center justify-center gap-3 text-[11px] text-zinc-400">
          <span className="max-w-[60vw] truncate">{filename}</span>
          {kind === "video" && videoMeta && (
            <>
              <span data-testid="lightbox-video-duration">{Math.round(videoMeta.duration)}s</span>
              <span data-testid="lightbox-video-resolution">
                {videoMeta.width}×{videoMeta.height}
              </span>
            </>
          )}
          {fileSize ? <span data-testid="lightbox-size">{formatBytes(fileSize)}</span> : null}
        </div>
      </div>
    </div>
  );
}
