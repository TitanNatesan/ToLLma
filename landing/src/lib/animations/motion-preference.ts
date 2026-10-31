// Shared motion-preference access (no "use client" — pure helpers).
// Kept separate from the main barrel to avoid circular imports between
// the animation index and its hook modules.

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
