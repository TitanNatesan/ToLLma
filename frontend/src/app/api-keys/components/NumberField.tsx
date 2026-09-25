"use client";

import { useId, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { Input } from "@/components/ui";
import { cn } from "@/lib/utils";

interface NumberFieldProps {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  placeholder?: string;
  /** Rendered as a unit chip after the input (e.g. "USD", "tokens/min"). */
  suffix?: string;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  hint?: string;
  className?: string;
  testId?: string;
  /** Render the current value through a formatter next to the label. */
  format?: (value: number) => string;
  /** Hide the +/− steppers (default: shown). */
  stepper?: boolean;
}

/**
 * Nullable numeric input with custom steppers and no native spinner UI.
 * Keeps a local text buffer so typing "1." or "0.05" is never fought by the
 * controlled value; emits `null` for an empty field (the API's "unlimited").
 */
export function NumberField({
  label,
  value,
  onChange,
  placeholder = "Unlimited",
  suffix,
  min = 0,
  max,
  step = 1,
  disabled = false,
  hint,
  className,
  testId,
  format,
  stepper = true,
}: NumberFieldProps) {
  const inputId = useId();
  const [text, setText] = useState(value === null ? "" : String(value));
  const [lastValue, setLastValue] = useState(value);

  // Adjust the buffer during render when the parent value changes externally
  // (form reset); intermediate text like "1." is preserved. React's blessed
  // "derive state from props" pattern avoids a sync effect.
  if (value !== lastValue) {
    setLastValue(value);
    const parsed = text.trim() === "" ? null : Number(text);
    const inSync = value === null ? text.trim() === "" : parsed === value;
    if (!inSync) setText(value === null ? "" : String(value));
  }

  const clamp = (n: number) => {
    let next = Math.max(min, n);
    if (max !== undefined) next = Math.min(max, next);
    return next;
  };

  function handleChange(raw: string) {
    setText(raw);
    const trimmed = raw.trim();
    if (trimmed === "") {
      onChange(null);
      return;
    }
    const n = Number(trimmed);
    if (Number.isFinite(n) && n >= min && (max === undefined || n <= max)) onChange(n);
  }

  function handleBlur() {
    const trimmed = text.trim();
    if (trimmed === "") {
      if (value !== null) onChange(null);
      return;
    }
    const n = Number(trimmed);
    if (!Number.isFinite(n)) {
      setText(value === null ? "" : String(value));
      return;
    }
    const clamped = clamp(n);
    if (clamped !== n) {
      setText(String(clamped));
      onChange(clamped);
    }
  }

  const atMin = value !== null && value <= min;
  const atMax = value !== null && max !== undefined && value >= max;

  function bump(direction: -1 | 1) {
    if (disabled) return;
    if (direction < 0 && (value === null || atMin)) return;
    const base = value ?? (min > 0 ? min : 0);
    const raw = direction > 0 ? base + step : base - step;
    const next = clamp(Math.round(raw * 1e6) / 1e6);
    setText(String(next));
    onChange(next);
  }

  const formatted = format && value !== null ? format(value) : null;

  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <label
          htmlFor={inputId}
          className="text-[10px] font-medium uppercase tracking-wider text-zinc-400"
        >
          {label}
        </label>
        {formatted && (
          <span className="font-mono text-[10px] tabular-nums text-zinc-500 dark:text-zinc-400">
            {formatted}
          </span>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <div className="relative flex min-w-0 flex-1 items-center">
          <Input
            id={inputId}
            type="number"
            inputMode="decimal"
            min={min}
            max={max}
            step={step}
            value={text}
            disabled={disabled}
            placeholder={placeholder}
            onChange={(event) => handleChange(event.target.value)}
            onBlur={handleBlur}
            className={cn(
              "h-8 text-xs tabular-nums",
              stepper && "pr-14",
              "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
            )}
            data-testid={testId}
          />
          {stepper && (
            <span className="absolute inset-y-0 right-1 flex items-center gap-0.5">
              <button
                type="button"
                tabIndex={-1}
                disabled={disabled || value === null || atMin}
                onClick={() => bump(-1)}
                aria-label={`Decrease ${label}`}
                title={`Decrease ${label}`}
                data-testid={testId ? `${testId}-decrease` : undefined}
                className="flex size-6 items-center justify-center rounded-[5px] text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 disabled:pointer-events-none disabled:opacity-35 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
              >
                <Minus className="size-3" />
              </button>
              <button
                type="button"
                tabIndex={-1}
                disabled={disabled || atMax}
                onClick={() => bump(1)}
                aria-label={`Increase ${label}`}
                title={`Increase ${label}`}
                data-testid={testId ? `${testId}-increase` : undefined}
                className="flex size-6 items-center justify-center rounded-[5px] text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 disabled:pointer-events-none disabled:opacity-35 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
              >
                <Plus className="size-3" />
              </button>
            </span>
          )}
        </div>
        {suffix && (
          <span className="flex h-8 shrink-0 items-center rounded-md border border-zinc-200 bg-zinc-50/70 px-2 text-[10px] font-medium text-zinc-400 dark:border-zinc-800 dark:bg-zinc-900/60">
            {suffix}
          </span>
        )}
      </div>
      {hint && <span className="text-[10px] text-zinc-400">{hint}</span>}
    </div>
  );
}
