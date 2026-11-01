"use client";

// Scroll-driven pixel block-wipe: stepped rectangles that GROW with scroll
// (scaleY, transform-only) — never fades. `tone="dark"` paints night blocks
// on a light band (light→dark seams); `tone="light"` paints cream blocks on
// a night band (dark→light seams). Column widths/heights follow a fixed
// stepped pattern like the recording. Static full pattern when JS is off.
import { useEffect, useRef, useState } from "react";

// Stepped column pattern: [width flex, max height 0..1].
const PATTERN: [number, number][] = [
  [1.2, 0.35], [0.7, 1], [1, 0.55], [1.4, 1], [0.6, 0.4], [1.1, 0.85],
  [0.8, 1], [1.3, 0.5], [0.7, 0.9], [1, 1], [1.2, 0.45], [0.9, 0.75],
  [1.4, 1], [0.6, 0.55],
];

export default function PixelWipe({
  tone = "dark",
  flip = false,
  band,
}: {
  tone?: "dark" | "light";
  flip?: boolean;
  band?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [progress, setProgress] = useState(-1); // -1 = unmounted (static full)
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    setProgress(mq.matches ? 1 : 0);
    if (mq.matches) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const el = ref.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const vh = window.innerHeight || 1;
      const p = Math.min(1, Math.max(0, (vh * 0.95 - rect.top) / (vh * 0.75)));
      setProgress((prev) => (Math.abs(prev - p) < 0.004 ? prev : p));
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

  const bandCls = band ?? (tone === "dark" ? "bg-cream" : "bg-night");
  const block = tone === "dark" ? "bg-night" : "bg-cream";

  return (
    <div ref={ref} aria-hidden="true" className={`overflow-hidden ${bandCls}`}>
      <div className={`flex h-[14vh] min-h-24 items-stretch gap-[3px] ${flip ? "rotate-180" : ""}`}>
        {PATTERN.map(([w, h], i) => {
          // Stagger: later columns start growing later in the scroll.
          const local = progress < 0 ? 1 : Math.min(1, Math.max(0, progress * 1.7 - i * 0.05));
          return (
            <div key={i} className="relative self-end" style={{ flexGrow: w, height: `${Math.round(h * 100)}%` }}>
              <div
                className={`wipe-col absolute inset-0 ${block}`}
                style={reduced || progress < 0 ? undefined : { transform: `scaleY(${local.toFixed(3)})`, transformOrigin: "bottom" }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
