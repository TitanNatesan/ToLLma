/** Dynamic accent palette.
 *
 *  The whole app consumes the `tollma-*` Tailwind scale, which Tailwind v4
 *  emits as `var(--color-tollma-*)` references. Re-defining those variables on
 *  <html> re-themes buttons, rings, links, sliders, charts and badges with no
 *  component changes and no reload.
 *
 *  Shades are derived from a single base (500) color with the same lightness
 *  curve as the original brand green, so every accent gets an identical,
 *  accessible 50→950 scale. */

import type { AccentName } from "@/types";

export const ACCENT_BASES: Record<Exclude<AccentName, "custom">, string> = {
  green: "#066e09",
  blue: "#1d4ed8",
  purple: "#7e22ce",
  orange: "#c2410c",
  red: "#b91c1c",
  cyan: "#0e7490",
  pink: "#be185d",
};

export const ACCENT_ORDER: Exclude<AccentName, "custom">[] = [
  "green",
  "blue",
  "purple",
  "orange",
  "red",
  "cyan",
  "pink",
];

/** Relative lightness of each shade vs the base 500 swatch (brand-derived). */
const DARK_SHADES: Record<string, number> = {
  "600": 0.855,
  "700": 0.69,
  "800": 0.52,
  "900": 0.395,
  "950": 0.29,
};

/** Light shades: [lightness, saturation multiplier]. */
const LIGHT_SHADES: Record<string, [number, number]> = {
  "50": [0.945, 0.27],
  "100": [0.882, 0.31],
  "200": [0.767, 0.335],
  "300": [0.618, 0.29],
  "400": [0.465, 0.35],
};

export const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function hexToRgb(hex: string): [number, number, number] {
  const text = hex.trim().replace(/^#/, "");
  return [
    parseInt(text.slice(0, 2), 16) / 255,
    parseInt(text.slice(2, 4), 16) / 255,
    parseInt(text.slice(4, 6), 16) / 255,
  ];
}

function rgbToHex(r: number, g: number, b: number): string {
  const to = (v: number) => Math.round(clamp01(v) * 255).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

export function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const [r, g, b] = hexToRgb(hex);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: h / 6, s, l };
}

export function hslToHex(h: number, s: number, l: number): string {
  const hue = ((h % 1) + 1) % 1;
  const sat = clamp01(s);
  const light = clamp01(l);
  if (sat === 0) return rgbToHex(light, light, light);
  const q = light < 0.5 ? light * (1 + sat) : light + sat - light * sat;
  const p = 2 * light - q;
  const channel = (t: number) => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return rgbToHex(channel(hue + 1 / 3), channel(hue), channel(hue - 1 / 3));
}

/** 50→950 CSS variable map for one accent base color. */
export function accentVars(baseHex: string): Record<string, string> {
  const base = HEX_COLOR_RE.test(baseHex) ? baseHex.toLowerCase() : ACCENT_BASES.green;
  const { h, s, l } = hexToHsl(base);
  const vars: Record<string, string> = { "--color-tollma-500": base };
  for (const [shade, [lightness, satScale]] of Object.entries(LIGHT_SHADES)) {
    vars[`--color-tollma-${shade}`] = hslToHex(h, s * satScale, lightness);
  }
  for (const [shade, rel] of Object.entries(DARK_SHADES)) {
    vars[`--color-tollma-${shade}`] = hslToHex(h, s, l * rel);
  }
  return vars;
}

export function resolveAccentBase(accent: AccentName, customHex: string | null | undefined): string {
  if (accent === "custom" && customHex && HEX_COLOR_RE.test(customHex)) return customHex.toLowerCase();
  if (accent === "custom") return ACCENT_BASES.green;
  return ACCENT_BASES[accent] ?? ACCENT_BASES.green;
}

export const ACCENT_VARS_KEY = "tollma-accent-vars";
export const ACCENT_KEY = "tollma-accent";

/** Apply an accent globally + persist the generated palette for next paint. */
export function applyAccent(accent: AccentName, customHex: string | null | undefined): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const vars = accentVars(resolveAccentBase(accent, customHex));
  for (const [key, value] of Object.entries(vars)) root.style.setProperty(key, value);
  root.setAttribute("data-accent", accent);
  try {
    localStorage.setItem(ACCENT_VARS_KEY, JSON.stringify(vars));
    localStorage.setItem(ACCENT_KEY, accent);
  } catch {
    // storage unavailable — accent still applies for this session
  }
}
