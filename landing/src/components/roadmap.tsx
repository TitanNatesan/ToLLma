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
      className="relative scroll-mt-20 overflow-hidden bg-white py-16 sm:py-20"
    >
      <div
        aria-hidden
        className="bg-grid pointer-events-none absolute inset-0 opacity-70 [mask-image:radial-gradient(48rem_26rem_at_50%_50%,black,transparent_78%)]"
      />
      <div className="relative mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHeading
          eyebrow="Roadmap"
          title="Where ToLLma is headed"
          sub="No dates, no hype — just the order we're building in. Priorities shift with community feedback."
        />

        {/* Connected timeline: gradient progress line + nodes */}
        <div className="relative">
          <div
            aria-hidden
            className="absolute top-5 right-8 left-8 hidden h-0.5 rounded-full bg-gradient-to-r from-emerald-400 via-brand to-gold md:block"
          />
          <ol className="grid gap-4 md:grid-cols-3 md:gap-6">
            {COLUMNS.map((c, i) => (
              <li key={c.phase} className="relative">
                <FadeUp delay={i * 0.08} className="h-full">
                  <article className="relative h-full rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                    <span
                      aria-hidden
                      className={`absolute -top-[9px] left-8 hidden h-[18px] w-[18px] rounded-full border-4 border-white ${c.dot} shadow md:block`}
                    />
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
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
