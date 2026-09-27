import {
  BookOpenText,
  Bot,
  Gauge,
  KeyRound,
  Layers,
  PiggyBank,
  ScrollText,
  Server,
  Workflow,
} from "lucide-react";
import { SectionHeading, Reveal } from "./nav";

const FEATURES = [
  {
    icon: Layers,
    title: "One OpenAI-compatible endpoint",
    body: "Point any OpenAI client at ToLLma and switch models without touching app code.",
  },
  {
    icon: Server,
    title: "Cloud + local providers",
    body: "Route to hosted APIs and self-hosted Ollama side by side, per key or per request.",
  },
  {
    icon: Bot,
    title: "Agent hosting & tools",
    body: "Run agents behind the same gateway with tool calls, RAG, and conversation state.",
  },
  {
    icon: KeyRound,
    title: "Keys & access control",
    body: "Issue scoped API keys, rotate and revoke them from one admin dashboard.",
  },
  {
    icon: PiggyBank,
    title: "Budgets & spend tracking",
    body: "Per-key budgets with usage metering, so costs stay visible before the invoice.",
  },
  {
    icon: ScrollText,
    title: "Gateway request logs",
    body: "Every proxied call logged with latency and status — debugging without guesswork.",
  },
  {
    icon: BookOpenText,
    title: "Knowledge repository",
    body: "Ingest documents once and serve grounded answers to any connected model or agent.",
  },
  {
    icon: Gauge,
    title: "Analytics dashboard",
    body: "Token usage, latency, and error trends per model, key, and time range.",
  },
  {
    icon: Workflow,
    title: "Self-hosted & open",
    body: "Docker Compose deploy, Postgres + Redis, Apache 2.0 — your data never leaves your stack.",
  },
];

export default function Features() {
  return (
    <section id="features" className="scroll-mt-20 bg-white py-16 sm:py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHeading
          eyebrow="Features"
          title="Everything between your app and the models"
          sub="Nine capabilities, one deploy. No per-seat pricing, no vendor lock-in."
        />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f, i) => (
            <Reveal key={f.title} delay={Math.min(i * 0.05, 0.25)}>
              <article className="group h-full rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md">
                <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-brand-light text-brand transition group-hover:bg-brand group-hover:text-white">
                  <f.icon className="h-5 w-5" aria-hidden />
                </span>
                <h3 className="text-base font-bold">{f.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted">{f.body}</p>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
