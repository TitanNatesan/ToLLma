import { ArrowRight, Compass, Rocket, Telescope } from "lucide-react";
import { SectionHeading } from "./nav";
import { FadeUp } from "@/lib/motion";

const COLUMNS = [
  {
    icon: Rocket,
    phase: "Now",
    color: "bg-mint-light text-emerald-700",
    dot: "bg-emerald-500",
    items: [
      "OpenAI-compatible gateway (chat, embeddings)",
      "Cloud + Ollama provider routing",
      "API keys, budgets, request logs",
      "Chat UI and admin dashboard",
      "Docker Compose self-hosting",
    ],
  },
  {
    icon: Compass,
    phase: "Next",
    color: "bg-brand-light text-brand-dark",
    dot: "bg-brand",
    items: [
      "Agent hosting with tool calls",
      "Knowledge repository + grounded answers",
      "Usage analytics and spend alerts",
      "Provider failover and load balancing",
      "Public docs and quickstart guides",
    ],
  },
  {
    icon: Telescope,
    phase: "Future",
    color: "bg-gold-light text-yellow-700",
    dot: "bg-gold",
    items: [
      "Multi-agent orchestration",
      "Fine-grained team roles & SSO",
      "Eval harnesses per model",
      "Plugin marketplace",
      "Managed cloud option (optional)",
    ],
  },
];

export default function Roadmap() {
  return (
    <section
      id="roadmap"
      aria-label="Roadmap"
      className="section relative scroll-mt-20 overflow-hidden bg-white"
    >
      <div
        aria-hidden
        className="bg-grid pointer-events-none absolute inset-0 opacity-70 [mask-image:radial-gradient(48rem_26rem_at_50%_50%,black,transparent_78%)]"
      />
      <div className="container-x relative">
        <SectionHeading
          eyebrow="Roadmap"
          title="Where ToLLma is headed"
          sub="No dates, no hype — just the order we're building in. Priorities shift with community feedback."
        />

        {/* Connected timeline: gradient progress line + nodes.
            Line center (top-3 + 1px) aligns with node centers
            (article top + dot offset + 9px). Dots sit on the line on md+. */}
        <div className="relative pt-3">
          <div
            aria-hidden
            className="absolute top-3 right-[41px] left-[41px] hidden h-0.5 rounded-full bg-slate-200 md:block"
          />
          <div
            aria-hidden
            className="animate-roadmap-flow absolute top-3 right-[41px] left-[41px] hidden h-0.5 rounded-full bg-gradient-to-r from-emerald-400 via-brand to-gold md:block"
          />
          <ol className="grid gap-4 md:grid-cols-3 md:gap-6">
            {COLUMNS.map((c, i) => {
              const isActive = c.phase === "Now";
              return (
              <li key={c.phase} className="relative">
                <FadeUp delay={i * 0.08} className="h-full">
                  <article
                    aria-current={isActive ? "true" : undefined}
                    className={`card relative h-full p-5 ${
                      isActive
                        ? "border-emerald-200 shadow-[0_16px_36px_-16px_rgba(16,185,129,0.4)] ring-2 ring-emerald-500/25"
                        : ""
                    }`}
                  >
                    <span
                      aria-hidden
                      className={`absolute -top-2 left-8 hidden h-[18px] w-[18px] rounded-full border-4 border-white ${c.dot} shadow md:block ${
                        isActive ? "ring-4 ring-emerald-500/20" : ""
                      }`}
                    >
                      {isActive && (
                        <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400/60 motion-reduce:animate-none" />
                      )}
                    </span>
                    <span className={`mb-3 inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-extrabold tracking-widest uppercase ${c.color}`}>
                      <c.icon className="h-3.5 w-3.5" aria-hidden /> {c.phase}
                    </span>
                    <ul className="space-y-2.5">
                      {c.items.map((item, j) => (
                        <li key={item} className="flex items-start gap-2 text-sm">
                          <ArrowRight
                            className={`mt-0.5 h-4 w-4 shrink-0 ${j === 0 ? "text-brand" : "text-slate-300"}`}
                            aria-hidden
                          />
                          <span className={j === 0 ? "font-semibold" : undefined}>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </article>
                </FadeUp>
              </li>
              );
            })}
          </ol>
        </div>
      </div>
    </section>
  );
}
