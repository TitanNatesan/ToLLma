"use client";

import {
  motion,
  useReducedMotion as useFramerReducedMotion,
} from "framer-motion";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";

/**
 * Shared motion primitives for the landing page.
 *
 * Rules enforced here:
 * - Every animation respects prefers-reduced-motion (static fallback).
 * - GPU-composited properties only (opacity, transform).
 * - One-time entrances; no bounce / shake / loops / typing / confetti.
 * - Parallax strengths are capped (background 2px / glow 5px / cards 10px).
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
