"use client";

import {
  motion,
  useReducedMotion as useFramerReducedMotion,
  type Variants,
} from "framer-motion";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

/**
 * Shared motion primitives for the landing page.
 *
 * Rules enforced here:
 * - Every animation respects prefers-reduced-motion (static fallback).
 * - GPU-composited properties only (opacity, transform).
 * - One-time entrances; no bounce / shake / loops / typing / confetti.
 * - Parallax strengths are capped (background 2px / glow 5px / cards 10px).
 *
 * Motion budget — which zones may animate (all one-time, once per viewport):
 * - hero: FadeUp stack (stagger ≤ 3 steps) + ScaleIn on the visual +
 *   capped mouse parallax (card/glow layers) + SMIL packets. The only zone
 *   with continuous motion; packets are skipped entirely under
 *   prefers-reduced-motion (SMIL cannot be CSS-paused).
 * - architecture: FadeUp reveals + ScaleIn on the featured diagram. Mouse
 *   parallax allowed on glow only; no scroll-linked parallax here (diagram
 *   legibility first).
 * - screenshots: FadeUp + Stagger gallery + tilt/spotlight hover. The single
 *   showcase section allowed translate-Y hover (-2 to -4px); scroll-linked
 *   parallax may be used on gallery frames only, capped at 10px.
 * - roadmap: FadeUp + Stagger list (≤ 3 stagger steps). No parallax.
 * - CTA (closing): FadeUp + ambient glow drift (≥ 9s, opacity/transform
 *   only, CSS class .animate-cta-glow). No mouse/scroll parallax.
 * - Everything else (nav, comparison matrix, trust badges, footer, docs
 *   sections): static entrances at most (FadeUp optional); hover = border /
 *   background / shadow only, no lift, no parallax, no loops.
 */

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

/** Re-export of framer-motion's hook for components that need it directly. */
export { useFramerReducedMotion };

const EASE = [0.22, 1, 0.36, 1] as const;

/** Stagger step between children (s, ≤ 0.15s; mirrors --stagger-step). */
export const STAGGER_STEP = 0.12;

/** Max stagger steps per section; choreography stays within 3 items. */
export const STAGGER_MAX = 3;

/** Absolute cap for scroll-linked parallax travel (px). */
export const SCROLL_PARALLAX_CAP = 10;

type RevealProps = {
  children: ReactNode;
  className?: string;
  delay?: number;
  y?: number;
  style?: CSSProperties;
};

/** Fade + rise entrance, once. Static when reduced motion is preferred. */
export function FadeUp({
  children,
  className,
  delay = 0,
  y = 20,
  style,
}: RevealProps) {
  const reduce = usePrefersReducedMotion();
  if (reduce) {
    return (
      <div className={className} style={style}>
        {children}
      </div>
    );
  }
  return (
    <motion.div
      className={className}
      style={style}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-64px" }}
      transition={{ duration: 0.55, delay, ease: [...EASE] }}
    >
      {children}
    </motion.div>
  );
}

/** Scale-in entrance for featured cards / visuals. Static on reduced motion. */
export function ScaleIn({
  children,
  className,
  delay = 0,
  style,
}: RevealProps) {
  const reduce = usePrefersReducedMotion();
  if (reduce) {
    return (
      <div className={className} style={style}>
        {children}
      </div>
    );
  }
  return (
    <motion.div
      className={className}
      style={style}
      initial={{ opacity: 0, scale: 0.96, y: 12 }}
      whileInView={{ opacity: 1, scale: 1, y: 0 }}
      viewport={{ once: true, margin: "-64px" }}
      transition={{ duration: 0.55, delay, ease: [...EASE] }}
    >
      {children}
    </motion.div>
  );
}

/** Container variants for staggered entrances (GPU-only: opacity + y). */
export const staggerContainerVariants: Variants = {
  hidden: {},
  show: {
    transition: { staggerChildren: STAGGER_STEP },
  },
};

/** Item variants for staggered entrances (GPU-only: opacity + y). */
export const staggerItemVariants: Variants = {
  hidden: { opacity: 0, y: 20 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.55, ease: [...EASE] },
  },
};

/**
 * Stagger container: orchestrates up to STAGGER_MAX staggered children via
 * <StaggerItem>. One-time, whileInView. Static when reduced motion is set.
 */
export function Stagger({
  children,
  className,
  delay = 0,
  style,
}: RevealProps) {
  const reduce = usePrefersReducedMotion();
  if (reduce) {
    return (
      <div className={className} style={style}>
        {children}
      </div>
    );
  }
  return (
    <motion.div
      className={className}
      style={style}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: "-64px" }}
      variants={{
        hidden: {},
        show: {
          transition: { staggerChildren: STAGGER_STEP, delayChildren: delay },
        },
      }}
    >
      {children}
    </motion.div>
  );
}

/** Stagger child: fade + rise driven by the parent <Stagger>. */
export function StaggerItem({
  children,
  className,
  style,
}: Omit<RevealProps, "delay" | "y">) {
  const reduce = usePrefersReducedMotion();
  if (reduce) {
    return (
      <div className={className} style={style}>
        {children}
      </div>
    );
  }
  return (
    <motion.div className={className} style={style} variants={staggerItemVariants}>
      {children}
    </motion.div>
  );
}

/**
 * Section transition: standard section-block entrance (fade + gentle rise).
 * One-time, once per viewport. Static when reduced motion is preferred.
 * Budget zones: architecture / roadmap / screenshots / CTA section blocks.
 */
export function SectionTransition({
  children,
  className,
  delay = 0,
  y = 16,
  style,
}: RevealProps) {
  const reduce = usePrefersReducedMotion();
  if (reduce) {
    return (
      <div className={className} style={style}>
        {children}
      </div>
    );
  }
  return (
    <motion.div
      className={className}
      style={style}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-64px" }}
      transition={{ duration: 0.55, delay, ease: [...EASE] }}
    >
      {children}
    </motion.div>
  );
}

export const PARALLAX_CAPS = {
  /** Background grid / base layer. */
  background: 2,
  /** Glow blobs. */
  glow: 5,
  /** Floating cards / foreground. */
  card: 10,
} as const;

export type ParallaxLayer = keyof typeof PARALLAX_CAPS;

/**
 * Capped mouse parallax for a container.
 *
 * Returns a ref to attach to the container plus a getter that resolves the
 * translate for a given layer. Strengths are capped per PARALLAX_CAPS and
 * everything collapses to zero when reduced motion is preferred or the
 * pointer is coarse. Transforms use translate3d (GPU only).
 */
export function useCappedMouseParallax<T extends HTMLElement>() {
  const reduce = usePrefersReducedMotion();
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  function onMouseMove(e: React.MouseEvent<T>) {
    if (reduce) return;
    if (window.matchMedia("(pointer: coarse)").matches) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const nx = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
    const ny = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
    setOffset({ x: nx, y: ny });
  }

  function onMouseLeave() {
    setOffset({ x: 0, y: 0 });
  }

  function layer(layer: ParallaxLayer): CSSProperties {
    if (reduce) return {};
    const cap = PARALLAX_CAPS[layer];
    return {
      transform: `translate3d(${(offset.x * cap).toFixed(2)}px, ${(offset.y * cap).toFixed(2)}px, 0)`,
      transition: "transform 0.35s ease-out",
      willChange: "transform",
    };
  }

  return { onMouseMove, onMouseLeave, layer };
}

export type ScrollParallaxOptions = {
  /**
   * Peak travel in px at ±half-viewport offset. Clamped to
   * SCROLL_PARALLAX_CAP. Defaults to 8.
   */
  strength?: number;
  /** "y" (default) or "both" (applies the same offset on x and y). */
  axis?: "y" | "both";
};

/**
 * GPU-only scroll-linked parallax.
 *
 * Attaches to one element; writes translate3d directly on the DOM node
 * inside a rAF-throttled scroll/resize listener (no re-renders, no layout
 * properties). Travel is capped at SCROLL_PARALLAX_CAP and collapses to a
 * static element when prefers-reduced-motion is set.
 *
 * Budget: hero visuals and screenshot gallery frames only.
 */
export function useScrollParallax<T extends HTMLElement>(
  options: ScrollParallaxOptions = {},
) {
  const { strength = 8, axis = "y" } = options;
  const magnitude = Math.min(Math.abs(strength), SCROLL_PARALLAX_CAP);
  const cap = strength === 0 ? 0 : Math.sign(strength) * magnitude;
  const ref = useRef<T | null>(null);
  const reduce = usePrefersReducedMotion();
  const configRef = useRef({ cap, axis });
  configRef.current = { cap, axis };

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (reduce) {
      node.style.transform = "";
      node.style.willChange = "";
      return;
    }
    let ticking = false;
    let raf = 0;
    const update = () => {
      ticking = false;
      const el = ref.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const vh = window.innerHeight || 1;
      const center = rect.top + rect.height / 2;
      const progress = (vh / 2 - center) / vh;
      const { cap: c, axis: a } = configRef.current;
      const y = (progress * 2 * c).toFixed(2);
      const x = a === "both" ? y : "0.00";
      el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      el.style.willChange = "transform";
    };
    const onScroll = () => {
      if (!ticking) {
        ticking = true;
        raf = requestAnimationFrame(update);
      }
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      cancelAnimationFrame(raf);
    };
  }, [reduce]);

  useEffect(() => {
    if (reduce && ref.current) {
      ref.current.style.transform = "";
      ref.current.style.willChange = "";
    }
  }, [reduce ]);

  return ref;
}
