"use client";

// Infinite auto-scroll provider strip — runs on its own slow clock,
// independent of page scroll. Pauses on hover AND keyboard focus; each
// name brightens on hover. No customer claims: every name is a verified
// adapter (or adapter class) from site.ts. Reduced-motion: static list.
import { Container } from "@/components/ui/layout";
import { useInViewToggle } from "@/lib/animations";
import { PROVIDERS } from "@/lib/site";

const NAMES = [
  ...PROVIDERS.filter((p) => p.id !== "custom").map((p) => p.name),
  "vLLM",
  "Ollama",
  "OpenAI-compatible",
];

export default function Marquee() {
  const [ref, playing] = useInViewToggle<HTMLElement>(0);
  const row = (hidden: boolean) => (
    <div className="flex w-max shrink-0 items-center" aria-hidden={hidden || undefined}>
      {NAMES.map((n) => (
        <span key={`${hidden ? "b-" : "a-"}${n}`} className="flex items-center">
          <span className="marquee-item whitespace-nowrap px-10 font-serif text-[1.6rem] font-medium text-coal/35">
            {n}
          </span>
          <span className="size-1.5 rounded-full bg-coal/20" aria-hidden="true" />
        </span>
      ))}
    </div>
  );

  return (
    <section
      ref={ref}
      data-playing={playing}
      aria-label="Providers"
      className="marquee marquee-slow overflow-hidden border-b border-cream-line bg-cream"
    >
      <Container width="wide" className="flex items-center gap-8 py-5">
        <p className="w-40 shrink-0 text-xs font-semibold uppercase leading-snug tracking-[0.14em] text-coal/50">
          Works with your providers
        </p>
        <div className="relative min-w-0 flex-1 overflow-hidden">
          <div className="marquee-track flex w-max">
            {row(false)}
            {row(true)}
          </div>
        </div>
      </Container>
      <style>{`
        .marquee-slow .marquee-track { animation-duration: 60s; }
        .marquee-item { transition: color 250ms ease; }
        .marquee-item:hover { color: var(--color-coal); }
        @media (prefers-reduced-motion: reduce) {
          .marquee-slow .marquee-track { animation: none; }
        }
      `}</style>
    </section>
  );
}
