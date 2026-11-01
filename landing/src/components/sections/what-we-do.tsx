"use client";

// Three capability columns: Secure / Govern / Observe. Batch fade-up on
// scroll (~80ms stagger), vertical hairline dividers, mint pixel-block
// icons. Every bullet is a verified site.ts fact.
import { Container } from "@/components/ui/layout";
import { GUARDRAIL_CATEGORIES } from "@/lib/site";
import { useRevealOnScroll } from "@/lib/animations";

/* Pixel glyphs: mint square, black stepped rects, no strokes. */
function PixelIcon({ cells }: { cells: [number, number, number, number][] }) {
  return (
    <svg width="44" height="44" viewBox="0 0 44 44" aria-hidden="true">
      <rect width="44" height="44" fill="#72ddb1" />
      {cells.map(([x, y, w, h], i) => (
        <rect key={i} x={x} y={y} width={w} height={h} fill="#171914" />
      ))}
    </svg>
  );
}

/* Vault: stepped keyhole + shackle. */
const VAULT: [number, number, number, number][] = [
  [14, 8, 16, 4], [14, 8, 4, 10], [26, 8, 4, 10],
  [18, 20, 8, 8], [20, 28, 4, 8],
];
/* Policy gate: request → diamond → allow/block. */
const GATE: [number, number, number, number][] = [
  [6, 20, 8, 4], [18, 14, 4, 16], [16, 12, 8, 4], [16, 28, 8, 4],
  [26, 10, 10, 8], [26, 26, 10, 8],
];
/* Usage bars rising to a cost tick. */
const BARS: [number, number, number, number][] = [
  [8, 28, 6, 8], [17, 22, 6, 14], [26, 14, 6, 22], [26, 8, 12, 4],
];

const COLS = [
  {
    title: "Secure",
    icon: <PixelIcon cells={VAULT} />,
    desc: "Store credentials once — every request authenticates without exposing a provider key.",
    bullets: [
      "Central API keys, global or per-key scope",
      "Provider secrets stay on the server",
      "Same keys across every provider",
    ],
  },
  {
    title: "Govern",
    icon: <PixelIcon cells={GATE} />,
    desc: "Each request passes policy before it runs — allowed through, or blocked before spend.",
    bullets: [
      `Guardrails across ${GUARDRAIL_CATEGORIES.length} categories`,
      "Monitor or block enforcement modes",
      "Policies scoped globally or per API key",
    ],
  },
  {
    title: "Observe",
    icon: <PixelIcon cells={BARS} />,
    desc: "Every request leaves a trail: usage, cost, and logs you can actually audit.",
    bullets: [
      "Usage & cost visibility per key",
      "Request logs with prompt logging",
      "Analytics and exports for audit",
    ],
  },
];

export default function WhatWeDo() {
  const revealRef = useRevealOnScroll({ staggerMs: 80 });
  return (
    <section id="what-we-do" ref={revealRef} className="scroll-mt-20 bg-cream">
      <Container width="wide" className="py-20 md:py-28">
        <p data-reveal className="text-center text-xs font-medium text-coal/60">
          What We Do
        </p>
        <h2 data-reveal className="mx-auto mt-4 max-w-2xl text-center font-serif text-4xl font-medium tracking-tight text-coal md:text-5xl">
          Introducing Unified Gateway Management
        </h2>
        <p data-reveal className="mx-auto mt-5 max-w-xl text-center text-[1.05rem] leading-relaxed text-coal/70">
          Traditional gateways proxy requests. ToLLma&apos;s gateway runs the work.
        </p>

        <div className="mt-14 grid gap-10 md:grid-cols-3 md:gap-0 md:divide-x md:divide-cream-line">
          {COLS.map((c) => (
            <div key={c.title} data-reveal className="flex h-full flex-col items-start gap-4 md:px-10 md:first:pl-0 md:last:pr-0">
              {c.icon}
              <h3 className="font-serif text-2xl font-medium text-coal">{c.title}</h3>
              <p className="font-semibold leading-relaxed text-coal">{c.desc}</p>
              <ul className="mt-auto flex flex-col gap-2.5 pt-2 text-coal/75">
                {c.bullets.map((b) => (
                  <li key={b} className="flex items-start gap-2.5">
                    <span aria-hidden="true" className="mt-1 text-[0.7rem] leading-none text-coal">
                      ▷
                    </span>
                    {b}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Container>
    </section>
  );
}
