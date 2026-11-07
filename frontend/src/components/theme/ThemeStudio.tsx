"use client";

import { useState, type RefObject } from "react";
import { Bell, Moon, Sun, X } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  Separator,
  Switch,
} from "@/components/ui/primitives";
import { useGlassStore, DEFAULT_GLASS, NOTIFICATION_POSITIONS, type GlassConfig, type NotificationPosition } from "@/store/glass";
import { toast } from "@/lib/notify";
import { AccentPicker } from "@/components/theme/AccentPicker";
import { cn } from "@/lib/utils";

type Appearance = GlassConfig["appearance"];

const APPEARANCES: Array<{
  value: Appearance;
  label: string;
  Icon: typeof Sun;
  testId: string;
}> = [
  { value: "light", label: "Light", Icon: Sun, testId: "theme-appearance-light" },
  { value: "dark", label: "Dark", Icon: Moon, testId: "theme-appearance-dark" },
];

/** Native range input with label, live value readout, and tollma accent. */
function SliderRow({
  label,
  hint,
  value,
  display,
  min,
  max,
  step = 1,
  onChange,
  disabled,
  testId,
}: {
  label: string;
  hint?: string;
  value: number;
  display: string;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  disabled?: boolean;
  testId: string;
}) {
  return (
    <div className={cn(disabled && "opacity-60")}>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={testId} className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
          {label}
        </label>
        <span
          className="shrink-0 font-mono text-xs tabular-nums text-zinc-500 dark:text-zinc-400"
          aria-hidden
        >
          {display}
        </span>
      </div>
      {hint && <p className="mt-0.5 text-xs text-zinc-400 dark:text-zinc-500">{hint}</p>}
      <input
        id={testId}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-disabled={disabled}
        aria-label={label}
        data-testid={testId}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1.5 w-full cursor-pointer disabled:cursor-not-allowed"
        style={{ accentColor: "var(--color-tollma-500)" }}
      />
      <span className="sr-only" role="status">
        {label} {display}
      </span>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
      {children}
    </h3>
  );
}

const POSITION_LABEL: Record<NotificationPosition, string> = {
  "top-left": "top left",
  "top-center": "top center",
  "top-right": "top right",
  "bottom-left": "bottom left",
  "bottom-center": "bottom center",
  "bottom-right": "bottom right",
};

/** Mini window skeleton: pick where toasts appear. Selecting a zone fires a
 * confirmation toast at the NEW position so placement is visible instantly. */
function NotificationPositionPicker({
  value,
  onSelect,
}: {
  value: NotificationPosition;
  onSelect: (next: NotificationPosition, prev: NotificationPosition) => void;
}) {
  return (
    <div
      className="relative h-28 w-full overflow-hidden rounded-[var(--radius-md,12px)] border border-[var(--glass-border)] bg-zinc-500/5 dark:bg-white/5"
      role="group"
      aria-label="Notification position"
      data-testid="theme-notification-picker"
    >
      {/* window chrome skeleton */}
      <div className="absolute inset-x-3 top-2.5 flex gap-1" aria-hidden>
        <span className="size-1.5 rounded-full bg-zinc-300 dark:bg-zinc-600" />
        <span className="size-1.5 rounded-full bg-zinc-300 dark:bg-zinc-600" />
        <span className="size-1.5 rounded-full bg-zinc-300 dark:bg-zinc-600" />
      </div>
      <div className="absolute inset-x-3 top-6 h-1.5 rounded-full bg-zinc-200/70 dark:bg-zinc-700/70" aria-hidden />
      <div className="absolute inset-x-3 top-9 h-1.5 w-2/3 rounded-full bg-zinc-200/70 dark:bg-zinc-700/70" aria-hidden />
      {NOTIFICATION_POSITIONS.map((pos) => {
        const active = pos === value;
        const placement =
          pos === "top-left"
            ? "left-2 top-2"
            : pos === "top-center"
              ? "left-1/2 top-2 -translate-x-1/2"
              : pos === "top-right"
                ? "right-2 top-2"
                : pos === "bottom-left"
                  ? "bottom-2 left-2"
                  : pos === "bottom-center"
                    ? "bottom-2 left-1/2 -translate-x-1/2"
                    : "bottom-2 right-2";
        return active ? (
          <div
            key={pos}
            className={`absolute ${placement} flex w-24 flex-col gap-1 rounded-md border border-tollma-500/50 bg-white/90 p-1.5 shadow-lg dark:border-tollma-400/50 dark:bg-zinc-900/90`}
            aria-hidden
          >
            <span className="h-1.5 w-3/4 rounded-full bg-zinc-400 dark:bg-zinc-500" />
            <span className="h-1.5 w-full rounded-full bg-zinc-300 dark:bg-zinc-600" />
          </div>
        ) : (
          <button
            key={pos}
            type="button"
            onClick={() => onSelect(pos, value)}
            aria-label={`Show notifications at ${POSITION_LABEL[pos]}`}
            aria-pressed={false}
            data-testid={`theme-notification-${pos}`}
            className="absolute size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-zinc-400/60 bg-white/70 outline-none transition-colors hover:border-tollma-500 hover:bg-tollma-500/20 focus-visible:ring-2 focus-visible:ring-tollma-500/60 dark:border-zinc-500/60 dark:bg-zinc-800/70"
            style={{
              left: pos.includes("left") ? "12%" : pos.includes("right") ? "88%" : "50%",
              top: pos.startsWith("top") ? "30%" : "78%",
            }}
          />
        );
      })}
      <span className="sr-only" role="status">
        Notifications appear at {POSITION_LABEL[value]}
      </span>
    </div>
  );
}

export function ThemeStudio({
  open,
  onClose,
  inputRef,
}: {
  open: boolean;
  onClose: () => void;
  /** Palette query input: receives focus back when the studio closes. */
  inputRef: RefObject<HTMLInputElement | null>;
}) {
  const config = useGlassStore((s) => s.config);
  const update = useGlassStore((s) => s.update);
  const reset = useGlassStore((s) => s.reset);
  // Snapshot at open (mount): revert restores exactly this. Every change
  // persists immediately, so without a snapshot "cancel" would be impossible.
  const [snapshot] = useState<GlassConfig>(() => ({ ...config }));

  const glassOff = !config.transparencyEnabled;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        overlayClassName="bg-black/20"
        className="max-w-md p-0"
        onCloseAutoFocus={(e) => {
          const el = inputRef.current;
          if (el) {
            e.preventDefault();
            el.focus();
          }
        }}
      >
        <div className="flex items-start justify-between gap-2 px-5 pt-4">
          <div>
            <DialogTitle data-testid="theme-studio" className="text-base font-semibold">
              Theme Studio
            </DialogTitle>
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              Changes apply and save instantly — no Save button needed.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close theme studio"
            data-testid="theme-studio-close"
            className="rounded-md p-1.5 text-zinc-500 outline-none hover:bg-zinc-500/10 focus-visible:ring-2 focus-visible:ring-tollma-500/60 dark:text-zinc-400"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>

        <div className="flex max-h-[60vh] w-full min-w-0 flex-col gap-5 overflow-y-auto overflow-x-clip px-5 py-4">
          {/* Appearance */}
          <section className="flex flex-col gap-2" aria-label="Appearance">
            <SectionLabel>Appearance</SectionLabel>
            <div
              className="flex items-center gap-1 rounded-lg border border-[var(--glass-border)] p-1"
              role="group"
              aria-label="Color scheme"
            >
              {APPEARANCES.map(({ value, label, Icon, testId }) => {
                const active = config.appearance === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => update({ appearance: value })}
                    aria-pressed={active}
                    data-testid={testId}
                    className={cn(
                      "flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium outline-none transition-colors",
                      "focus-visible:ring-2 focus-visible:ring-tollma-500/60",
                      active
                        ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                        : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100",
                    )}
                  >
                    <Icon className="size-3.5" aria-hidden />
                    <span>{label}</span>
                  </button>
                );
              })}
            </div>
          </section>

          <Separator />

          {/* Glass effects */}
          <section className="flex flex-col gap-3" aria-label="Glass effects">
            <SectionLabel>Glass effects</SectionLabel>
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">Transparency</p>
                <p className="text-xs text-zinc-400 dark:text-zinc-500">
                  Master switch for frosted surfaces.
                </p>
              </div>
              <Switch
                checked={config.transparencyEnabled}
                onCheckedChange={(v) => update({ transparencyEnabled: v })}
                aria-label="Transparency"
                data-testid="theme-glass-enabled"
              />
            </div>
            <SliderRow
              label="Transparency"
              hint="Surface opacity of floating panels."
              value={config.transparency}
              display={`${config.transparency}%`}
              min={0}
              max={100}
              onChange={(v) => update({ transparency: v })}
              testId="theme-transparency"
            />
            {glassOff && (
              <p className="rounded-md bg-zinc-500/10 px-2.5 py-1.5 text-xs text-zinc-500 dark:bg-white/10 dark:text-zinc-400">
                Enable transparency to adjust blur, refraction and depth.
              </p>
            )}
            <SliderRow
              label="Blur"
              hint="Frost strength behind panels."
              value={config.blur}
              display={`${config.blur}%`}
              min={0}
              max={100}
              onChange={(v) => update({ blur: v })}
              disabled={glassOff}
              testId="theme-blur"
            />
            <SliderRow
              label="Refraction"
              hint="Light-bending intensity at panel edges."
              value={config.refraction}
              display={`${config.refraction}%`}
              min={0}
              max={100}
              onChange={(v) => update({ refraction: v })}
              disabled={glassOff}
              testId="theme-refraction"
            />
            <SliderRow
              label="Depth"
              hint="Layered shadow depth under floating surfaces."
              value={config.depth}
              display={`${config.depth}%`}
              min={0}
              max={100}
              onChange={(v) => update({ depth: v })}
              disabled={glassOff}
              testId="theme-depth"
            />
          </section>

          <Separator />

          {/* Notifications */}
          <section className="flex flex-col gap-2" aria-label="Notifications">
            <SectionLabel>Notifications</SectionLabel>
            <p className="-mt-1 text-xs text-zinc-400 dark:text-zinc-500">
              Where toast notifications appear on screen.
            </p>
            <NotificationPositionPicker
              value={config.notificationPosition}
              onSelect={(next, prev) => {
                update({ notificationPosition: next });
                toast.success("Notification position changed", {
                  description: `from ${POSITION_LABEL[prev]} to ${POSITION_LABEL[next]}`,
                  position: next,
                });
              }}
            />
          </section>

          <Separator />

          {/* Accent */}
          <section className="flex flex-col gap-2" aria-label="Accent color">
            <SectionLabel>Accent</SectionLabel>
            <AccentPicker />
            <p className="text-xs text-zinc-400 dark:text-zinc-500">
              Accent saves to your profile automatically.
            </p>
          </section>
        </div>

        <div className="flex flex-col gap-2 border-t border-[var(--glass-border)] px-5 py-3.5">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => update({ ...snapshot })}
              data-testid="theme-revert"
            >
              Revert changes
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={reset}
              data-testid="theme-reset"
            >
              Reset to defaults
            </Button>
          </div>
          <p className="text-[11px] leading-snug text-zinc-400 dark:text-zinc-500">
            Revert restores how things looked when you opened this panel. Reset restores factory
            defaults ({DEFAULT_GLASS.appearance}, transparency {DEFAULT_GLASS.transparency}%,
            blur {DEFAULT_GLASS.blur}%).
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
