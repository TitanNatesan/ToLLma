"use client";

// MagneticButton: subtle pull toward the cursor (translate only, capped
// at `strength` px — no scale drama). Releases with a short expo ease.
// Fine pointers only; reduced-motion / touch / SSR render static.
// Pair with the .btn-shine sweep class for primary CTAs.
import { useEffect, useRef, type ReactNode } from "react";
import { prefersReducedMotion } from "@/lib/animations/motion-preference";

export function MagneticButton({
  children,
  className = "",
  strength = 6,
  shine = false,
}: {
  children: ReactNode;
  className?: string;
  strength?: number;
  shine?: boolean;
}) {
  const ref = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (prefersReducedMotion()) return;
    if (!window.matchMedia("(pointer: fine)").matches) return;
    let raf = 0;
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const nx = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / r.width));
      const ny = Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height / 2)) / r.height));
      if (raf) cancelAnimationFrame(raf);
      el.style.transition = "none";
      raf = requestAnimationFrame(() => {
        raf = 0;
        el.style.transform = `translate3d(${(nx * strength).toFixed(2)}px, ${(ny * strength).toFixed(2)}px, 0)`;
      });
    };
    const onLeave = () => {
      if (raf) cancelAnimationFrame(raf);
      el.style.transition = "transform 220ms var(--ease-out-expo)";
      el.style.transform = "";
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);
    return () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [strength]);
  return (
    <span ref={ref} className={`magnetic${shine ? " btn-shine" : ""} ${className}`}>
      {children}
    </span>
  );
}
