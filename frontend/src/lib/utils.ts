// ponytail: naive class join, clsx if this grows.
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/** Strip unwanted trailing zeros from numeric strings (e.g. "1.000000000000" -> "1", "0.100000000000" -> "0.1"). */
export function stripTrailingZeros(v: unknown, fallback = "0"): string {
  if (v === null || v === undefined || v === "") return fallback;
  const s = String(v).trim();
  if (s === "") return fallback;
  if (!s.includes(".")) return s;
  const cleaned = s.replace(/(\.\d*?[1-9])0+$/, "$1").replace(/\.0+$/, "");
  return cleaned === "" ? fallback : cleaned;
}

/** Format currency with trailing zeros stripped (e.g. "$1", "$0.1", "$1.25"). */
export function fmtPrice(v: unknown): string {
  if (v === null || v === undefined || v === "") return "$0";
  const str = String(v).replace(/^\$/, "").trim();
  const num = parseFloat(str);
  if (isNaN(num) || num === 0) return "$0";
  return `$${stripTrailingZeros(str)}`;
}

/** Single cost formatter for the whole app (pricing, usage, message costs,
 *  header telemetry). Trailing zeros stripped; tiny values use exponential
 *  only when fixed notation would round to zero. */
export function fmtCost(v: unknown): string {
  if (v === null || v === undefined || v === "") return "$0";
  const str = String(v).replace(/^\$/, "").trim();
  const n = parseFloat(str);
  if (isNaN(n) || n === 0) return "$0";
  if (Math.abs(n) < 0.0001) return `$${n.toExponential(2)}`;
  return `$${stripTrailingZeros(n.toString())}`;
}

/** Token counts: integers with locale grouping, no decimals ever. */
export function fmtTokens(v: unknown): string {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  if (!isFinite(n)) return "0";
  return Math.round(n).toLocaleString("en-US");
}

/** Compact context-window style: 200000 -> "200k", 1500 -> "1.5k", 950 -> "950". */
export function fmtCompactTokens(v: unknown): string {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  if (!isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1000) {
    const k = n / 1000;
    const rounded = Math.round(k * 10) / 10;
    return `${stripTrailingZeros(String(rounded))}k`;
  }
  return fmtTokens(n);
}
