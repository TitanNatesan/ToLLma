import { DEFAULT_GLASS, NOTIFICATION_POSITIONS, type GlassConfig } from "@/store/glass";

const APPEARANCES: readonly string[] = ["light", "dark"];

const round3 = (v: number): string => String(Math.round(v * 1000) / 1000);

function clampNum(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

/** Validate + clamp a (possibly hand-edited) glass config back into range. */
export function clampGlass(input: GlassConfig): GlassConfig {
  const c = (input ?? {}) as Partial<Record<keyof GlassConfig, unknown>>;
  return {
    appearance: APPEARANCES.includes(c.appearance as string)
      ? (c.appearance as GlassConfig["appearance"])
      : DEFAULT_GLASS.appearance,
    transparencyEnabled:
      typeof c.transparencyEnabled === "boolean"
        ? c.transparencyEnabled
        : DEFAULT_GLASS.transparencyEnabled,
    transparency: clampNum(c.transparency, 0, 100, DEFAULT_GLASS.transparency),
    blur: clampNum(c.blur, 0, 100, DEFAULT_GLASS.blur),
    refraction: clampNum(c.refraction, 0, 100, DEFAULT_GLASS.refraction),
    depth: clampNum(c.depth, 0, 100, DEFAULT_GLASS.depth),
    notificationPosition: NOTIFICATION_POSITIONS.includes(
      c.notificationPosition as GlassConfig["notificationPosition"],
    )
      ? (c.notificationPosition as GlassConfig["notificationPosition"])
      : DEFAULT_GLASS.notificationPosition,
  };
}

/**
 * Apply a glass config to <html>: theme classes + engine-owned CSS vars.
 * Idempotent and transition-free, so rapid slider updates stay cheap.
 */
export function applyGlassTheme(input: GlassConfig): void {
  if (typeof document === "undefined") return;
  const c = clampGlass(input);
  const root = document.documentElement;

  // `.dark` stays present for black so every `dark:` variant keeps working.
  // `.dark` carries the deep-black palette (former "black" mode merged in);
  // every `dark:` variant keeps working unchanged.
  root.classList.toggle("dark", c.appearance !== "light");
  root.classList.remove("black");

  // Dark IS the deep-black palette (former separate "black" mode merged in).
  const rgb = c.appearance === "light" ? "255 255 255" : "0 0 0";
  // Transparency is literal: 100% means 98% see-through (alpha 0.02), 0%
  // means fully opaque. Accent-tinted washes keep their own alpha — this
  // governs the base surface fill only.
  const bgAlpha = c.transparencyEnabled ? Math.max(0.02, 1 - (c.transparency / 100) * 0.98) : 0.97;
  root.style.setProperty("--glass-bg", `rgb(${rgb} / ${round3(bgAlpha)})`);
  root.style.setProperty("--glass-blur", `${c.transparencyEnabled ? c.blur : 0}px`);

  const borderRgb = c.appearance === "light" ? "24 24 27" : "255 255 255";
  root.style.setProperty("--glass-border", `rgb(${borderRgb} / ${c.depth > 60 ? 0.12 : 0.08})`);

  root.style.setProperty(
    "--glass-highlight",
    // Smoothstep response: gentle at both ends, no harsh jump at low values.
    (() => {
      const h = c.transparencyEnabled ? c.refraction / 100 : 0;
      const s = h * h * (3 - 2 * h);
      return round3(0.3 * s);
    })(),
  );

  const s = 0.3 + c.depth / 100;
  const [a, b, d, e] =
    c.appearance === "light" ? [0.04, 0.06, 0.05, 0.1] : [0.3, 0.35, 0.35, 0.45];
  root.style.setProperty(
    "--glass-shadow",
    `0 1px 2px rgb(0 0 0 / ${round3(a * s)}), 0 8px 24px rgb(0 0 0 / ${round3(b * s)})`,
  );
  root.style.setProperty(
    "--glass-shadow-lg",
    `0 2px 8px rgb(0 0 0 / ${round3(d * s)}), 0 16px 40px rgb(0 0 0 / ${round3(e * s)})`,
  );
}
