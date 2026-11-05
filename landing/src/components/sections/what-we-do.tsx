"use client";

// Three static pillars: Secure / Govern / Observe. All content is visible
// by default — no accordion, no tabs, no hidden state. Equal-width grid
// columns share one spacing system; headings align, visuals pin to the
// column bottoms via mt-auto. Top rules draw L→R scrubbed on entry;
// bullets stagger at 40% visibility; icons stroke-draw on hover. Compact
// inline SVG vignettes (key flow, policy checkpoint, request trail) use
// the existing ink/mint/coral palette. SSR/reduced-motion: final states.
import { useEffect } from "react";
import { Container } from "@/components/ui/layout";
import { Parallax } from "@/components/ui/parallax";
import {
  animate,
  stagger,
  useInViewOnce,
  useRevealOnScroll,
  utils,
} from "@/lib/animations";
import { prefersReducedMotion } from "@/lib/animations/motion-preference";
import { GUARDRAIL_CATEGORIES } from "@/lib/site";

/* 24px single-weight stroke glyph, ink color, transparent container. */
function Glyph({ children }: { children: React.ReactNode }) {
  return (
    <span className="pillar-icon" aria-hidden="true">
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {children}
      </svg>
    </span>
  );
}

/* Compact static vignettes: one shared stroke language, restrained
   mint/coral accents. Decorative; columns are complete without them. */
function SecureVisual() {
  return (
    <svg
      viewBox="0 0 200 92"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="pillar-visual"
      aria-hidden="true"
    >
      <rect x="8" y="30" width="40" height="32" rx="7" />
      <path d="M20 46h16M32 46v6M36 46v4" />
      <path d="M48 46h22" strokeDasharray="3 3" />
      <circle cx="28" cy="46" r="2.4" fill="var(--color-mint)" stroke="none" />
      <rect x="70" y="28" width="44" height="36" rx="7" />
      <path d="M88 36l5 2.2V44c0 3.2-2.1 5.4-5 6.4-2.9-1-5-3.2-5-6.4v-5.8l5-2.2z" />
      <path d="M86.2 43.6l1.3 1.3 2.5-2.6" stroke="var(--color-mint)" />
      <path d="M114 46h20" strokeDasharray="3 3" />
      <rect x="134" y="30" width="58" height="32" rx="7" />
      <path d="M142 42h42M142 50h28" stroke="var(--color-coal)" strokeOpacity="0.35" />
    </svg>
  );
}

function GovernVisual() {
  return (
    <svg
      viewBox="0 0 200 92"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="pillar-visual"
      aria-hidden="true"
    >
      <circle cx="18" cy="46" r="5" />
      <circle cx="18" cy="46" r="1.6" fill="currentColor" stroke="none" />
      <path d="M23 46h22" />
      <path d="M45 30l16 16-16 16-16-16 16-16z" />
      <path d="M61 46h22" stroke="var(--color-mint)" />
      <circle cx="92" cy="46" r="5" stroke="var(--color-mint)" />
      <path d="M89.8 46l1.5 1.5 2.7-2.8" stroke="var(--color-mint)" />
      <path d="M53 60l-6 14h42l-6-14" stroke="var(--color-warm)" strokeDasharray="3 3" />
      <circle cx="83" cy="74" r="5" stroke="var(--color-warm)" />
      <path d="M81 74h4" stroke="var(--color-warm)" />
    </svg>
  );
}

function ObserveVisual() {
  return (
    <svg
      viewBox="0 0 200 92"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="pillar-visual"
      aria-hidden="true"
    >
      <path d="M30 8v76" strokeOpacity="0.4" />
      <circle cx="30" cy="22" r="3" fill="var(--color-mint)" stroke="none" />
      <circle cx="30" cy="46" r="3" fill="var(--color-mint)" stroke="none" />
      <circle cx="30" cy="70" r="3" fill="var(--color-warm)" stroke="none" />
      <path d="M44 22h30M44 46h52M44 70h38" strokeOpacity="0.35" />
      <rect x="118" y="30" width="74" height="44" rx="7" />
      <path d="M126 66v-8M134 66V50M142 66v-12M150 66V44M158 66v-6M166 66v-10M174 66V54M182 66v-8" stroke="var(--color-mint)" />
    </svg>
  );
}

function BulletList({ bullets }: { bullets: string[] }) {
  const [ref, seen] = useInViewOnce<HTMLUListElement>(0.4);

  useEffect(() => {
    const ul = ref.current;
    if (!ul || !seen || prefersReducedMotion()) return;
    const items = Array.from(ul.querySelectorAll("li"));
    if (!items.length) return;
    utils.set(items, { opacity: 0, y: 12 });
    const a = animate(items, {
      opacity: [0, 1],
      y: [12, 0],
      duration: 500,
      delay: stagger(60),
      ease: "outExpo",
    });
    return () => {
      a.revert();
    };
  }, [ref, seen]);

  return (
    <ul ref={ref} className="flex flex-col gap-2.5 pt-2 text-coal/75">
      {bullets.map((b) => (
        <li key={b} className="flex items-start gap-2.5">
          <span aria-hidden="true" className="mt-1 text-[0.75rem] leading-none text-coal">
            ▷
          </span>
          {b}
        </li>
      ))}
    </ul>
  );
}

const COLS = [
  {
    n: "01",
    eyebrow: "Security",
    title: "Secure",
    icon: (
      <Glyph>
        <circle className="pillar-stroke" cx="8" cy="8" r="4" pathLength={1} />
        <path className="pillar-stroke" d="M11 11l9 9M17 17l2-2M14 14l1.5-1.5" pathLength={1} />
      </Glyph>
    ),
    desc: "Store credentials once — every request authenticates without exposing a provider key.",
    bullets: [
      "Central API keys, global or per-key scope",
      "Provider secrets stay on the server",
      "Same keys across every provider",
    ],
    visual: <SecureVisual />,
  },
  {
    n: "02",
    eyebrow: "Policy enforcement",
    title: "Govern",
    icon: (
      <Glyph>
        <path className="pillar-stroke" d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" pathLength={1} />
        <path className="pillar-stroke" d="M9.5 12l1.8 1.8L15 10" pathLength={1} />
      </Glyph>
    ),
    desc: "Each request passes policy before it runs — allowed through, or blocked before spend.",
    bullets: [
      `Guardrails across ${GUARDRAIL_CATEGORIES.length} categories`,
      "Monitor or block enforcement modes",
      "Policies scoped globally or per API key",
    ],
    visual: <GovernVisual />,
  },
  {
    n: "03",
    eyebrow: "Observability",
    title: "Observe",
    icon: (
      <Glyph>
        <path className="pillar-stroke" d="M4 20V4M4 20h16" pathLength={1} />
        <path className="pillar-stroke" d="M8 20v-6M12 20v-9M16 20v-4M20 20v-8" pathLength={1} />
      </Glyph>
    ),
    desc: "Every request leaves a trail: usage, cost, and logs you can actually audit.",
    bullets: [
      "Usage & cost visibility per key",
      "Request logs with prompt logging",
      "Analytics and exports for audit",
    ],
    visual: <ObserveVisual />,
  },
];

export default function WhatWeDo() {
  const revealRef = useRevealOnScroll({ staggerMs: 80 });

  /* Top rules draw L→R scrubbed on entry (transform-only, rAF). */
  useEffect(() => {
    const root = revealRef.current;
    if (!root) return;
    const rules = Array.from(root.querySelectorAll<HTMLElement>(".pillar-rule"));
    if (!rules.length) return;
    if (prefersReducedMotion()) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const vh = window.innerHeight || 1;
      rules.forEach((rule) => {
        const rect = rule.getBoundingClientRect();
        const p = Math.min(1, Math.max(0, (vh * 0.92 - rect.top) / (vh * 0.45)));
        rule.style.transform = `scaleX(${p.toFixed(3)})`;
      });
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
      rules.forEach((rule) => {
        rule.style.transform = "";
      });
    };
  }, [revealRef]);

  return (
    <section id="what-we-do" ref={revealRef} className="scroll-mt-20 bg-cream">
      <Container width="wide" className="py-20 md:py-28">
        <Parallax speed={0.5}>
          <div>
            <p data-reveal className="text-center text-xs font-medium text-coal/60">
              What We Do
            </p>
            <h2 data-reveal className="mx-auto mt-4 max-w-2xl text-center font-serif text-4xl font-medium tracking-tight text-coal md:text-5xl">
              Introducing Unified Gateway Management
            </h2>
            <p data-reveal className="mx-auto mt-5 max-w-xl text-center text-[1.05rem] leading-relaxed text-coal/70">
              Traditional gateways proxy requests. ToLLma&apos;s gateway runs the work.
            </p>
          </div>
        </Parallax>

        <Parallax speed={0.85}>
          <div className="mt-14 grid gap-12 md:grid-cols-2 md:gap-x-10 lg:grid-cols-3 lg:gap-0 lg:divide-x lg:divide-cream-line">
            {COLS.map((c) => (
              <article
                key={c.title}
                data-reveal
                className="pillar flex h-full flex-col items-start md:px-10 md:pl-0 lg:px-10 lg:first:pl-0 lg:last:pr-0 md:[&:nth-child(3)]:col-span-2 lg:[&:nth-child(3)]:col-span-1"
              >
                <span className="pillar-rule" aria-hidden="true" />
                <p className="mt-5 text-xs font-semibold uppercase tracking-[0.14em] text-coal/50">
                  {c.n} / {c.eyebrow}
                </p>
                {c.icon}
                <h3 className="mt-1 font-serif text-2xl font-medium text-coal">
                  {c.title}
                </h3>
                <p className="mt-3 font-semibold leading-relaxed text-coal">{c.desc}</p>
                <BulletList bullets={c.bullets} />
                <div className="mt-auto w-full max-w-[220px] pt-8" aria-hidden="true">
                  {c.visual}
                </div>
              </article>
            ))}
          </div>
        </Parallax>
      </Container>
      <style>{`
        .pillar-rule {
          display: block; width: 100%; height: 2px; border-radius: 2px;
          background: color-mix(in srgb, var(--color-coal) 18%, transparent);
          transform: scaleX(1); transform-origin: 0 50%;
          transition: background-color 250ms ease;
        }
        .pillar:hover .pillar-rule { background: var(--color-coal); }
        .pillar-icon {
          width: 24px; height: 24px; flex: none; margin-top: 1rem;
          display: grid; place-items: center; color: var(--color-coal);
          background: transparent; background-color: transparent;
        }
        .pillar-stroke { stroke-dasharray: 1; stroke-dashoffset: 0; }
        .pillar:hover .pillar-stroke { animation: pillar-draw 650ms var(--ease-out-expo); }
        .pillar:hover .pillar-stroke:nth-child(2) { animation-delay: 120ms; }
        @keyframes pillar-draw { from { stroke-dashoffset: 1; } to { stroke-dashoffset: 0; } }
        .pillar-visual {
          width: 100%; height: auto; color: var(--color-coal);
          opacity: 0.82; transition: opacity 250ms ease;
        }
        .pillar:hover .pillar-visual { opacity: 1; }
        @media (prefers-reduced-motion: reduce) {
          .pillar:hover .pillar-stroke { animation: none; }
          .pillar-visual { transition: none; }
        }
      `}</style>
    </section>
  );
}
