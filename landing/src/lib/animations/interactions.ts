"use client";

// ============================================================
// Scroll + pointer interaction hooks (shared conventions).
//   - usePointerTilt     perspective tilt card/object (desktop pointers)
//   - useActiveSection   which section id is currently in view (scrollspy)
//   - useInViewToggle    enter/exit visibility flag (gates infinite loops)
// All: cleanup on unmount, reduced-motion safe.
// ============================================================

import { useEffect, useRef, useState, type RefObject } from "react";
import { prefersReducedMotion } from "./motion-preference";

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
      // Outside the tracked range → no active link. Range is derived from
      // live DOM geometry (not list order): callers may pass ids in an
      // order (e.g. app taxonomy) that differs from page order. Inside gaps
      // between tracked sections, keep the last passed one lit.
      let minTop = Infinity;
      let maxBottom = -Infinity;
      let found: string | null = null;
      for (const id of sectionIds) {
        const el = document.getElementById(id);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (r.top < minTop) minTop = r.top;
        if (r.bottom > maxBottom) maxBottom = r.bottom;
        if (!found && r.top <= line && r.bottom > line) found = id;
      }
      if (minTop > line || maxBottom < line) setActive(null);
      else if (found) setActive(found);
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

// ---------- in-view toggle ----------
// Like useInViewOnce, but tracks enter AND exit: true while the element is
// in the viewport, false when it leaves. Gates infinite CSS/JS loops
// (marquee, hero pills, guide scenes, outcome viz) so they idle off-screen.
// Static under reduced-motion via the CSS kill-switches, not here.
export function useInViewToggle<T extends Element>(
  threshold = 0
): [RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        const e = entries[0];
        if (e) setInView(e.isIntersecting);
      },
      { threshold }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);
  return [ref, inView];
}
