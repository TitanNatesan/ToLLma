"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentType,
  type KeyboardEvent,
} from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// SelectField — Radix popover listbox. No native <select>, full keyboard
// support (arrows/home/end/enter/escape), dark-first styling. The repo has no
// Popover wrapper in `@/components/ui`, so this is the thin wrapper.
// ---------------------------------------------------------------------------

export interface SelectOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

interface SelectFieldProps {
  /** Visible field label; omit when the control sits next to its own label. */
  label?: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  size?: "sm" | "default";
  hint?: string;
  className?: string;
  /** Placed on the trigger; also used to derive option test ids. */
  testId?: string;
  /** Accessible name when there is no visible label. */
  ariaLabel?: string;
}

export function SelectField({
  label,
  value,
  onChange,
  options,
  placeholder = "Select…",
  disabled = false,
  size = "default",
  hint,
  className,
  testId,
  ariaLabel,
}: SelectFieldProps) {
  const [open, setOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const controlId = useId();
  const listboxId = `${controlId}-listbox`;
  const selected = options.find((option) => option.value === value);

  const focusSelected = useCallback(() => {
    const list = listRef.current;
    if (!list) return;
    const target =
      list.querySelector<HTMLButtonElement>('[role="option"][aria-selected="true"]') ??
      list.querySelector<HTMLButtonElement>('[role="option"]:not([disabled])');
    target?.focus();
  }, []);

  // Radix autofocuses the content; redirect focus to the active option.
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(focusSelected);
    return () => cancelAnimationFrame(frame);
  }, [open, focusSelected]);

  function handleListKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const keys = ["ArrowDown", "ArrowUp", "Home", "End"];
    if (!keys.includes(event.key)) return;
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]:not([disabled])'),
    );
    if (items.length === 0) return;
    event.preventDefault();
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    let next = current;
    if (event.key === "ArrowDown") next = current < 0 ? 0 : (current + 1) % items.length;
    if (event.key === "ArrowUp") next = current <= 0 ? items.length - 1 : current - 1;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = items.length - 1;
    items[next]?.focus();
  }

  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      {label && (
        <label
          htmlFor={controlId}
          className="text-[10px] font-medium uppercase tracking-wider text-zinc-400"
        >
          {label}
        </label>
      )}
      <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
        <PopoverPrimitive.Trigger asChild>
          <button
            id={controlId}
            type="button"
            role="combobox"
            aria-expanded={open}
            aria-controls={open ? listboxId : undefined}
            aria-haspopup="listbox"
            aria-label={ariaLabel}
            disabled={disabled}
            data-testid={testId}
            className={cn(
              "flex w-full items-center justify-between gap-2 rounded-md border border-zinc-300 bg-white text-left text-zinc-900 transition-colors",
              "hover:border-zinc-400 focus-visible:border-tollma-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tollma-500/40",
              "disabled:cursor-not-allowed disabled:opacity-50",
              "dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:border-zinc-600",
              size === "sm" ? "h-8 px-2.5 text-xs" : "h-9 px-3 text-sm",
              !selected && "text-zinc-400 dark:text-zinc-500",
            )}
          >
            <span className="min-w-0 flex-1 truncate">{selected ? selected.label : placeholder}</span>
            <ChevronDown
              className={cn(
                "shrink-0 text-zinc-400 transition-transform",
                open && "rotate-180",
                size === "sm" ? "size-3.5" : "size-4",
              )}
            />
          </button>
        </PopoverPrimitive.Trigger>
        <PopoverPrimitive.Portal>
          <PopoverPrimitive.Content
            sideOffset={4}
            align="start"
            collisionPadding={8}
            className={cn(
              "z-50 max-h-64 w-[var(--radix-popover-trigger-width)] overflow-hidden rounded-lg border border-zinc-200 bg-white p-1 shadow-xl",
              "dark:border-zinc-800 dark:bg-zinc-900",
              "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
            )}
            data-testid={testId ? `${testId}-menu` : undefined}
          >
            <div
              ref={listRef}
              id={listboxId}
              role="listbox"
              aria-label={label ?? ariaLabel}
              className="max-h-60 overflow-y-auto"
              onKeyDown={handleListKeyDown}
            >
              {options.map((option) => {
                const active = option.value === value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="option"
                    aria-selected={active}
                    disabled={option.disabled}
                    onClick={() => {
                      onChange(option.value);
                      setOpen(false);
                    }}
                    data-testid={testId ? `${testId}-option-${option.value}` : undefined}
                    className={cn(
                      "flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                      "focus:bg-zinc-100 focus:outline-none dark:focus:bg-zinc-800",
                      active
                        ? "bg-tollma-50 text-tollma-800 dark:bg-tollma-950/50 dark:text-tollma-200"
                        : "text-zinc-700 dark:text-zinc-300",
                      option.disabled && "pointer-events-none opacity-50",
                    )}
                  >
                    <span
                      className={cn(
                        "mt-0.5 flex size-3.5 shrink-0 items-center justify-center",
                        active ? "text-tollma-600 dark:text-tollma-400" : "text-transparent",
                      )}
                    >
                      <Check className="size-3.5" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{option.label}</span>
                      {option.description && (
                        <span className="mt-0.5 block truncate text-[10px] text-zinc-400">
                          {option.description}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </PopoverPrimitive.Content>
        </PopoverPrimitive.Portal>
      </PopoverPrimitive.Root>
      {hint && <span className="text-[10px] text-zinc-400">{hint}</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Segmented — mutually exclusive control for small option sets (< 6).
// ---------------------------------------------------------------------------

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: ComponentType<{ className?: string }>;
  disabled?: boolean;
}

interface SegmentedProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: ReadonlyArray<SegmentedOption<T>>;
  ariaLabel: string;
  size?: "sm" | "default";
  disabled?: boolean;
  className?: string;
  testId?: string;
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
  size = "default",
  disabled = false,
  className,
  testId,
}: SegmentedProps<T>) {
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const keys = ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"];
    if (!keys.includes(event.key)) return;
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]:not([disabled])'),
    );
    if (items.length === 0) return;
    event.preventDefault();
    const current = items.findIndex((item) => item === document.activeElement);
    const forward = event.key === "ArrowRight" || event.key === "ArrowDown";
    const next = forward
      ? (current + 1 + items.length) % items.length
      : (current - 1 + items.length) % items.length;
    const target = items[next];
    target.focus();
    const nextValue = target.dataset.value as T | undefined;
    if (nextValue !== undefined) onChange(nextValue);
  }

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      data-testid={testId}
      onKeyDown={handleKeyDown}
      className={cn(
        "inline-flex w-full items-center gap-0.5 rounded-lg border border-zinc-200 bg-zinc-100/70 p-0.5 dark:border-zinc-800 dark:bg-zinc-900/70",
        className,
      )}
    >
      {options.map((option) => {
        const Icon = option.icon;
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled || option.disabled}
            onClick={() => onChange(option.value)}
            data-value={option.value}
            data-testid={testId ? `${testId}-${option.value}` : undefined}
            className={cn(
              "flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tollma-500/40",
              size === "sm" ? "px-2 py-1 text-[10px]" : "px-2.5 py-1.5 text-[11px]",
              active
                ? "bg-white text-zinc-900 shadow-xs dark:bg-zinc-800 dark:text-zinc-100"
                : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100",
              (disabled || option.disabled) && "cursor-not-allowed opacity-50",
            )}
          >
            {Icon && <Icon className="size-3 shrink-0" aria-hidden="true" />}
            <span className="truncate">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
