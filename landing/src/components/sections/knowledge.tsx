"use client";

import { Container } from "@/components/ui/layout";
import { useDataParallax } from "@/components/ui/parallax";
import { DOCS_URL, EVALUATORS, GUARDRAIL_CATEGORIES, PROVIDERS } from "@/lib/site";
import { useEffect, useRef } from "react";
import { useInViewToggle, useRevealOnScroll } from "@/lib/animations";
import { prefersReducedMotion } from "@/lib/animations/motion-preference";

// Dark knowledge band. Headers are animated SVG scenes (transform/opacity
// only, ~6s slow loops, paused off-screen, static under reduced motion) with
// a centered white rounded icon tile. Meta line is "Guide • topic" (no
// invented dates). Titles stay on two lines.
const INK = "#171914";

function SceneShell({ base, steps, children }: { base: string; steps: string[]; children: React.ReactNode }) {
  const [ref, playing] = useInViewToggle<HTMLDivElement>(0.1);
  return (
    <div
      ref={ref}
      data-playing={playing}
      className="guide-scene relative h-44 overflow-hidden"
      aria-hidden="true"
    >
      {/* Illustration drifts at 0.2 parallax inside the card; the svg
          carries bleed so edges never show during the drift. */}
      <div data-parallax="0.2" className="h-full w-full">
        <svg
          viewBox="0 0 400 176"
          preserveAspectRatio="xMidYMid slice"
          className="guide-zoom -m-3 block h-[calc(100%+1.5rem)] w-[calc(100%+1.5rem)] max-w-none"
        >
          <rect width="400" height="176" fill={base} />
          {steps.map((d, i) => (
            <rect key={i} x={20 + (i % 8) * 46} y={i < 8 ? 18 : i < 16 ? 62 : 106} width="42" height="38" fill={d} opacity="0.5" />
          ))}
          {children}
        </svg>
      </div>
    </div>
  );
}

// Endpoint → provider: three dots fan out along the route, staggered.
function RoutingScene({ base, steps }: { base: string; steps: string[] }) {
  return (
    <SceneShell base={base} steps={steps}>
      <line x1="56" y1="88" x2="344" y2="88" stroke={INK} strokeWidth="2" strokeDasharray="7 7" opacity="0.4" />
      <rect x="34" y="70" width="40" height="36" rx="7" fill={INK} />
      <circle cx="364" cy="88" r="19" fill={INK} />
      <circle cx="364" cy="88" r="7" fill={base} />
      {[0, 1, 2].map((i) => (
        <circle
          key={i}
          cx={104 + i * 56}
          cy="88"
          r="7"
          fill={INK}
          className="scene-dot"
          style={{ animationDelay: `${i * 2}s` }}
        />
      ))}
    </SceneShell>
  );
}

// Shield blocking a stream: two packets run at the shield and dissolve;
// the shield halo breathes.
function GovernanceScene({ base, steps }: { base: string; steps: string[] }) {
  return (
    <SceneShell base={base} steps={steps}>
      <line x1="24" y1="88" x2="252" y2="88" stroke={INK} strokeWidth="2" opacity="0.35" />
      {[0, 1].map((i) => (
        <rect
          key={i}
          x={52 + i * 62}
          y="79"
          width="18"
          height="18"
          fill={INK}
          className="scene-packet"
          style={{ animationDelay: `${i * 3}s` }}
        />
      ))}
      <path d="M292 52 L340 68 V100 C340 128 318 146 292 154 C266 146 244 128 244 100 V68 Z" fill={INK} />
      <path
        d="M292 52 L340 68 V100 C340 128 318 146 292 154 C266 146 244 128 244 100 V68 Z"
        fill="none"
        stroke={INK}
        strokeWidth="6"
        opacity="0.35"
        className="scene-pulse"
      />
      <line x1="278" y1="96" x2="306" y2="96" stroke={base} strokeWidth="7" />
    </SceneShell>
  );
}

// Request → ledger: a request drops into the ledger while rows light up
// in sequence.
function LedgerScene({ base, steps }: { base: string; steps: string[] }) {
  return (
    <SceneShell base={base} steps={steps}>
      <line x1="200" y1="14" x2="200" y2="66" stroke={INK} strokeWidth="2" strokeDasharray="5 5" opacity="0.4" />
      <circle cx="200" cy="30" r="8" fill={INK} className="scene-drop" />
      <rect x="110" y="66" width="180" height="22" rx="4" fill={INK} opacity="0.85" />
      {[0, 1, 2].map((i) => (
        <rect
          key={i}
          x="110"
          y={94 + i * 26}
          width="180"
          height="20"
          rx="4"
          fill={INK}
          className="scene-row"
          style={{ animationDelay: `${i * 2}s` }}
        />
      ))}
    </SceneShell>
  );
}

const CheckIcon = () => (
  <svg width="34" height="34" viewBox="0 0 34 34" fill="none">
    <rect x="7" y="4" width="20" height="8" fill="#171914" />
    <rect x="7" y="14" width="12" height="6" fill="#171914" />
    <rect x="7" y="22" width="16" height="6" fill="#171914" />
    <rect x="21" y="14" width="6" height="6" fill="#171914" />
  </svg>
);
const RouteIcon = () => (
  <svg width="34" height="34" viewBox="0 0 34 34" fill="none">
    <rect x="2" y="14" width="12" height="6" fill="#171914" />
    <rect x="14" y="8" width="6" height="18" fill="#171914" />
    <rect x="20" y="14" width="12" height="6" fill="#171914" />
    <rect x="24" y="8" width="6" height="6" fill="#171914" />
    <rect x="24" y="22" width="6" height="6" fill="#171914" />
  </svg>
);
const DiamondIcon = () => (
  <svg width="34" height="34" viewBox="0 0 34 34" fill="none">
    <rect x="11" y="11" width="12" height="12" fill="#171914" transform="rotate(45 17 17)" />
    <rect x="23" y="5" width="6" height="6" fill="#171914" />
  </svg>
);

const CARDS = [
  {
    topic: "Routing",
    title: "One endpoint for every provider",
    summary: `A single OpenAI-compatible surface fans out to ${PROVIDERS.length} adapters — same keys, same shape, every model.`,
    base: "#f5e6a3",
    steps: ["#e8d189", "#f9efc4", "#e8d189", "#f9efc4", "#e8d189", "#f9efc4", "#e8d189", "#f9efc4", "#f9efc4", "#e8d189", "#f9efc4", "#e8d189", "#f9efc4", "#e8d189", "#f9efc4", "#e8d189", "#e8d189", "#f9efc4", "#e8d189", "#f9efc4", "#e8d189", "#f9efc4", "#e8d189", "#f9efc4"],
    Icon: RouteIcon,
    Scene: RoutingScene,
  },
  {
    topic: "Governance",
    title: "Guardrails that block before spend",
    summary: `${GUARDRAIL_CATEGORIES.length} guardrail categories checked by ${EVALUATORS.length} evaluators, enforced in monitor or block mode.`,
    base: "#e8b1a2",
    steps: ["#d89a8b", "#f2c6bc", "#d89a8b", "#f2c6bc", "#d89a8b", "#f2c6bc", "#d89a8b", "#f2c6bc", "#f2c6bc", "#d89a8b", "#f2c6bc", "#d89a8b", "#f2c6bc", "#d89a8b", "#f2c6bc", "#d89a8b", "#d89a8b", "#f2c6bc", "#d89a8b", "#f2c6bc", "#d89a8b", "#f2c6bc", "#d89a8b", "#f2c6bc"],
    Icon: CheckIcon,
    Scene: GovernanceScene,
  },
  {
    topic: "Observability",
    title: "From request to audit trail",
    summary: "Usage, cost, and logs for every request — analytics and exports when you need receipts.",
    base: "#c9c9c2",
    steps: ["#a8a8a1", "#dcdcd6", "#a8a8a1", "#dcdcd6", "#a8a8a1", "#dcdcd6", "#a8a8a1", "#dcdcd6", "#dcdcd6", "#a8a8a1", "#dcdcd6", "#a8a8a1", "#dcdcd6", "#a8a8a1", "#dcdcd6", "#a8a8a1", "#a8a8a1", "#dcdcd6", "#a8a8a1", "#dcdcd6", "#a8a8a1", "#dcdcd6", "#a8a8a1", "#dcdcd6"],
    Icon: DiamondIcon,
    Scene: LedgerScene,
  },
];

export default function Knowledge() {
  const revealRef = useRevealOnScroll({ staggerMs: 90 });
  const parallaxRef = useDataParallax<HTMLDivElement>();
  const gridRef = useRef<HTMLDivElement | null>(null);

  /* Card stagger parallax: the three cards sit in a clean aligned row only
     while the grid is at the viewport center. When the grid is below
     center (entering), the outer cards offset vertically (±STAGGER) and
     glide back to alignment as the grid reaches center. Transform-only,
     rAF-throttled, inert under reduced motion (static aligned row). */
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid || prefersReducedMotion()) return;
    const cards = Array.from(
      grid.querySelectorAll<HTMLElement>("[data-kcard]")
    );
    if (!cards.length) return;
    let raf = 0;
    const STAGGER = [-44, 0, 44];
    const update = () => {
      raf = 0;
      const rect = grid.getBoundingClientRect();
      const vh = window.innerHeight || 1;
      if (rect.bottom < -200 || rect.top > vh + 200) return;
      const center = rect.top + rect.height / 2;
      const p = Math.min(1, Math.max(0, (center - vh / 2) / (vh * 0.75)));
      for (let i = 0; i < cards.length; i++) {
        const off = (STAGGER[i % STAGGER.length] * p).toFixed(1);
        cards[i].style.transform =
          off === "0.0" ? "" : `translate3d(0, ${off}px, 0)`;
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
      for (const c of cards) c.style.transform = "";
    };
  }, []);
  return (
    <section id="knowledge" ref={revealRef} className="scroll-mt-16 bg-night text-cream">
      <Container width="wide" className="py-20 md:py-28">
        <p data-reveal className="text-xs font-medium text-cream/50">Our Knowledge Base</p>
        <h2 data-reveal className="mt-4 max-w-xl font-serif text-4xl font-medium tracking-tight md:text-5xl">
          Guides from the gateway era
        </h2>

        <div ref={(el) => { parallaxRef.current = el; gridRef.current = el; }} className="mx-auto mt-12 grid max-w-5xl gap-6 md:grid-cols-3">
          {CARDS.map((c, i) => (
            <div key={c.title} data-kcard={i} className="will-change-transform">
            <article data-reveal className="guide-card flex h-full flex-col border border-night-line bg-night">
              <div className="relative">
                <c.Scene base={c.base} steps={c.steps} />
                <span className="absolute left-1/2 top-1/2 flex size-20 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-2xl bg-white shadow-lg">
                  <c.Icon />
                </span>
              </div>
              <div className="flex flex-1 flex-col gap-2.5 p-6">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-cream/50">
                  Guide <span aria-hidden="true">•</span> {c.topic}
                </p>
                <h3 className="min-h-[3.5rem] font-serif text-[1.45rem] font-medium leading-snug">
                  {c.title}
                </h3>
                <p className="text-[0.95rem] leading-relaxed text-cream/70">{c.summary}</p>
                <a
                  href={DOCS_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="guide-readmore mt-auto inline-flex w-fit items-center gap-1.5 pt-3 text-[0.95rem] font-semibold text-cream"
                >
                  Read more <span aria-hidden="true">→</span>
                </a>
              </div>
            </article>
            </div>
          ))}
        </div>

        <div data-reveal className="mx-auto mt-10 flex max-w-5xl items-center gap-6">
          <span aria-hidden="true" className="h-px flex-1 bg-night-line" />
          <a
            href={DOCS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="guide-readmore inline-flex items-center gap-1.5 text-[0.95rem] font-semibold text-cream transition-opacity hover:opacity-70"
          >
            Read More <span aria-hidden="true">→</span>
          </a>
          <span aria-hidden="true" className="h-px flex-1 bg-night-line" />
        </div>
      </Container>
    </section>
  );
}
