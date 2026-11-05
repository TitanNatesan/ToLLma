"use client";

import { useEffect, useMemo, useState } from "react";
import { Maximize2, Monitor, Smartphone, Tablet, X } from "lucide-react";
import { cn } from "@/lib/utils";

/** Languages eligible for website preview (assistant code cells only). */
const PREVIEWABLE_LANGUAGES = new Set(["html", "htm"]);

export function isPreviewableLanguage(rawLang: string | undefined | null): boolean {
  if (!rawLang) return false;
  return PREVIEWABLE_LANGUAGES.has(rawLang.trim().toLowerCase());
}

export interface PreviewDevice {
  id: string;
  label: string;
  /** CSS viewport width in pixels; height stays fluid. */
  width: number;
}

/** Extensible device set — add entries here to support more viewports. */
export const PREVIEW_DEVICES: PreviewDevice[] = [
  { id: "phone", label: "Phone", width: 390 },
  { id: "tablet", label: "Tablet", width: 768 },
  { id: "desktop", label: "Desktop", width: 1280 },
];

export type PreparedPreview = { html: string } | { error: string };

export function isPreviewError(prepared: PreparedPreview): prepared is { error: string } {
  return "error" in prepared;
}

/**
 * Content Security Policy baked into the preview document AND the iframe
 * `csp` attribute. Intentionally strict: no scripts, no same-origin, no
 * plugins, no nested frames, no form submission, no network beyond
 * data:/blob: images and media. Remote stylesheets, fonts, scripts, and
 * images are blocked by design — generated single-file pages render fully,
 * anything else degrades safely instead of leaking requests.
 */
export const PREVIEW_CSP =
  "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; " +
  "img-src data: blob:; font-src data:; media-src data: blob:; " +
  "connect-src 'none'; form-action 'none'; frame-src 'none'; " +
  "object-src 'none'; base-uri 'none';";

function isDeadHref(href: string | null): boolean {
  if (href === null) return true;
  const trimmed = href.trim();
  return trimmed === "" || trimmed === "#";
}

/**
 * Prepares untrusted model-generated HTML for sandboxed display.
 * Parsed in a detached document (never the app DOM — no scripts execute
 * during DOMParser/XMLSerializer round-trips), so malformed or hostile
 * markup cannot touch the chat page; failures surface as an inline error.
 *
 * Anchor policy (no scripts involved, sandbox stays scriptless):
 * - `<a>`, `<a href="">`, `<a href="#">` become inert `<span>`s (attributes
 *   preserved except href/target/rel/ping) so they never navigate, jump the
 *   preview, or bubble to the parent page.
 * - Real destinations keep their href but gain target/rel; the sandbox
 *   (no allow-popups, no top-navigation) still blocks them from navigating
 *   anywhere, isolating external navigation by default.
 */
export function preparePreviewDocument(source: string): PreparedPreview {
  try {
    if (typeof DOMParser === "undefined" || typeof XMLSerializer === "undefined") {
      return { error: "Preview is unavailable in this environment." };
    }
    const doc = new DOMParser().parseFromString(source, "text/html");
    if (doc.querySelector("parsererror")) {
      return { error: "The HTML could not be parsed." };
    }
    for (const anchor of Array.from(doc.querySelectorAll("a"))) {
      const href = anchor.getAttribute("href");
      if (isDeadHref(href)) {
        const span = doc.createElement("span");
        for (const attr of Array.from(anchor.attributes)) {
          if (["href", "target", "rel", "ping"].includes(attr.name.toLowerCase())) continue;
          span.setAttribute(attr.name, attr.value);
        }
        span.setAttribute("data-dead-link", "true");
        while (anchor.firstChild) span.appendChild(anchor.firstChild);
        anchor.replaceWith(span);
      } else {
        anchor.setAttribute("target", "_blank");
        anchor.setAttribute("rel", "noopener noreferrer");
      }
    }
    let head = doc.querySelector("head");
    if (!head) {
      head = doc.createElement("head");
      doc.documentElement.prepend(head);
    }
    const meta = doc.createElement("meta");
    meta.setAttribute("http-equiv", "Content-Security-Policy");
    meta.setAttribute("content", PREVIEW_CSP);
    head.prepend(meta);
    return { html: new XMLSerializer().serializeToString(doc) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not prepare preview." };
  }
}

function SandboxedFrame({ html, title, className }: { html: string; title: string; className?: string }) {
  // Created only when the user requests a preview — never per token.
  // srcDoc changes only when the source string changes, so React does not
  // reload the frame on unrelated re-renders.
  return (
    <iframe
      title={title}
      sandbox=""
      referrerPolicy="no-referrer"
      ref={(el) => {
        // `csp` is not in React's iframe types; set it directly as defense
        // in depth alongside the in-document meta tag.
        el?.setAttribute("csp", PREVIEW_CSP);
      }}
      srcDoc={html}
      className={cn("border-0 bg-white", className)}
      data-testid="html-preview-frame"
    />
  );
}

/** Inline preview area: replaces the code view, keeps header controls. */
export function HtmlPreview({
  source,
  onFullscreen,
  onClose,
}: {
  source: string;
  onFullscreen: () => void;
  onClose: () => void;
}) {
  const prepared = useMemo(() => preparePreviewDocument(source), [source]);
  return (
    <div className="flex flex-col" data-testid="html-preview">
      <div className="flex items-center justify-between gap-2 border-b border-zinc-800 bg-zinc-900/60 px-3 py-1.5">
        <span className="text-[11px] text-zinc-400">Preview — sandboxed, scripts disabled</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onFullscreen}
            className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
            title="Open full-screen preview"
            data-testid="html-preview-open-fullscreen"
          >
            <Maximize2 className="size-3" />
            <span>Full screen</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close preview and show source"
            title="Close preview"
            className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
            data-testid="html-preview-close"
          >
            <X className="size-3" />
            <span>Close</span>
          </button>
        </div>
      </div>
      <div className="h-[420px] max-h-[70vh] min-h-[280px] bg-white">
        {isPreviewError(prepared) ? (
          <div role="alert" className="m-3 rounded-md border border-red-900/50 bg-red-950/40 p-3 text-xs text-red-300">
            Preview unavailable: {prepared.error}
          </div>
        ) : (
          <SandboxedFrame html={prepared.html} title="HTML preview (sandboxed)" className="h-full w-full" />
        )}
      </div>
    </div>
  );
}

const DEVICE_ICONS = { phone: Smartphone, tablet: Tablet, desktop: Monitor } as const;

/** Full-screen overlay: covers the Model Intelligence panel (z-60 over its z-50). */
export function HtmlPreviewFullscreen({
  source,
  title,
  onClose,
}: {
  source: string;
  title: string;
  onClose: () => void;
}) {
  const prepared = useMemo(() => preparePreviewDocument(source), [source]);
  const [deviceId, setDeviceId] = useState<string>("desktop");
  const device = PREVIEW_DEVICES.find((d) => d.id === deviceId) ?? PREVIEW_DEVICES[PREVIEW_DEVICES.length - 1];

  // Escape closes; body scroll locks while open and restores on cleanup.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col bg-zinc-950/95"
      role="dialog"
      aria-modal="true"
      aria-label="HTML preview full screen"
      data-testid="html-preview-fullscreen"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 px-4 py-2.5">
        <span className="truncate text-sm font-medium text-zinc-100">{title}</span>
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Preview device width" className="flex items-center gap-0.5 rounded-lg border border-zinc-800 p-0.5">
            {PREVIEW_DEVICES.map((d) => {
              const Icon = DEVICE_ICONS[d.id as keyof typeof DEVICE_ICONS] ?? Monitor;
              const active = d.id === device.id;
              return (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => setDeviceId(d.id)}
                  aria-pressed={active}
                  title={`${d.label} — ${d.width}px wide`}
                  data-testid={`html-preview-device-${d.id}`}
                  className={cn(
                    "flex items-center gap-1 rounded-md px-2 py-1 text-[11px] transition-colors focus-visible:outline-2 focus-visible:outline-tollma-500",
                    active
                      ? "bg-zinc-100 font-medium text-zinc-900 dark:bg-zinc-100"
                      : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100",
                  )}
                >
                  <Icon className="size-3.5" aria-hidden />
                  <span>{d.label}</span>
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={onClose}
            autoFocus
            className="flex items-center gap-1 rounded-md bg-zinc-100 px-2.5 py-1 text-[11px] font-medium text-zinc-900 transition-colors hover:bg-zinc-200 focus-visible:outline-2 focus-visible:outline-tollma-500"
            data-testid="html-preview-fullscreen-close"
          >
            <X className="size-3.5" aria-hidden />
            <span>Close preview</span>
          </button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 items-start justify-center overflow-auto bg-zinc-900/60 p-4">
        {isPreviewError(prepared) ? (
          <div role="alert" className="mt-8 max-w-lg rounded-md border border-red-900/50 bg-red-950/40 p-4 text-sm text-red-300">
            Preview unavailable: {prepared.error}
          </div>
        ) : (
          <div
            className="h-full min-h-0 w-full overflow-hidden rounded-lg border border-zinc-700 bg-white shadow-2xl"
            style={{ maxWidth: device.width }}
            data-testid={`html-preview-viewport-${device.id}`}
          >
            <SandboxedFrame
              html={prepared.html}
              title={`HTML preview at ${device.label} width`}
              className="h-full min-h-[60vh] w-full"
            />
          </div>
        )}
      </div>
    </div>
  );
}
