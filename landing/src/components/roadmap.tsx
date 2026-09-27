import { ArrowRight, Compass, Rocket, Telescope } from "lucide-react";
import { SectionHeading, Reveal } from "./nav";

const COLUMNS = [
  {
    icon: Rocket,
    phase: "Now",
    color: "bg-mint-light text-emerald-700",
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
    <section id="roadmap" className="scroll-mt-20 bg-white py-16 sm:py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHeading
          eyebrow="Roadmap"
          title="Where ToLLma is headed"
          sub="No dates, no hype — just the order we're building in. Priorities shift with community feedback."
        />
        <div className="grid gap-4 md:grid-cols-3">
          {COLUMNS.map((c, i) => (
            <Reveal key={c.phase} delay={i * 0.08}>
              <article className="h-full rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <span className={`mb-3 inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-extrabold tracking-widest uppercase ${c.color}`}>
                  <c.icon className="h-3.5 w-3.5" aria-hidden /> {c.phase}
                </span>
                <ul className="space-y-2.5">
                  {c.items.map((item) => (
                    <li key={item} className="flex items-start gap-2 text-sm">
                      <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-slate-300" aria-hidden />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
