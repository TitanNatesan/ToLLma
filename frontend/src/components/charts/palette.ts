/** Chart palette. The first color is the live accent variable, so every chart
 *  re-themes with the user's accent choice; the rest are fixed complements. */

export const CHART_COLORS = [
  "var(--color-tollma-500)",
  "#0891b2",
  "#7c3aed",
  "#d97706",
  "#dc2626",
  "#db2777",
  "#65a30d",
  "#64748b",
];

export function chartColor(index: number): string {
  return CHART_COLORS[index % CHART_COLORS.length];
}

/** "Nice" axis maximum above the data max (1/2/5 × 10^n). */
export function niceMax(value: number): number {
  if (!isFinite(value) || value <= 0) return 1;
  const exponent = Math.floor(Math.log10(value));
  const base = Math.pow(10, exponent);
  const normalized = value / base;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * base;
}

export function compactNumber(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  if (abs >= 10) return value.toFixed(0);
  if (abs >= 1) return value.toFixed(1);
  if (abs === 0) return "0";
  return value.toFixed(2);
}

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
