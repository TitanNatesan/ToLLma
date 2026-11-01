"use client";

// Cream closing CTA, two columns: serif headline + copy left, black button
// on pixel-block decor right.
//
// Phase D motion (all transform/opacity, SSR-visible, reduced-motion static):
// magnetic + shine CTA button; the skyline tilts slightly toward the cursor
// (fine pointers only); blocks rise on entry with per-block parallax depths;
// a faint brand glow drifts behind the heading; a small square floats and
// rotates over the scroll range.
import { useEffect, useRef } from "react";
import { Container } from "@/components/ui/layout";
import { BlackButton } from "@/components/ui/primitives";
import { MagneticButton } from "@/components/ui/magnetic-button";
import { Reveal } from "@/components/ui/reveal";
import { useDataParallax } from "@/components/ui/parallax";
import { prefersReducedMotion, usePointerTilt } from "@/lib/animations";
import { GET_STARTED_URL } from "@/lib/site";

// Per-block parallax depths across the skyline (decorative band).
const BLOCKS: { cls: string; depth: number }[] = [
  { cls: "right-[8%] top-0 h-[38%] w-[34%]", depth: 0.12 },
  { cls: "right-[30%] top-[38%] h-[24%] w-[22%]", depth: 0.26 },
  { cls: "bottom-0 right-0 h-[38%] w-[62%]", depth: 0.18 },
  { cls: "bottom-[38%] left-[16%] h-[24%] w-[12%]", depth: 0.34 },
  { cls: "left-0 top-[30%] h-[20%] w-[10%]", depth: 0.22 },
];

function PixelBlocks() {
  return (
    <div aria-hidden="true" className="relative h-56 w-full overflow-hidden md:h-72">
      {BLOCKS.map((b, i) => (
        <span key={i} data-parallax={b.depth} className={`absolute bg-coal ${b.cls}`} />
      ))}
    </div>
  );
}

// Small square that floats (0.4 parallax) and rotates (up to 6°) as the
// section crosses the viewport. translate + rotate only, rAF-throttled.
function FloatingSquare() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || prefersReducedMotion()) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const section = el.closest("section");
      if (!section) return;
      const r = section.getBoundingClientRect();
      const vh = window.innerHeight || 1;
      const p = Math.min(1, Math.max(0, (vh - r.top) / (vh + r.height)));
      el.style.transform =
        `translate3d(0, ${((0.5 - p) * 0.4 * 100).toFixed(1)}px, 0) rotate(${(p * 6).toFixed(2)}deg)`;
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
  }, []);
  return (
    <span
      ref={ref}
      aria-hidden="true"
      className="absolute left-[4%] top-[10%] size-8 bg-coal/10"
    />
  );
}

export function CTA() {
  const parallaxRef = useDataParallax<HTMLDivElement>();
  const tiltRef = usePointerTilt<HTMLDivElement>(4);
  return (
    <section id="get-started" ref={parallaxRef} className="scroll-mt-20 overflow-hidden bg-cream">
      <Container width="wide" className="grid items-center gap-10 py-20 md:grid-cols-2 md:py-28">
        <div className="relative">
          <div aria-hidden="true" data-parallax="0.1" className="cta-glow absolute -inset-10" />
          <h2 className="relative max-w-md font-serif text-4xl font-medium tracking-tight text-coal md:text-5xl">
            Move from juggling keys to running the business.
          </h2>
          <p className="relative mt-5 max-w-md text-[1.05rem] leading-relaxed text-coal/70">
            One gateway for all your AI models and agents. Open source, Apache 2.0.
          </p>
        </div>
        <div className="relative">
          <div ref={tiltRef}>
            <Reveal>
              <div className="relative">
                <PixelBlocks />
                <FloatingSquare />
              </div>
            </Reveal>
          </div>
          <MagneticButton strength={6} shine className="absolute bottom-[8%] right-[14%]">
            <BlackButton href={GET_STARTED_URL} ariaLabel="Get started with ToLLma" className="px-8 py-4">
              Get Started <span aria-hidden="true">→</span>
            </BlackButton>
          </MagneticButton>
        </div>
      </Container>
    </section>
  );
}
