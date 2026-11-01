"use client";

// ============================================================
// ToLLma motion system — Anime.js v4 (current API).
// Centralized so every section shares one convention.
//   - `useRevealOnScroll`   fade+rise for [data-reveal] children
//   - `useStaggerReveal`    staggered children reveal
//   - `useInViewOnce`       boolean in-view latch (no re-init)
//   - `drawSvgPath`         SVG stroke-dashoffset line draw
//   - `motionPathPackets`   move packets along an SVG path
//   - `countUp`             number transition
// All animations respect prefers-reduced-motion and clean up on unmount.
// ============================================================

import { useEffect, useRef, useState, type RefObject } from "react";
import { animate, createTimeline, createScope, stagger, svg, utils, ScrollObserver, type TimelineParams } from "animejs";
import { prefersReducedMotion } from "./motion-preference";

export { prefersReducedMotion };

// ---------- reduced motion ----------
export function useReducedMotion(): boolean {
  // SSR-safe: server and first client render both see `false` so render
  // branches (e.g. platform stepper vs. static grid) match the prerender
  // and never hydrate-mismatch (React error #418 under reduced-motion).
  // The real preference applies in an effect — the reduced-motion static
  // layout may appear one frame later. Consumers inside effects
  // (useRevealOnScroll, useStaggerReveal) combine it with their own
  // effect-set flag and simply skip animating until motion is allowed.
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

// ---------- in-view latch ----------
/** True once the element enters the viewport; stays true. */
export function useInViewOnce<T extends Element>(
  threshold = 0.2
): [RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          io.disconnect();
        }
      },
      { threshold }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [seen, threshold]);
  return [ref, seen];
}

// ---------- reveal on scroll ----------
/**
 * Animates every `[data-reveal]` descendant once the container scrolls
 * into view. Elements start hidden ONLY when motion is allowed (set in
 * JS), so reduced-motion users and no-JS crawlers see content immediately.
 *
 * options.animateTo: raw anime targets object (default fade + 24px rise).
 */
export function useRevealOnScroll(
  options: { threshold?: number; staggerMs?: number; y?: number } = {}
) {
  const { threshold = 0.15, staggerMs = 70, y = 24 } = options;
  const ref = useRef<HTMLElement | null>(null);
  const reduced = useReducedMotion();
  // Resolves only in an effect, alongside the reduced-motion query above, so
  // the first paint (SSR + hydration) never hides content. Hiding happens
  // only when motion is positively allowed: mounted with no reduce request.
  const [effectReady, setEffectReady] = useState(false);
  useEffect(() => {
    setEffectReady(true);
  }, []);
  const motionAllowed = effectReady && !reduced;

  useEffect(() => {
    const root = ref.current;
    if (!root || !motionAllowed) return;
    const items = Array.from(
      root.querySelectorAll<HTMLElement>("[data-reveal]")
    );
    if (!items.length) return;

    // Hide until animated (JS-only, so no flash for reduced motion / no JS).
    utils.set(items, { opacity: 0, y });

    const scope = createScope({ root });
    let revealed = false;

    const reveal = () => {
      if (revealed) return;
      revealed = true;
      animate(items, {
        opacity: [0, 1],
        y: [y, 0],
        duration: 700,
        delay: stagger(staggerMs, { start: 0 }),
        ease: "outExpo",
      });
    };

    // Primary trigger: viewport intersection.
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        window.removeEventListener("scroll", checkScroll);
        window.removeEventListener("resize", checkScroll);
        reveal();
      },
      { threshold }
    );
    io.observe(root);

    // Fallback trigger: same semantics computed from scroll position, so
    // content is never left hidden if IntersectionObserver delivery is
    // blocked or delayed. Synchronous (no rAF) on purpose.
    const checkScroll = () => {
      if (revealed) return;
      const r = root.getBoundingClientRect();
      if (r.top < window.innerHeight * (1 - threshold) && r.bottom > 0) {
        io.disconnect();
        window.removeEventListener("scroll", checkScroll);
        window.removeEventListener("resize", checkScroll);
        reveal();
      }
    };
    window.addEventListener("scroll", checkScroll, { passive: true });
    window.addEventListener("resize", checkScroll, { passive: true });
    checkScroll(); // covers landing mid-page where neither IO nor scroll has fired

    return () => {
      io.disconnect();
      window.removeEventListener("scroll", checkScroll);
      window.removeEventListener("resize", checkScroll);
      scope.revert();
      utils.set(items, { clear: "all" });
    };
  }, [motionAllowed, threshold, staggerMs, y]);

  return ref;
}

// ---------- staggered list reveal ----------
/** Returns a ref for a parent whose `[data-stagger]` children animate in. */
export function useStaggerReveal(threshold = 0.2, staggerMs = 80) {
  const [ref, seen] = useInViewOnce<HTMLElement>(threshold);
  const reduced = useReducedMotion();
  const [effectReady, setEffectReady] = useState(false);
  useEffect(() => {
    setEffectReady(true);
  }, []);
  const motionAllowed = effectReady && !reduced;
  useEffect(() => {
    const root = ref.current;
    if (!root || !seen || !motionAllowed) return;
    const items = root.querySelectorAll("[data-stagger]");
    animate(items, {
      opacity: [0, 1],
      y: [18, 0],
      duration: 600,
      delay: stagger(staggerMs),
      ease: "outExpo",
    });
  }, [ref, seen, motionAllowed, staggerMs]);
  return [ref, seen] as const;
}

// ---------- SVG line drawing ----------
/** Draws every path matched by `selector` inside `container` once in view. */
export function drawSvgPaths(
  container: Element,
  selector: string,
  opts: { duration?: number; delay?: number; staggerMs?: number; play?: boolean } = {}
) {
  const { duration = 1100, delay = 0, staggerMs = 90, play = true } = opts;
  const paths = Array.from(container.querySelectorAll<SVGPathElement>(selector));
  if (!paths.length) return () => {};
  if (!play || prefersReducedMotion()) return () => {};

  // createDrawable returns an array of drawable proxies (one per path).
  const drawables = paths.flatMap((p) => svg.createDrawable(p));
  const tl = createTimeline();
  tl.add(drawables, {
    draw: ["0 0", "0 1"],
    duration,
    delay: stagger(staggerMs, { start: delay }),
    ease: "inOutQuad",
  });
  return () => tl.revert();
}

// ---------- motion-path packets ----------
/**
 * Animates `packet` elements along an SVG path (`path`), sampled via
 * getPointAtLength. Progress is animated 0→1 per packet with a stagger,
 * looping. Returns a cleanup that reverts.
 *
 * Usage: packets are <circle>/<g> in the same SVG coordinate space as
 * `path`; they are positioned with transform="translate(x,y)".
 */
/** Pausable packet flow handle. `revert` stops and cleans up. */
export type PacketFlow = {
  pause: () => void;
  play: () => void;
  revert: () => void;
};

const noopFlow: PacketFlow = { pause: () => {}, play: () => {}, revert: () => {} };

export function animatePackets(
  path: SVGPathElement,
  packets: SVGElement[],
  opts: { duration?: number; staggerMs?: number; loop?: boolean } = {}
): PacketFlow {
  const { duration = 2600, staggerMs = 700, loop = true } = opts;
  if (prefersReducedMotion() || !packets.length) return noopFlow;

  const total = path.getTotalLength();
  const tl = createTimeline({
    defaults: { ease: "linear" },
    loop: loop ? Infinity : false,
  });

  packets.forEach((packet, i) => {
    const proxy = { t: 0 };
    tl.add(
      proxy,
      {
        t: 1,
        duration,
        ease: "linear",
        onUpdate: () => {
          const pt = path.getPointAtLength(proxy.t * total);
          packet.setAttribute("transform", `translate(${pt.x} ${pt.y})`);
        },
      },
      i * staggerMs
    );
  });

  return {
    pause: () => tl.pause(),
    play: () => tl.play(),
    revert: () => tl.revert(),
  };
}

// ---------- number count-up ----------
export function countUp(
  el: HTMLElement,
  to: number,
  opts: { duration?: number; decimals?: number; prefix?: string; suffix?: string } = {}
) {
  const { duration = 1200, decimals = 0, prefix = "", suffix = "" } = opts;
  if (prefersReducedMotion()) {
    el.textContent = `${prefix}${to.toFixed(decimals)}${suffix}`;
    return;
  }
  const state = { v: 0 };
  const a = animate(state, {
    v: to,
    duration,
    ease: "outExpo",
    onUpdate: () => {
      el.textContent = `${prefix}${state.v.toFixed(decimals)}${suffix}`;
    },
  });
  return () => a.revert();
}

// ---------- generic timeline helper ----------
export function makeTimeline(params: TimelineParams) {
  return createTimeline(params);
}

export { animate, createScope, createTimeline, stagger, svg, utils, ScrollObserver };

// Shared preset vocabulary + interaction hooks (single import site for sections).
export * from "./presets";
export {
  useParallax,
  useScrollProgress,
  usePointerTilt,
  useActiveSection,
  useCountUp,
} from "./interactions";
