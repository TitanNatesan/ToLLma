import { Container } from "@/components/ui/layout";
import { DOCS_URL, EVALUATORS, GUARDRAIL_CATEGORIES, PROVIDERS } from "@/lib/site";

// Dark knowledge band. Covers are pixel-mosaic SVGs (stepped rects in
// butter / warm / gray) with a centered white rounded icon tile. Meta line
// is "Guide • topic" (no invented dates). Titles stay on two lines.
// "Read More →" is centered with hairlines on both sides.

function Mosaic({ base, steps, Icon }: { base: string; steps: string[]; Icon: () => React.JSX.Element }) {
  return (
    <div className="relative overflow-hidden" aria-hidden="true">
      <svg viewBox="0 0 400 176" className="block h-44 w-full" preserveAspectRatio="xMidYMid slice">
        <rect width="400" height="176" fill={base} />
        {steps.map((d, i) => (
          <rect key={i} x={20 + (i % 8) * 46} y={i < 8 ? 18 : i < 16 ? 62 : 106} width="42" height="38" fill={d} opacity="0.55" />
        ))}
      </svg>
      <span className="absolute left-1/2 top-1/2 flex size-20 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-2xl bg-white shadow-lg">
        <Icon />
      </span>
    </div>
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
  },
  {
    topic: "Governance",
    title: "Guardrails that block before spend",
    summary: `${GUARDRAIL_CATEGORIES.length} guardrail categories checked by ${EVALUATORS.length} evaluators, enforced in monitor or block mode.`,
    base: "#e8b1a2",
    steps: ["#d89a8b", "#f2c6bc", "#d89a8b", "#f2c6bc", "#d89a8b", "#f2c6bc", "#d89a8b", "#f2c6bc", "#f2c6bc", "#d89a8b", "#f2c6bc", "#d89a8b", "#f2c6bc", "#d89a8b", "#f2c6bc", "#d89a8b", "#d89a8b", "#f2c6bc", "#d89a8b", "#f2c6bc", "#d89a8b", "#f2c6bc", "#d89a8b", "#f2c6bc"],
    Icon: CheckIcon,
  },
  {
    topic: "Observability",
    title: "From request to audit trail",
    summary: "Usage, cost, and logs for every request — analytics and exports when you need receipts.",
    base: "#c9c9c2",
    steps: ["#a8a8a1", "#dcdcd6", "#a8a8a1", "#dcdcd6", "#a8a8a1", "#dcdcd6", "#a8a8a1", "#dcdcd6", "#dcdcd6", "#a8a8a1", "#dcdcd6", "#a8a8a1", "#dcdcd6", "#a8a8a1", "#dcdcd6", "#a8a8a1", "#a8a8a1", "#dcdcd6", "#a8a8a1", "#dcdcd6", "#a8a8a1", "#dcdcd6", "#a8a8a1", "#dcdcd6"],
    Icon: DiamondIcon,
  },
];

export default function Knowledge() {
  return (
    <section id="knowledge" className="scroll-mt-16 bg-night text-cream">
      <Container width="wide" className="py-20 md:py-28">
        <p className="text-xs font-medium text-cream/50">Our Knowledge Base</p>
        <h2 className="mt-4 max-w-xl font-serif text-4xl font-medium tracking-tight md:text-5xl">
          Guides from the gateway era
        </h2>

        <div className="mx-auto mt-12 grid max-w-5xl gap-6 md:grid-cols-3">
          {CARDS.map((c) => (
            <article key={c.title} className="guide-card flex flex-col border border-night-line bg-night">
              <Mosaic base={c.base} steps={c.steps} Icon={c.Icon} />
              <div className="flex flex-1 flex-col gap-2.5 p-6">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-cream/50">
                  Guide <span aria-hidden="true">•</span> {c.topic}
                </p>
                <h3 className="min-h-[3.5rem] font-serif text-[1.45rem] font-medium leading-snug">
                  {c.title}
                </h3>
                <p className="text-[0.95rem] leading-relaxed text-cream/70">{c.summary}</p>
              </div>
            </article>
          ))}
        </div>

        <div className="mx-auto mt-10 flex max-w-5xl items-center gap-6">
          <span aria-hidden="true" className="h-px flex-1 bg-night-line" />
          <a
            href={DOCS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-[0.95rem] font-semibold text-cream transition-opacity hover:opacity-70"
          >
            Read More <span aria-hidden="true">→</span>
          </a>
          <span aria-hidden="true" className="h-px flex-1 bg-night-line" />
        </div>
      </Container>
    </section>
  );
}
