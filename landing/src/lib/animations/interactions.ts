"use client";

// ============================================================
// Scroll + pointer interaction hooks (shared conventions).
//   - useParallax        layered background/foreground drift on scroll
//   - useScrollProgress  0→1 progress of an element through viewport
//   - usePointerTilt     perspective tilt card/object (desktop pointers)
//   - useActiveSection   which section id is currently in view (scrollspy)
// All: cleanup on unmount, reduced-motion safe.
// ============================================================

import { useEffect, useRef, useState, type RefObject } from "react";
import { animate, utils } from "animejs";
import { prefersReducedMotion } from "./motion-preference";

// ---------- parallax ----------
/**
 * Applies a subtle translate to the element as the page scrolls past it.
 * `speed` in px per viewport of travel (positive = moves slower than scroll,
 * negative = foreground drift). Updates via rAF; transform-only (cheap).
 */
export function useParallax<T extends HTMLElement>(
  speed = 0.15
): RefObject<T | null> {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || prefersReducedMotion()) return;
    let raf = 0;

    const update = () => {
      raf = 0;
      const rect = el.getBoundingClientRect();
      const vh = window.innerHeight || 1;
      // -1 (below viewport) → 1 (above viewport)
      const progress = (vh - rect.top) / (vh + rect.height) - 0.5;
      const offset = progress * speed * 100;
      el.style.transform = `translate3d(0, ${offset.toFixed(2)}px, 0)`;
    };

    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
      el.style.transform = "";
    };
  }, [speed]);

  return ref;
}

// ---------- scroll progress ----------
/** Returns [ref, progress] where progress is 0→1 while the element crosses the viewport. */
export function useScrollProgress<T extends HTMLElement>(): [
  RefObject<T | null>,
  number,
] {
  const ref = useRef<T | null>(null);
  const [p, setP] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const rect = el.getBoundingClientRect();
      const vh = window.innerHeight || 1;
      const prog = Math.min(1, Math.max(0, (vh - rect.top) / (vh + rect.height)));
      setP(prog);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return [ref, p];
}

// ---------- pointer tilt ----------
/**
 * Perspective tilt for cards / gateway objects on fine pointers.
 * Sets `transform: perspective(...) rotateX/rotateY` (transform-only).
 * Disabled for touch + reduced-motion; max angle capped (no dizziness).
 * Returns a ref to attach to the TILTABLE WRAPPER (has `perspective` style).
 */
export function usePointerTilt<T extends HTMLElement>(maxDeg = 6) {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fine = window.matchMedia("(pointer: fine)").matches;
    if (!fine || prefersReducedMotion()) return;

    const child = (el.firstElementChild ?? el) as HTMLElement;
    let raf = 0;
    let targetX = 0;
    let targetY = 0;
    let curX = 0;
    let curY = 0;
    let active = false;

    const render = () => {
      raf = 0;
      // light smoothing so tilt feels weighty, not jittery
      curX += (targetX - curX) * 0.18;
      curY += (targetY - curY) * 0.18;
      child.style.transform = `perspective(var(--perspective)) rotateX(${curX.toFixed(3)}deg) rotateY(${curY.toFixed(3)}deg)`;
      if (
        active &&
        (Math.abs(targetX - curX) > 0.01 || Math.abs(targetY - curY) > 0.01)
      ) {
        raf = requestAnimationFrame(render);
      }
    };

    const onMove = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      const px = (e.clientX - rect.left) / rect.width - 0.5; // -0.5…0.5
      const py = (e.clientY - rect.top) / rect.height - 0.5;
      targetY = px * maxDeg * 2;
      targetX = -py * maxDeg * 2;
      if (!active) {
        active = true;
        child.style.transition = "none";
      }
      if (!raf) raf = requestAnimationFrame(render);
    };

    const onLeave = () => {
      active = false;
      targetX = 0;
      targetY = 0;
      child.style.transition = "transform 600ms var(--ease-out-expo)";
      if (!raf) raf = requestAnimationFrame(render);
    };

    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);
    return () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
      if (raf) cancelAnimationFrame(raf);
      child.style.transform = "";
      child.style.transition = "";
    };
  }, [maxDeg]);

  return ref;
}

// ---------- scrollspy ----------
/**
 * Tracks which of `sectionIds` occupies the viewport's reading zone and
 * returns its id (for nav active indication). Uses one IntersectionObserver;
 * falls back to the last section passed when several are visible.
 */
export function useActiveSection(sectionIds: string[]): string | null {
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    const els = sectionIds
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => !!el);
    if (!els.length) return;

    const visible = new Set<string>();
    const publish = () => {
      const found = sectionIds.find((id) => visible.has(id));
      if (found) setActive(found);
    };
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) visible.add(e.target.id);
          else visible.delete(e.target.id);
        }
        publish();
      },
      { rootMargin: "-35% 0px -55% 0px", threshold: 0 }
    );
    els.forEach((el) => io.observe(el));

    // Fallback: compute the reading line directly on scroll/resize in case
    // IntersectionObserver delivery is delayed or blocked (rare, but content
    // indication must never depend on a single async primitive). Synchronous
    // on purpose — no rAF, so it works even when frames never render.
    const compute = () => {
      const line = window.innerHeight * 0.4;
      // Outside the tracked range → no active link (before Features, or
      // past Product where nav has no matching item). Inside gaps between
      // tracked sections, keep the last passed one lit.
      const first = document.getElementById(sectionIds[0]);
      const last = document.getElementById(sectionIds[sectionIds.length - 1]);
      if (first && first.getBoundingClientRect().top > line) {
        setActive(null);
        return;
      }
      if (last && last.getBoundingClientRect().bottom < line) {
        setActive(null);
        return;
      }
      let found: string | null = null;
      for (const id of sectionIds) {
        const el = document.getElementById(id);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (r.top <= line && r.bottom > line) {
          found = id;
          break;
        }
      }
      if (found) setActive(found);
    };
    window.addEventListener("scroll", compute, { passive: true });
    window.addEventListener("resize", compute, { passive: true });
    // Initial pass (sync) so the first paint past the hero already has state.
    compute();

    return () => {
      io.disconnect();
      window.removeEventListener("scroll", compute);
      window.removeEventListener("resize", compute);
    };
  }, [sectionIds]);

  return active;
}

// ---------- number ticker (scroll-triggered) ----------
/** Animates a number 0→to when its element first enters view. */
export function useCountUp(
  to: number,
  opts: { duration?: number; decimals?: number; prefix?: string; suffix?: string } = {}
) {
  const ref = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (prefersReducedMotion()) {
      el.textContent = `${opts.prefix ?? ""}${to.toFixed(opts.decimals ?? 0)}${opts.suffix ?? ""}`;
      return;
    }
    utils.set(el, { opacity: 0 });
    const cleanups: Array<() => void> = [];
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        animate(el, { opacity: [0, 1], duration: 300, ease: "linear" });
        const state = { v: 0 };
        const anim = animate(state, {
          v: to,
          duration: opts.duration ?? 1400,
          ease: "outExpo",
          onUpdate: () => {
            el.textContent = `${opts.prefix ?? ""}${state.v.toFixed(opts.decimals ?? 0)}${opts.suffix ?? ""}`;
          },
        });
        cleanups.push(() => anim.revert());
      },
      { threshold: 0.4 }
    );
    io.observe(el);
    return () => {
      io.disconnect();
      cleanups.forEach((c) => c());
      utils.set(el, { clear: "all" });
    };
  }, [to, opts.duration, opts.decimals, opts.prefix, opts.suffix]);

  return ref;
}
