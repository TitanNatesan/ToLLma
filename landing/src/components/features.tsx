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
import { SectionHeading } from "./nav";

const FEATURED = [
  {
    icon: Layers,
    title: "One OpenAI-compatible endpoint",
    body: "Point any OpenAI client at ToLLma and switch models without touching app code.",
    detail: "Model aliases decouple your code from providers. Swap gpt-4o-mini for a local Llama with a config line — same wire format in, same wire format out.",
  },
  {
    icon: Server,
    title: "Cloud + local providers",
    body: "Route to hosted APIs and self-hosted Ollama side by side, per key or per request.",
    detail: "Mix OpenAI, Anthropic, and Ollama behind one gateway with per-key routing rules and fallbacks when a provider hiccups.",
  },
  {
    icon: Bot,
    title: "Agent hosting & tools",
    body: "Run agents behind the same gateway with tool calls, RAG, and conversation state.",
    detail: "Agents get the same keys, budgets, and logs as plain completions — tools and retrieval included.",
  },
];

const SECONDARY = [
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
    <section
      id="features"
      aria-label="Features"
      className="section relative scroll-mt-20 overflow-hidden bg-white"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(44rem_22rem_at_50%_0%,rgba(37,99,235,0.07),transparent)]"
      />
      <div className="container-x relative">
        <SectionHeading
          eyebrow="Features"
          title="Everything between your app and the models"
          sub="Nine capabilities, one deploy. No per-seat pricing, no vendor lock-in."
          motion={false}
        />

        {/* Featured magazine row (calm section: static, no entrances) */}
        <div className="grid gap-4 lg:grid-cols-3">
          {FEATURED.map((f, i) => (
            <article
              key={f.title}
              className={`gradient-border flex h-full flex-col rounded-2xl p-6 shadow-sm ${
                i === 0 ? "lg:-rotate-[0.5deg]" : i === 2 ? "lg:rotate-[0.5deg]" : ""
              }`}
            >
              <span className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-brand text-white shadow-md shadow-blue-600/25">
                <f.icon className="h-5 w-5" aria-hidden />
              </span>
              <h3 className="text-lg font-bold text-balance">{f.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed font-medium text-ink">{f.body}</p>
              <p className="mt-2 text-sm leading-relaxed text-muted">{f.detail}</p>
              <span
                aria-hidden
                className="mt-auto pt-4 text-xs font-bold tracking-widest text-brand uppercase"
              >
                0{i + 1} — Featured
              </span>
            </article>
          ))}
        </div>

        {/* Secondary grid */}
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {SECONDARY.map((f) => (
            <article
              key={f.title}
              className="card card-calm group h-full p-5"
            >
              <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-brand-light text-brand transition group-hover:bg-brand group-hover:text-white">
                <f.icon className="h-5 w-5" aria-hidden />
              </span>
              <h3 className="text-base font-bold">{f.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">{f.body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
