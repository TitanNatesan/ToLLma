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
