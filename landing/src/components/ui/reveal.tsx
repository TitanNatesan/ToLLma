"use client";

// Reveal: fade + rise entrance for meaningful moments only (section
// headings, hero statements — not every tile on the page).
// Spec: 24px rise, opacity, 700ms var(--ease-reveal), 90ms sibling
// stagger (pass delay={i * 90}). SSR-safe: visible by default; the
// hidden state is applied in an effect only when motion is allowed, so
// reduced-motion + no-JS render final states.
import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { prefersReducedMotion } from "@/lib/animations/motion-preference";

export function Reveal({
  children,
  className = "",
  delay = 0,
  y = 24,
  threshold = 0.15,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  y?: number;
  threshold?: number;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || prefersReducedMotion()) return;
    el.style.setProperty("--reveal-y", `${y}px`);
    el.setAttribute("data-hidden", "true");
    let timer = 0;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        // One frame so the hidden state commits before revealing.
        timer = window.setTimeout(() => el.removeAttribute("data-hidden"), 30);
      },
      { threshold }
    );
    io.observe(el);
    return () => {
      io.disconnect();
      window.clearTimeout(timer);
      el.removeAttribute("data-hidden");
    };
  }, [y, threshold]);

  const style = { "--reveal-delay": `${delay}ms` } as CSSProperties;
  return (
    <div ref={ref} className={`reveal ${className}`} style={style}>
      {children}
    </div>
  );
}
