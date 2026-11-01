"use client";

// SpotlightCard: cursor-following radial glow + 1px gradient border
// fade-in + 2px lift on hover (all <300ms). Pointer position flows into
// --mx/--my (rAF-throttled); visuals stay in CSS pseudo-elements so the
// card subtree never re-renders. Reduced-motion / no-JS: static card,
// no glow tracking, no lift.
import { useEffect, useRef, type ReactNode } from "react";
import { prefersReducedMotion } from "@/lib/animations/motion-preference";

export function SpotlightCard({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || prefersReducedMotion()) return;
    let raf = 0;
    const onMove = (e: PointerEvent) => {
      if (raf) return;
      const x = e.clientX;
      const y = e.clientY;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const r = el.getBoundingClientRect();
        el.style.setProperty("--mx", `${x - r.left}px`);
        el.style.setProperty("--my", `${y - r.top}px`);
      });
    };
    el.addEventListener("pointermove", onMove);
    return () => {
      el.removeEventListener("pointermove", onMove);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);
  return (
    <div ref={ref} className={`spotlight ${className}`}>
      {children}
    </div>
  );
}
