"use client";

// Shared copy-to-clipboard control. One implementation, one live-region
// announcement, one failure path — used by code snippets and command pills.

import { useCallback, useEffect, useRef, useState } from "react";
import { IconCheck, IconCopy } from "@/components/ui/icons";

type State = "idle" | "copied" | "failed";

export function CopyButton({
  value,
  label = "Copy",
  className = "",
}: {
  value: string;
  label?: string;
  className?: string;
}) {
  const [state, setState] = useState<State>("idle");
  const timer = useRef<number | null>(null);

  const copy = useCallback(async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        const ta = document.createElement("textarea");
        ta.value = value;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        ta.remove();
        if (!ok) throw new Error("copy failed");
      }
      setState("copied");
    } catch {
      setState("failed");
    }
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState("idle"), 1800);
  }, [value]);

  useEffect(() => {
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, []);

  const text = state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : label;

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={state === "failed" ? "Copy failed" : label}
      className={
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-ink-soft " +
        "transition-[color,border-color,background-color] duration-[var(--dur-fast)] " +
        "hover:border-brand hover:text-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand " +
        className
      }
    >
      {state === "copied" ? <IconCheck size={14} /> : <IconCopy size={14} />}
      <span aria-live="polite">{text}</span>
    </button>
  );
}
