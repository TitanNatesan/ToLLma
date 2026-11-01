"use client";

// Scroll-driven pixel block-wipe: stepped rectangles that GROW with scroll
// (scaleY, transform-only) — never fades. `tone="dark"` paints night blocks
// on a light band (light→dark seams); `tone="light"` paints cream blocks on
// a night band (dark→light seams). Column widths/heights follow a fixed
// stepped pattern like the recording. Static full pattern when JS is off.
//
// Phase D motion: blocks still rise scaleY from the baseline with a
// left→right stagger, plus per-block parallax depth (0.1–0.35) and a slight
// lift on the block nearest the cursor. All updates are rAF-throttled direct
// DOM writes (no re-renders); transforms only; static under reduced motion.
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
  cssDriven = false,
}: {
  tone?: "dark" | "light";
  flip?: boolean;
  band?: string;
  /** CSS owns this instance's transform (view-timeline sweep, see globals);
      the rAF driver skips it so the two never fight. */
  cssDriven?: boolean;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const blocks = useRef<Array<HTMLDivElement | null>>([]);
  // Lazy init so the very first effect pass already knows the preference —
  // otherwise one scroll update would write transforms before the listener
  // flips the flag. Rendered output is identical either way (transforms are
  // effect-only), so prerender/hydration stay consistent.
  const [reduced, setReduced] = useState(
    () =>
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (reduced || cssDriven) return;
    const root = ref.current;
    if (!root) return;
    let raf = 0;
    let cursorX: number | null = null;

    const update = () => {
      raf = 0;
      const rect = root.getBoundingClientRect();
      const vh = window.innerHeight || 1;
      const p = Math.min(1, Math.max(0, (vh * 0.95 - rect.top) / (vh * 0.75)));
      const n = blocks.current.length;
      for (let i = 0; i < n; i++) {
        const b = blocks.current[i];
        if (!b) continue;
        // Entry: rise scaleY from the baseline, staggered left → right.
        const local = Math.min(1, Math.max(0, p * 1.7 - i * 0.05));
        // Depth: per-block parallax drift, 0.1 (left) → 0.35 (right).
        const depth = 0.1 + (n > 1 ? i / (n - 1) : 0) * 0.25;
        const drift = (0.5 - p) * depth * 48;
        // Hover: the block nearest the cursor lifts slightly.
        let lift = 0;
        if (cursorX != null && b.parentElement) {
          const slot = b.parentElement.getBoundingClientRect();
          const center = slot.left + slot.width / 2 - rect.left;
          lift = Math.max(0, 1 - Math.abs(cursorX - center) / 140) * -10;
        }
        b.style.transform =
          `translateY(${(drift + lift).toFixed(2)}px) scaleY(${local.toFixed(3)})`;
        b.style.transformOrigin = "bottom";
      }
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    const onMove = (e: PointerEvent) => {
      const rect = root.getBoundingClientRect();
      cursorX = e.clientX - rect.left;
      schedule();
    };
    const onLeave = () => {
      cursorX = null;
      schedule();
    };
    update();
    root.addEventListener("pointermove", onMove);
    root.addEventListener("pointerleave", onLeave);
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    return () => {
      root.removeEventListener("pointermove", onMove);
      root.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (raf) cancelAnimationFrame(raf);
      // Leave no inline transforms behind (e.g. reduced-motion flip).
      for (const b of blocks.current) {
        if (b) {
          b.style.transform = "";
          b.style.transformOrigin = "";
        }
      }
    };
  }, [reduced, cssDriven]);

  const bandCls = band ?? (tone === "dark" ? "bg-cream" : "bg-night");
  const block = tone === "dark" ? "bg-night" : "bg-cream";

  return (
    <div ref={ref} aria-hidden="true" className={`overflow-hidden ${bandCls}${cssDriven ? " wipe-css" : ""}`}>
      <div className={`flex h-[14vh] min-h-24 items-stretch gap-[3px] ${flip ? "rotate-180" : ""}`}>
        {PATTERN.map(([w, h], i) => (
          <div key={i} className="relative self-end" style={{ flexGrow: w, height: `${Math.round(h * 100)}%` }}>
            <div
              ref={(el) => {
                blocks.current[i] = el;
              }}
              className={`wipe-col absolute inset-0 ${block}`}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
