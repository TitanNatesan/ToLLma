"use client";

// R8 (inverted): NO parallax, NO cursor lift. The divider paints the PREV
// section's field with the NEXT section's color as teeth (D1 decorative
// night teeth on cream, where prev == next). The divider sits 2px ON TOP
// of the next section (-mb-2px + z-10), slots overlap 1px horizontally to
// hide subpixel seams. Static full pattern under reduced motion / no-JS.
import { useEffect, useRef, useState } from "react";

// Stepped column pattern: [width flex, max height 0..1].
const PATTERN: [number, number][] = [
  [1.2, 0.35], [0.7, 1], [1, 0.55], [1.4, 1], [0.6, 0.4], [1.1, 0.85],
  [0.8, 1], [1.3, 0.5], [0.7, 0.9], [1, 1], [1.2, 0.45], [0.9, 0.75],
  [1.4, 1], [0.6, 0.55],
];

export default function PixelWipe({
  tone = "dark",
  block,
  field,
}: {
  /** "dark" = night field (inverted); "light" = cream field (inverted). */
  tone?: "dark" | "light";
  /** Teeth color override (e.g. "bg-night"); defaults to cream/night by tone. */
  block?: string;
  /** Field (band) color override (e.g. "bg-sage"). */
  field?: string;
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
    if (reduced) return;
    const root = ref.current;
    if (!root) return;
    let raf = 0;

    const update = () => {
      raf = 0;
      const rect = root.getBoundingClientRect();
      const vh = window.innerHeight || 1;
      const p = Math.min(1, Math.max(0, (vh * 0.95 - rect.top) / (vh * 0.75)));
      const n = blocks.current.length;
      for (let i = 0; i < n; i++) {
        const b = blocks.current[i];
        if (!b) continue;
        // Entry only: rise scaleY from the baseline, staggered left → right.
        const local = Math.min(1, Math.max(0, p * 1.7 - i * 0.05));
        b.style.transform = `scaleY(${local.toFixed(3)})`;
        b.style.transformOrigin = "bottom";
      }
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    return () => {
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
  }, [reduced]);

  const bandCls = field ?? (tone === "dark" ? "bg-night" : "bg-cream");
  const blockCls = block ?? (tone === "dark" ? "bg-cream" : "bg-night");

  return (
    <div ref={ref} data-wipe aria-hidden="true" className={`relative z-10 -mb-[2px] overflow-hidden ${bandCls}`}>
      <div className="flex h-[14vh] min-h-24 w-[calc(100%+1px)]">
        {PATTERN.map(([w, h], i) => (
          <div
            key={i}
            className="relative self-end"
            style={{ flexGrow: w, height: `${Math.round(h * 100)}%`, marginLeft: i === 0 ? 0 : -1 }}
          >
            <div
              ref={(el) => {
                blocks.current[i] = el;
              }}
              className={`wipe-col absolute inset-x-0 top-0 bottom-[-4px] ${blockCls}`}
            />
          </div>
        ))}
      </div>
      {/* Seam seal: guarantees a continuous teeth-color ground line across
          the boundary so subpixel slot rounding can never show a hairline. */}
      <div aria-hidden="true" className={`pointer-events-none absolute inset-x-0 bottom-0 h-[4px] ${blockCls}`} />
    </div>
  );
}
