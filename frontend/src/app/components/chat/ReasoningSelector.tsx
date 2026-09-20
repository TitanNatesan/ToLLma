"use client";

import { useEffect, useRef, useState } from "react";
import { Brain } from "lucide-react";
import { cn } from "@/lib/utils";
import { cycleReasoningLevel, stepReasoningLevel } from "./reasoningLevels";

/** How long the scale stays open after the cursor leaves (ms). */
export const REASONING_CLOSE_DELAY_MS = 300;
/** Wheel events inside this window are ignored so one flick = one level. */
export const REASONING_WHEEL_COOLDOWN_MS = 120;
/** Accumulated wheel delta required before a gesture steps a level
 *  (trackpads emit many tiny deltas per gesture). */
export const REASONING_WHEEL_STEP_DELTA = 24;

/** Slider generated from the model's reasoning_levels — never hardcoded.
 *  Compact indicator by default; the full scale reveals on hover / keyboard
 *  focus like a volume control. Clicking the indicator cycles levels
 *  (None → Low → … → High → None); scrolling over the selector steps through
 *  them. Expand is instant, collapse waits REASONING_CLOSE_DELAY_MS so
 *  accidental cursor slips don't close it. Hidden entirely when the model has
 *  no levels (caller also gates on supports_reasoning). */
export function ReasoningSelector({
  levels,
  value,
  onChange,
}: {
  levels: string[];
  value: string | null;
  onChange: (level: string) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  // Mouse clicks move focus to the indicator; that must cycle, not open the
  // scale. Keyboard focus still opens it.
  const pointerFocus = useRef(false);
  const wheelAccum = useRef(0);
  const wheelAt = useRef(0);
  const expanded = open || dragging;

  useEffect(() => {
    const t = closeTimer.current;
    return () => {
      if (t) clearTimeout(t);
    };
  }, []);

  // React's synthetic wheel handler cannot preventDefault (passive root
  // listener), so a non-passive native listener owns wheel stepping. While
  // the scale is closed the handler bails out and the page scrolls untouched.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    function handleWheel(e: WheelEvent) {
      if (!expanded) return;
      e.preventDefault();
      const now = Date.now();
      if (now - wheelAt.current < REASONING_WHEEL_COOLDOWN_MS) return;
      wheelAccum.current += e.deltaY;
      if (Math.abs(wheelAccum.current) < REASONING_WHEEL_STEP_DELTA) return;
      const direction = wheelAccum.current < 0 ? 1 : -1;
      wheelAccum.current = 0;
      wheelAt.current = now;
      const next = stepReasoningLevel(levels, value, direction);
      if (next && next !== value) onChange(next);
    }
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [expanded, levels, value, onChange]);

  function handleEnter() {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    setOpen(true);
  }

  function handleLeave() {
    pointerFocus.current = false;
    wheelAccum.current = 0;
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), REASONING_CLOSE_DELAY_MS);
  }

  function selectLevel(level: string) {
    if (level !== value) onChange(level);
  }

  function handleIndicatorClick() {
    const next = cycleReasoningLevel(levels, value);
    if (next) selectLevel(next);
  }

  function handleIndicatorKey(e: React.KeyboardEvent) {
    const direction =
      e.key === "ArrowUp" || e.key === "ArrowRight"
        ? 1
        : e.key === "ArrowDown" || e.key === "ArrowLeft"
          ? -1
          : 0;
    if (direction === 0) return;
    e.preventDefault();
    const next = stepReasoningLevel(levels, value, direction);
    if (next) selectLevel(next);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape" && expanded) {
      setOpen(false);
      setDragging(false);
    }
  }

  if (levels.length === 0) return null;
  const index = Math.max(0, levels.indexOf(value ?? levels[0]));
  const current = levels[index];
  // Native range thumbs travel inset by half their width; stop dots and
  // labels share that geometry so every label sits under its stop.
  const stopPct = (i: number) => (levels.length > 1 ? i / (levels.length - 1) : 0);
  const labelLeft = (i: number) => `calc(8px + (100% - 16px) * ${stopPct(i)})`;
  const panelWidth = levels.length > 5 ? "w-72" : levels.length > 4 ? "w-64" : "w-56";

  return (
    <div
      ref={rootRef}
      className="relative flex items-center"
      data-testid="reasoning-selector"
      role="group"
      aria-label="Thinking level"
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      onFocus={() => {
        if (pointerFocus.current) {
          pointerFocus.current = false;
          return;
        }
        handleEnter();
      }}
      onBlur={handleLeave}
      onKeyDown={handleKeyDown}
    >
      {/* Compact indicator — click cycles, hover/focus reveals the scale */}
      <button
        type="button"
        data-testid="reasoning-value"
        data-level={current}
        aria-label={`Thinking level: ${current}`}
        aria-expanded={expanded}
        title="Click to cycle thinking level"
        onPointerDown={() => {
          pointerFocus.current = true;
        }}
        onClick={handleIndicatorClick}
        onKeyDown={handleIndicatorKey}
        className={cn(
          "inline-flex h-7 items-center gap-1.5 rounded-md border border-zinc-200 px-2 text-xs text-zinc-500 transition-colors",
          "hover:bg-zinc-100 hover:text-zinc-700 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tollma-500/50",
        )}
      >
        <Brain className="size-3.5" />
        <span className="font-medium capitalize">{current}</span>
      </button>

      {/* Expanded scale — hover / keyboard focus / drag, with close delay */}
      {levels.length > 1 && (
        <div
          data-testid="reasoning-scale"
          className={cn(
            "absolute bottom-full left-0 z-20 mb-2 rounded-lg border border-zinc-200 bg-white p-3 shadow-lg",
            "dark:border-zinc-700 dark:bg-zinc-900",
            "transition-all duration-150",
            panelWidth,
            expanded
              ? "pointer-events-auto translate-y-0 opacity-100"
              : "pointer-events-none translate-y-1 opacity-0",
          )}
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
              Thinking
            </span>
            <span
              data-testid="reasoning-scale-value"
              className="text-xs font-medium capitalize text-tollma-600 dark:text-tollma-400"
            >
              {current}
            </span>
          </div>

          {/* Discrete stop dots — one per level, walking the thumb travel */}
          <div className="relative mb-1 h-2">
            <div className="pointer-events-none absolute inset-x-2 top-0 h-full" aria-hidden="true">
              {levels.map((level, i) => (
                <span
                  key={level}
                  data-testid={`reasoning-stop-${level}`}
                  className={cn(
                    "absolute top-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full transition-colors",
                    i === index ? "bg-tollma-600 dark:bg-tollma-400" : "bg-zinc-300 dark:bg-zinc-600",
                  )}
                  style={{ left: `${stopPct(i) * 100}%` }}
                />
              ))}
            </div>
          </div>

          <input
            type="range"
            min={0}
            max={levels.length - 1}
            step={1}
            value={index}
            onChange={(e) => selectLevel(levels[Number(e.target.value)])}
            onPointerDown={() => setDragging(true)}
            onPointerUp={() => setDragging(false)}
            onBlur={() => setDragging(false)}
            aria-label="Thinking level slider"
            aria-valuetext={current}
            data-testid="reasoning-slider"
            className="w-full accent-tollma-600 dark:accent-tollma-500"
          />

          {/* Labels under their stop points; click selects immediately */}
          <div className="relative mt-1.5 h-5">
            {levels.map((level, i) => (
              <button
                key={level}
                type="button"
                onClick={() => selectLevel(level)}
                aria-pressed={i === index}
                aria-label={`Thinking level ${level}`}
                data-testid={`reasoning-level-${level}`}
                className={cn(
                  "absolute top-0 -translate-x-1/2 whitespace-nowrap rounded px-1 py-0.5 text-center text-[10px] capitalize transition-colors",
                  i === index
                    ? "bg-tollma-600 font-medium text-white dark:bg-tollma-500"
                    : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200",
                )}
                style={{ left: labelLeft(i) }}
              >
                {level}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
