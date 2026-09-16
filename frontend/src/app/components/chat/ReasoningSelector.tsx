"use client";

import { useState } from "react";
import { Brain } from "lucide-react";
import { cn } from "@/lib/utils";

/** Slider generated from the model's reasoning_levels — never hardcoded.
 *  Compact indicator by default; full scale reveals on hover / focus /
 *  drag like a volume control. Hidden entirely when the model has no
 *  levels (caller also gates on supports_reasoning). */
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
  if (levels.length === 0) return null;
  const index = Math.max(0, levels.indexOf(value ?? levels[0]));
  const current = levels[index];

  return (
    <div
      className="group relative flex items-center"
      data-testid="reasoning-selector"
      role="group"
      aria-label="Thinking level"
    >
      {/* Compact indicator — the only thing visible at rest */}
      <span
        data-testid="reasoning-value"
        className="inline-flex h-7 items-center gap-1.5 rounded-md border border-zinc-200 px-2 text-xs text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
      >
        <Brain className="size-3.5" />
        <span className="font-medium capitalize">{current}</span>
      </span>

      {/* Expanded scale — hover / keyboard focus / drag only */}
      {levels.length > 1 && (
        <div
          className={cn(
            "absolute bottom-full left-0 z-20 mb-2 w-56 rounded-lg border border-zinc-200 bg-white p-3 shadow-lg",
            "dark:border-zinc-700 dark:bg-zinc-900",
            "pointer-events-none translate-y-1 opacity-0 transition-all duration-150",
            "group-hover:pointer-events-auto group-hover:translate-y-0 group-hover:opacity-100",
            "group-focus-within:pointer-events-auto group-focus-within:translate-y-0 group-focus-within:opacity-100",
            dragging && "pointer-events-auto translate-y-0 opacity-100",
          )}
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
              Thinking
            </span>
            <span className="text-xs font-medium capitalize text-tollma-600 dark:text-tollma-400">
              {current}
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={levels.length - 1}
            step={1}
            value={index}
            onChange={(e) => onChange(levels[Number(e.target.value)])}
            onPointerDown={() => setDragging(true)}
            onPointerUp={() => setDragging(false)}
            onBlur={() => setDragging(false)}
            aria-label="Thinking level slider"
            aria-valuetext={current}
            data-testid="reasoning-slider"
            className="w-full accent-tollma-600 dark:accent-tollma-500"
          />
          <div className="mt-1.5 flex items-start justify-between gap-1">
            {levels.map((level, i) => (
              <button
                key={level}
                type="button"
                onClick={() => onChange(level)}
                aria-pressed={i === index}
                aria-label={`Thinking level ${level}`}
                data-testid={`reasoning-level-${level}`}
                className={cn(
                  "flex-1 rounded px-1 py-0.5 text-center text-[10px] capitalize transition-colors",
                  i === index
                    ? "bg-tollma-600 font-medium text-white dark:bg-tollma-500"
                    : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200",
                )}
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
