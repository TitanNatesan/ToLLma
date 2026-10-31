// ============================================================
// Shared Anime.js v4 preset vocabulary. One choreography language
// for the whole page — sections compose these instead of hand-rolling
// timelines. Every preset returns raw Anime params (not running
// animations), so callers control lifecycle + cleanup.
// ============================================================

import type { AnimationParams } from "animejs";

/** Baseline entrance: fade + rise. The page's default reveal. */
export const fadeUp = (y = 24, duration = 700): AnimationParams => ({
  opacity: [0, 1],
  y: [y, 0],
  duration,
  ease: "outExpo",
});

/** Gentle fade only — for elements that must not shift layout. */
export const fadeIn = (duration = 600): AnimationParams => ({
  opacity: [0, 1],
  duration,
  ease: "outQuad",
});

/** Scale-in reveal for nodes, badges, gateway pieces. */
export const scaleReveal = (from = 0.92, duration = 650): AnimationParams => ({
  opacity: [0, 1],
  scale: [from, 1],
  duration,
  ease: "outBack",
});

/** Stagger delay function shared by all list/grid reveals (wraps anime stagger). */
export { stagger as staggerReveal } from "animejs";

/** Continuous gentle float (hero chips / idle gateway accents). */
export const float = (distance = 8, duration = 2600): AnimationParams => ({
  y: [`+=${distance}`, `-=${distance * 2}`, `+=${distance}`],
  duration,
  ease: "inOutSine",
  loop: true,
  direction: "alternate",
});

/** Gateway core pulse — the signature idle motion. */
export const gatewayPulse = (): AnimationParams => ({
  scale: [1, 1.03, 1],
  duration: 2600,
  ease: "inOutQuad",
  loop: true,
});

/** Soft halo breath behind the gateway. */
export const haloBreathe = (): AnimationParams => ({
  opacity: [0.5, 0.85],
  scale: [1, 1.06],
  duration: 3000,
  ease: "inOutSine",
  loop: true,
  direction: "alternate",
});

/** Emphasized single beat (headline word, key metric). */
export const emphasisPop = (): AnimationParams => ({
  scale: [1, 1.06, 1],
  duration: 900,
  ease: "inOutBack",
});
