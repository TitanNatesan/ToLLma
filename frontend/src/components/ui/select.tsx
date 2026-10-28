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
import { createPortal } from "react-dom";
import { Check, ChevronDown, Search } from "lucide-react";
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

/**
 * Case-insensitive label/value filter for the dropdown search box.
 * Exported so unit tests can cover the matching without a DOM.
 */
export function filterSelectOptions(options: ParsedSelectOption[], query: string): ParsedSelectOption[] {
  const q = query.trim().toLowerCase();
  if (!q) return options;
  return options.filter(
    (option) => option.label.toLowerCase().includes(q) || option.value.toLowerCase().includes(q),
  );
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
 *
 * The listbox renders in a `document.body` portal with fixed positioning, so
 * it escapes `overflow: auto` ancestors (dialogs, wizard step bodies) instead
 * of being clipped. A search box filters options by label for long lists.
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
  const [flipUp, setFlipUp] = useState(false);
  const [query, setQuery] = useState("");
  const [coords, setCoords] = useState<{ top: number; left: number; width: number } | null>(null);
  const controlId = useId();
  const listboxId = `${controlId}-listbox`;
  const listRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  // Radix modal dialogs (role=dialog) trap focus (FocusScope) and set
  // body pointer-events to none — a body-level portal would be unfocusable
  // and unclickable. Portaling into the host dialog keeps the listbox inside
  // the focus scope and the pointer-events surface, while fixed positioning
  // still escapes the wizard's overflow-y-auto step body. Outside dialogs we
  // fall back to document.body (with explicit pointer-events: auto).
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  function resolvePortalTarget(): HTMLElement {
    const host = triggerRef.current?.closest<HTMLElement>('[role="dialog"]');
    return host ?? document.body;
  }
  const typeahead = useRef({ buffer: "", timer: 0 });

  const options = useMemo(() => parseSelectOptions(children), [children]);
  const stringValue = value === undefined || value === null ? "" : String(value);
  const selected = options.find((option) => option.value === stringValue) ?? null;
  const visible = useMemo(
    () => filterSelectOptions(options, query),
    [options, query],
  );

  const widthClasses = className
    ?.split(/\s+/)
    .filter((c) => /^(w-|max-w-|min-w-|flex-)/.test(c))
    .join(" ");

  // Clicking outside the control closes the menu. The listbox lives in a
  // body portal, so clicks inside it must not count as outside.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (rootRef.current && !rootRef.current.contains(target)
        && listRef.current && !listRef.current.contains(target)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open ]);

  // Position the portal listbox from the trigger rect; recompute on scroll /
  // resize so it tracks the trigger, and flip above when space below is short.
  useEffect(() => {
    if (!open) return;
    const update = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      // Width-aware clamping: the menu keeps the trigger width (min 180px)
      // and is shifted left when it would otherwise cross the viewport edge.
      const width = Math.max(rect.width, 180);
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
      const needed = listRef.current?.offsetHeight ?? 200;
      const up = window.innerHeight - rect.bottom < needed && rect.top > needed;
      setFlipUp(up);
      setCoords({
        top: up ? Math.max(8, rect.top - needed - 4) : rect.bottom + 4,
        left,
        width,
      });
    };
    update();
    const frame = requestAnimationFrame(update);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open ]);

  // On open, focus the search box for immediate filtering.
  useEffect(() => {
    if (!open) return;
    typeahead.current.buffer = "";
    const frame = requestAnimationFrame(() => {
      searchRef.current?.focus();
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
      setQuery("");
      setPortalTarget(resolvePortalTarget());
      setOpen(true);
    }
  }

  function onSearchKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      enabledButtons(listRef.current)[0]?.focus();
    }
  }

  const listbox = (
    <div
      ref={listRef}
      id={listboxId}
      role="listbox"
      aria-label={ariaLabel}
      data-flip-up={flipUp || undefined}
      // The listbox lives in a body portal, so Radix DismissableLayer (dialogs,
      // drawers) sees its pointerdown as "outside" and would dismiss the host
      // dialog before click reaches an option. Stopping propagation here keeps
      // the dialog open; the Select's own document listener already ignores
      // inside clicks via containment checks.
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={onListKeyDown}
      className={cn(
        "max-h-[min(20rem,80dvh)] overflow-y-auto rounded-lg border border-zinc-200 bg-white p-1 shadow-xl",
        "dark:border-zinc-800 dark:bg-zinc-900",
      )}
      style={coords ? { position: "fixed", zIndex: 100, top: coords.top, left: coords.left, width: Math.max(coords.width, 180), pointerEvents: "auto" } : { display: "none" }}
    >
      <div className="sticky top-0 flex items-center gap-1.5 rounded-md bg-white px-2 py-1.5 dark:bg-zinc-900">
        <Search className="size-3.5 shrink-0 text-zinc-400" aria-hidden="true" />
        <input
          ref={searchRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onSearchKeyDown}
          placeholder="Search…"
          aria-label="Search options"
          data-testid={testId ? `${testId}-search` : undefined}
          className="w-full bg-transparent text-xs text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-100"
        />
      </div>
      {visible.length === 0 ? (
        <p className="px-2 py-3 text-center text-xs text-zinc-400">No matches</p>
      ) : (
        visible.map((option) => {
          const active = option.value === stringValue;
          return (
            <button
              key={option.value}
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
        })
      )}
    </div>
  );

  return (
    <div
      ref={rootRef}
      onBlur={(event) => {
        const next = event.relatedTarget as Node | null;
        // Focus moving into the portal listbox (search box / options) is not
        // leaving the control.
        if (next && (event.currentTarget.contains(next) || listRef.current?.contains(next))) return;
        setOpen(false);
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
          if (disabled) return;
          if (!open) {
            setQuery("");
            setPortalTarget(resolvePortalTarget());
          }
          setOpen(!open);
        }}
        onKeyDown={onTriggerKeyDown}
        className={cn(
          "flex w-full items-center justify-between gap-2 rounded-md border text-zinc-900 transition-colors cursor-pointer",
          "border-zinc-300 bg-white hover:border-zinc-400 shadow-xs",
          "dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:border-zinc-600",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tollma-500/60 focus-visible:border-tollma-500 dark:focus-visible:ring-tollma-500/60",
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
      {open && typeof document !== "undefined" && createPortal(listbox, portalTarget ?? document.body)}
    </div>
  );
}
