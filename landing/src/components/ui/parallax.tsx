"use client";

// Parallax: scroll-drift wrapper + [data-parallax] scope enhancer.
// Speed bands: bg 0.05–0.15, decorative 0.2–0.35, mid 0.5–0.7, fg 1.0.
// translate3d only; rAF-throttled; recomputed on scroll/resize (never
// gated on visibility, so a drifted element can't freeze off-screen);
// cleared on cleanup; inert under prefers-reduced-motion.
// SSR-safe (no transform until scrolled).
import { useEffect, useRef, type ReactNode } from "react";
import { prefersReducedMotion } from "@/lib/animations/motion-preference";

/** Documented speed bands for data-parallax / Parallax speed. */
export const PARALLAX_BANDS = {
  bg: [0.05, 0.15],
  decorative: [0.2, 0.35],
  mid: [0.5, 0.7],
  fg: 1.0,
} as const;

function attachParallax(el: HTMLElement, speed: number): () => void {
  if (prefersReducedMotion()) return () => {};
  let raf = 0;
  const update = () => {
    raf = 0;
    // No visibility gate: the transform itself can push the element out of
    // an overflow-hidden ancestor (IO then reports hidden forever and the
    // element would freeze at its load-time offset). Scroll/resize always
    // recompute; the observer below only catches non-scroll geometry shifts.
    const rect = el.getBoundingClientRect();
    const vh = window.innerHeight || 1;
    const progress = (vh - rect.top) / (vh + rect.height) - 0.5;
    el.style.transform = `translate3d(0, ${(progress * speed * 100).toFixed(2)}px, 0)`;
  };
  const schedule = () => {
    if (!raf) raf = requestAnimationFrame(update);
  };
  const io = new IntersectionObserver((entries) => {
    if (entries[0]?.isIntersecting) schedule();
  }, { threshold: 0 });
  io.observe(el);
  update();
  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", schedule, { passive: true });
  return () => {
    io.disconnect();
    window.removeEventListener("scroll", schedule);
    window.removeEventListener("resize", schedule);
    if (raf) cancelAnimationFrame(raf);
    el.style.transform = "";
  };
}

export function Parallax({
  children,
  speed = 0.15,
  className = "",
}: {
  children: ReactNode;
  speed?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return attachParallax(el, speed);
  }, [speed]);
  return (
    <div ref={ref} data-parallax={speed} className={className}>
      {children}
    </div>
  );
}

/**
 * Enhances raw [data-parallax="<speed>"] descendants inside the returned
 * ref — for section markup that sets the attribute directly instead of
 * using <Parallax>. Do not nest <Parallax> inside a scope (double drive).
 */
export function useDataParallax<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const cleanups: Array<() => void> = [];
    root.querySelectorAll<HTMLElement>("[data-parallax]").forEach((el) => {
      if (el === root) return;
      const speed = parseFloat(el.getAttribute("data-parallax") || "");
      if (Number.isFinite(speed)) cleanups.push(attachParallax(el, speed));
    });
    return () => {
      cleanups.forEach((c) => c());
    };
  }, []);
  return ref;
}
