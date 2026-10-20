"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

export interface DetailPanelProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  /** Sticky footer (e.g. Save/Reset). Rendered above the panel bottom edge. */
  footer?: ReactNode;
  width?: number | string;
  className?: string;
  testId?: string;
  /** Set false to render the panel without a dimmed backdrop. Defaults true. */
  backdrop?: boolean;
  /** Backdrop test id. Defaults to "<testId>-backdrop" or "drawer-backdrop". */
  backdropTestId?: string;
  /** Panel z-index; backdrop renders 10 below. Defaults 40. */
  zIndex?: number;
  /** Accessible name fallback when title is not plain text. */
  label?: string;
}

/** Close on Escape. No-op while closed. Shared by all drawers via DetailPanel. */
export function useEscapeClose(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
}

/**
 * Dimmed backdrop shared by all drawers: fixed full-viewport,
 * 8px blur over rgba(0,0,0,.35), fade transition, click-to-close.
 */
export function DrawerBackdrop({
  onClose,
  zIndex = 30,
  testId = "drawer-backdrop",
}: {
  onClose: () => void;
  zIndex?: number;
  testId?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      onClick={onClose}
      aria-hidden="true"
      data-testid={testId}
      className="fixed inset-0"
      style={{
        zIndex,
        backgroundColor: "rgba(0,0,0,.35)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
      }}
    />
  );
}

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Shared drawer chrome: backdrop (click-to-close) + Escape-to-close +
 * focus trap with focus return. All drawers must use this — no per-drawer
 * backdrop/escape/focus duplication.
 */
export function DetailPanel({
  open,
  onClose,
  title,
  subtitle,
  children,
  actions,
  footer,
  width = 380,
  className,
  testId,
  backdrop = true,
  backdropTestId,
  zIndex = 40,
  label,
}: DetailPanelProps) {
  const panelRef = useRef<HTMLElement>(null);
  const previouslyFocused = useRef<Element | null>(null);

  useEscapeClose(open, onClose);

  // Focus trap: on open, remember focus and move into the panel; keep Tab
  // cycling inside; on close, return focus to the trigger.
  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement;
    const panel = panelRef.current;
    if (!panel) return;
    const focusables = () =>
      Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
    // Focus first control (usually the close button), else the panel itself.
    const initial = focusables()[0];
    (initial ?? panel).focus({ preventScroll: true });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (event.shiftKey && (active === first || !panel.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      const prev = previouslyFocused.current as HTMLElement | null;
      previouslyFocused.current = null;
      prev?.focus?.({ preventScroll: true });
    };
  }, [open ]);

  const resolvedBackdropTestId =
    backdropTestId ?? (testId ? `${testId}-backdrop` : "drawer-backdrop");

  return (
    <>
      <AnimatePresence>
        {open && backdrop && (
          <DrawerBackdrop
            key="backdrop"
            onClose={onClose}
            zIndex={zIndex - 10}
            testId={resolvedBackdropTestId}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {open && (
          <motion.aside
            ref={panelRef}
            initial={{ x: "100%", opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: "100%", opacity: 0 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            style={{ width: typeof width === "number" ? `min(${width}px, 100vw)` : width, zIndex }}
            role="dialog"
            aria-modal="true"
            aria-label={label}
            tabIndex={-1}
            className={cn(
              "fixed inset-y-0 right-0 flex flex-col border-l border-zinc-200 bg-white shadow-2xl outline-none dark:border-zinc-800 dark:bg-zinc-950",
              className,
            )}
            data-testid={testId}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
              <div className="flex flex-col gap-0.5 truncate pr-2">
                <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                  {title}
                </h2>
                {subtitle && (
                  <div className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                    {subtitle}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {actions}
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                  aria-label="Close panel"
                >
                  <X className="size-4" />
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4">{children}</div>

            {footer && (
              <div className="border-t border-zinc-200 bg-white/95 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950/95">
                {footer}
              </div>
            )}
          </motion.aside>
        )}
      </AnimatePresence>
    </>
  );
}
