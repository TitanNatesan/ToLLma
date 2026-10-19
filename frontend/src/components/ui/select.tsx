"use client";

import {
  Children,
  Fragment,
  isValidElement,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ParsedSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
  /** Explicit per-option test id; falls back to the derived `${trigger}-option-${value}`. */
  testId?: string;
}

function optionText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(optionText).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return optionText(node.props.children);
  return "";
}

/**
 * Flatten `<option value=...>` children (fragments included) into plain data.
 * Exported so unit tests can cover the parsing without a DOM.
 */
export function parseSelectOptions(children: ReactNode): ParsedSelectOption[] {
  const options: ParsedSelectOption[] = [];
  const visit = (node: ReactNode): void => {
    Children.forEach(node, (child) => {
      if (!isValidElement(child)) return;
      if (child.type === Fragment) {
        visit((child.props as { children?: ReactNode }).children);
        return;
      }
      if (child.type !== "option") return;
      const props = child.props as {
        value?: string | number;
        disabled?: boolean;
        children?: ReactNode;
        "data-testid"?: string;
      };
      options.push({
        value: props.value === undefined || props.value === null ? "" : String(props.value),
        label: optionText(props.children).trim(),
        disabled: props.disabled,
        testId: props["data-testid"],
      });
    });
  };
  visit(children);
  return options;
}

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  sizeVariant?: "default" | "sm";
  wrapperClassName?: string;
  "data-testid"?: string;
}

function fireChange(
  onChange: SelectProps["onChange"],
  value: string,
) {
  onChange?.({ target: { value } } as React.ChangeEvent<HTMLSelectElement>);
}

function enabledButtons(list: HTMLDivElement | null): HTMLButtonElement[] {
  if (!list) return [];
  return Array.from(list.querySelectorAll<HTMLButtonElement>('[role="option"]:not([disabled])'));
}

/**
 * Custom dropdown replacing the native `<select>`: button trigger + listbox,
 * full keyboard support (arrows/Home/End/Enter/Escape/type-ahead), dark-theme
 * styled. Keeps the old `SelectProps` contract — `children` stay
 * `<option value=...>` elements and `onChange` still receives a
 * `{ target: { value } }`-shaped event — so existing call sites work unchanged.
 */
export function Select({
  className,
  wrapperClassName,
  sizeVariant = "default",
  children,
  disabled,
  value,
  onChange,
  id,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  "data-testid": testId,
  autoFocus,
  tabIndex,
  title,
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const controlId = useId();
  const listboxId = `${controlId}-listbox`;
  const listRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const typeahead = useRef({ buffer: "", timer: 0 });

  const options = useMemo(() => parseSelectOptions(children), [children]);
  const stringValue = value === undefined || value === null ? "" : String(value);
  const selected = options.find((option) => option.value === stringValue) ?? null;

  const widthClasses = className
    ?.split(/\s+/)
    .filter((c) => /^(w-|max-w-|min-w-|flex-)/.test(c))
    .join(" ");

  // Clicking outside the control closes the menu.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open ]);

  // On open, move focus to the selected option (or the first enabled one).
  useEffect(() => {
    if (!open) return;
    typeahead.current.buffer = "";
    const frame = requestAnimationFrame(() => {
      const buttons = enabledButtons(listRef.current);
      const selectedIndex = options.findIndex(
        (option) => !option.disabled && option.value === stringValue,
      );
      (selectedIndex >= 0 ? buttons[selectedIndex] : buttons[0])?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [open, options, stringValue]);

  useEffect(
    () => () => {
      window.clearTimeout(typeahead.current.timer);
    },
    [],
  );

  function commit(next: string) {
    if (next !== stringValue) fireChange(onChange, next);
    setOpen(false);
    triggerRef.current?.focus();
  }

  function jumpTypeahead(char: string) {
    const state = typeahead.current;
    window.clearTimeout(state.timer);
    state.buffer = (state.buffer + char).toLowerCase();
    state.timer = window.setTimeout(() => {
      state.buffer = "";
    }, 500);
    const labels = options.filter((option) => !option.disabled).map((option) => option.label.toLowerCase());
    const index = labels.findIndex((label) => label.startsWith(state.buffer));
    if (index >= 0) enabledButtons(listRef.current)[index]?.focus();
  }

  function onListKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      // Stop Radix dialogs underneath (e.g. the provider wizard) from closing.
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }
    if (event.key === "Tab") {
      setOpen(false);
      return;
    }
    const items = enabledButtons(listRef.current);
    if (items.length === 0) return;
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "ArrowDown") {
      event.preventDefault();
      (current < 0 ? items[0] : items[(current + 1) % items.length])?.focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      (current <= 0 ? items[items.length - 1] : items[current - 1])?.focus();
    } else if (event.key === "Home") {
      event.preventDefault();
      items[0]?.focus();
    } else if (event.key === "End") {
      event.preventDefault();
      items[items.length - 1]?.focus();
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      jumpTypeahead(event.key);
    }
  }

  function onTriggerKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;
    if (
      event.key === "ArrowDown" ||
      event.key === "ArrowUp" ||
      event.key === "Enter" ||
      event.key === " " ||
      event.key === "Home" ||
      event.key === "End"
    ) {
      event.preventDefault();
      setOpen(true);
    }
  }

  return (
    <div
      ref={rootRef}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false);
      }}
      className={cn(
        "relative inline-flex items-center",
        widthClasses || "w-full",
        disabled && "opacity-50",
        wrapperClassName,
      )}
    >
      <button
        ref={triggerRef}
        id={id ?? `${controlId}-trigger`}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        disabled={disabled}
        data-testid={testId}
        autoFocus={autoFocus}
        tabIndex={tabIndex}
        title={title ?? selected?.label}
        onClick={() => {
          if (!disabled) setOpen((wasOpen) => !wasOpen);
        }}
        onKeyDown={onTriggerKeyDown}
        className={cn(
          "flex w-full items-center justify-between gap-2 rounded-md border text-zinc-900 transition-colors cursor-pointer",
          "border-zinc-300 bg-white hover:border-zinc-400 shadow-xs",
          "dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:border-zinc-600",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tollma-500/40 focus-visible:border-tollma-500 dark:focus-visible:ring-tollma-500/40",
          "disabled:cursor-not-allowed",
          !selected && "text-zinc-400 dark:text-zinc-500",
          sizeVariant === "sm" ? "h-8 pl-2.5 pr-2 text-xs" : "h-9 pl-3 pr-2.5 text-sm",
          className,
        )}
      >
        <span className="min-w-0 flex-1 truncate text-left">{selected?.label ?? ""}</span>
        <ChevronDown
          className={cn(
            "shrink-0 text-zinc-400 dark:text-zinc-500 transition-transform",
            open && "rotate-180",
            sizeVariant === "sm" ? "size-3.5" : "size-4",
          )}
        />
      </button>
      {open && (
        <div
          ref={listRef}
          id={listboxId}
          role="listbox"
          aria-label={ariaLabel}
          onKeyDown={onListKeyDown}
          className={cn(
            "absolute left-0 top-full z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-zinc-200 bg-white p-1 shadow-xl",
            "dark:border-zinc-800 dark:bg-zinc-900",
          )}
        >
          {options.map((option, index) => {
            const active = option.value === stringValue;
            return (
              <button
                key={`${option.value}-${index}`}
                type="button"
                role="option"
                aria-selected={active}
                disabled={option.disabled}
                data-testid={option.testId ?? (testId ? `${testId}-option-${option.value}` : undefined)}
                data-dropdown-option={option.value}
                title={option.label}
                onClick={() => commit(option.value)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                  "focus:bg-zinc-100 focus:outline-none dark:focus:bg-zinc-800",
                  active
                    ? "bg-tollma-50 text-tollma-800 dark:bg-tollma-950/50 dark:text-tollma-200"
                    : "text-zinc-700 dark:text-zinc-300",
                  option.disabled && "pointer-events-none opacity-50",
                )}
              >
                <span
                  className={cn(
                    "flex size-3.5 shrink-0 items-center justify-center",
                    active ? "text-tollma-600 dark:text-tollma-400" : "text-transparent",
                  )}
                >
                  <Check className="size-3.5" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1 truncate font-medium">{option.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
