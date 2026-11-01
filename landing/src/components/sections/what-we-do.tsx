"use client";

// Three capability columns: Secure / Govern / Observe. Heading drifts at
// 0.5 parallax, columns at 0.85. Each column carries a top rule that draws
// L→R scrubbed on entry; bullets stagger 60ms at 40% visibility. Icons are
// 24px single-weight (1.7) stroke glyphs in ink with a transparent container
// (no tile) and stroke-draw on hover while the rule brightens. Clicking a
// title toggles its detail INSIDE the same card (2 site.ts-derived sentences
// + 1 link, chevron rotates); only one card is open at a time and clicking
// the open card closes it. Every bullet is a verified site.ts fact.
// SSR/reduced-motion render final states; expansion is CSS-only (320ms
// ease-out, instant under reduced-motion).
import { useEffect, useState } from "react";
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
import {
  DOCS_URL,
  ENFORCEMENT,
  GET_STARTED_URL,
  GITHUB_URL,
  GUARDRAIL_CATEGORIES,
  PROVIDERS,
} from "@/lib/site";

const SCOPES = "global or per-key";

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
    <ul ref={ref} className="mt-auto flex flex-col gap-2.5 pt-2 text-coal/75">
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
    detail: [
      `One keyset reaches all ${PROVIDERS.length} provider adapters through a single OpenAI-compatible endpoint.`,
      `Keys carry ${SCOPES} scope, and provider secrets never leave the server.`,
    ],
    link: { href: DOCS_URL, label: "Read the setup docs" },
  },
  {
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
    detail: [
      `Every request passes ${GUARDRAIL_CATEGORIES.length} guardrail categories — prompt injection, PII, tool actions and more — before any spend.`,
      `Policies enforce ${ENFORCEMENT.join(" or ")} mode with global or per-key scope.`,
    ],
    link: { href: GITHUB_URL, label: "See guardrails on GitHub" },
  },
  {
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
    detail: [
      "Usage, cost, request logs, analytics and exports are recorded per key for audit.",
      "Prompt logging and conversation history keep every decision traceable.",
    ],
    link: { href: GET_STARTED_URL, label: "Try the quickstart" },
  },
];

function CardDetail({
  col,
  detailId,
  isOpen,
}: {
  col: (typeof COLS)[number];
  detailId: string;
  isOpen: boolean;
}) {
  return (
    <div
      id={detailId}
      role="region"
      aria-label={`${col.title} details`}
      inert={!isOpen}
      className={`pillar-detail w-full${isOpen ? " is-open" : ""}`}
    >
      <div
        className={`pillar-detail-inner ${isOpen ? "pt-4 border-t border-cream-line" : "pt-0"}`}
      >
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-coal/50">
          {col.title.toUpperCase()}
        </p>
        <p className="mt-3 leading-relaxed text-coal">{col.detail[0]}</p>
        <p className="mt-2 leading-relaxed text-coal">{col.detail[1]}</p>
        <a
          href={col.link.href}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-coal underline decoration-mint decoration-2 underline-offset-4 hover:decoration-coal"
        >
          {col.link.label} <span aria-hidden="true">→</span>
        </a>
      </div>
    </div>
  );
}

export default function WhatWeDo() {
  const revealRef = useRevealOnScroll({ staggerMs: 80 });
  const [open, setOpen] = useState<number | null>(null);

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
          <div className="mt-14 grid gap-10 md:grid-cols-3 md:gap-0 md:divide-x md:divide-cream-line">
            {COLS.map((c, i) => {
              const detailId = `wwd-detail-${c.title.toLowerCase()}`;
              const isOpen = open === i;
              return (
                <article
                  key={c.title}
                  data-reveal
                  className="pillar flex h-full flex-col items-start gap-4 md:px-10 md:first:pl-0 md:last:pr-0"
                >
                  <span className="pillar-rule" aria-hidden="true" />
                  {c.icon}
                  <h3 className="font-serif text-2xl font-medium text-coal">
                    <button
                      type="button"
                      onClick={() => setOpen(isOpen ? null : i)}
                      aria-expanded={isOpen}
                      aria-controls={detailId}
                      className="pillar-toggle inline-flex items-center gap-2"
                    >
                      {c.title}
                      <svg
                        className="pillar-chevron"
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="m6 9 6 6 6-6" />
                      </svg>
                    </button>
                  </h3>
                  <p className="font-semibold leading-relaxed text-coal">{c.desc}</p>
                  <BulletList bullets={c.bullets} />
                  <CardDetail col={c} detailId={detailId} isOpen={isOpen} />
                </article>
              );
            })}
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
          width: 24px; height: 24px; flex: none;
          display: grid; place-items: center; color: var(--color-coal);
          background: transparent; background-color: transparent;
        }
        .pillar-stroke { stroke-dasharray: 1; stroke-dashoffset: 0; }
        .pillar:hover .pillar-stroke { animation: pillar-draw 650ms var(--ease-out-expo); }
        .pillar:hover .pillar-stroke:nth-child(2) { animation-delay: 120ms; }
        @keyframes pillar-draw { from { stroke-dashoffset: 1; } to { stroke-dashoffset: 0; } }
        .pillar-toggle { transition: opacity 200ms ease; }
        .pillar-toggle:hover { opacity: 0.72; }
        .pillar-chevron { transition: transform 320ms ease-out; }
        .pillar-toggle[aria-expanded="true"] .pillar-chevron { transform: rotate(180deg); }
        .pillar-detail {
          display: grid; grid-template-rows: 0fr; opacity: 0;
          transition: grid-template-rows 320ms ease-out, opacity 320ms ease-out;
        }
        .pillar-detail-inner { overflow: hidden; min-height: 0; transition: padding-top 320ms ease-out; }
        .pillar-detail.is-open { grid-template-rows: 1fr; opacity: 1; }
        @media (prefers-reduced-motion: reduce) {
          .pillar:hover .pillar-stroke { animation: none; }
          .pillar-detail, .pillar-detail-inner, .pillar-chevron { transition: none; }
        }
      `}</style>
    </section>
  );
}
