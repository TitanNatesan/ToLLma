import {
  ArrowDownUp,
  KeyRound,
  PiggyBank,
  Puzzle,
  Radar,
  X,
  Check,
} from "lucide-react";
import { SectionHeading } from "./nav";
import { FadeUp, ScaleIn } from "@/lib/motion";

const PAINS = [
  {
    icon: Puzzle,
    title: "A different SDK for every provider",
    body: "OpenAI, Anthropic, local models, custom agents — each with its own client, auth scheme, and quirks wired through your app.",
  },
  {
    icon: KeyRound,
    title: "API keys scattered everywhere",
    body: "Secrets pasted into apps, notebooks, and CI jobs. No single place to issue, rotate, or revoke access.",
  },
  {
    icon: PiggyBank,
    title: "No idea what AI actually costs",
    body: "Usage and spend are split across five dashboards. Budget overruns are discovered on the invoice, not before.",
  },
  {
    icon: Radar,
    title: "Blind when something breaks",
    body: "A failed call in production leaves no trace: no request log, no latency record, nothing to debug with.",
  },
  {
    icon: ArrowDownUp,
    title: "Switching models means rewriting code",
    body: "Trying a cheaper or local model touches application code instead of a config line, so teams stay locked in.",
  },
];

const FIXES = [
  "One OpenAI-compatible endpoint for every model and agent",
  "One key system — scoped, rotatable, revocable",
  "One dashboard for spend, budgets, and logs",
  "Switch providers in config, not in code",
];

export default function Problem() {
  return (
    <section
      id="problem"
      aria-label="The problem ToLLma solves"
      className="noise-overlay scroll-mt-20 bg-slate-50 py-16 sm:py-20"
    >
      <div
        aria-hidden
        className="bg-grid pointer-events-none absolute inset-0 opacity-60 [mask-image:radial-gradient(50rem_28rem_at_50%_0%,black,transparent_75%)]"
      />
      <div className="relative z-[2] mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHeading
          eyebrow="The problem"
          title="Every new model adds a new mess"
          sub="Teams stitch AI providers directly into their apps — and pay for it in keys, costs, and rewrites."
        />

        {/* Without / With comparison */}
        <div className="relative grid gap-6 lg:grid-cols-[1fr_auto_1fr] lg:items-stretch">
          {/* Without panel */}
          <FadeUp className="h-full">
            <article className="flex h-full flex-col rounded-2xl border border-red-200/70 bg-white p-5 shadow-sm sm:p-6">
              <p className="mb-4 inline-flex w-fit items-center gap-1.5 rounded-full bg-red-50 px-3 py-1 text-xs font-extrabold tracking-widest text-red-700 uppercase">
                <X className="h-3.5 w-3.5" aria-hidden /> Without ToLLma
              </p>
              <ul className="space-y-4">
                {PAINS.map((p) => (
                  <li key={p.title} className="flex gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-600">
                      <p.icon className="h-4.5 w-4.5" aria-hidden />
                    </span>
                    <span>
                      <span className="block text-sm font-bold">{p.title}</span>
                      <span className="mt-0.5 block text-sm leading-relaxed text-muted">
                        {p.body}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </article>
          </FadeUp>

          {/* Connector */}
          <div
            aria-hidden
            className="relative mx-auto flex w-12 items-center justify-center lg:w-16 lg:flex-col"
          >
            <span className="absolute h-px w-full bg-gradient-to-r from-red-300 via-brand to-emerald-400 lg:h-full lg:w-px lg:bg-gradient-to-b" />
            <span className="relative z-[1] flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-xs font-extrabold text-brand shadow-md">
              VS
            </span>
          </div>

          {/* With panel */}
          <ScaleIn className="h-full" delay={0.1}>
            <article className="gradient-border flex h-full flex-col justify-center rounded-2xl p-5 shadow-[0_24px_48px_-24px_rgba(37,99,235,0.4)] sm:p-6">
              <p className="mb-1 text-sm font-semibold tracking-wide text-gold uppercase">
                The fix
              </p>
              <h3 className="text-xl font-bold text-balance sm:text-2xl">
                ToLLma unifies everything behind one gateway.
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                One endpoint, one key system, one dashboard for spend, logs, and
                routing — for cloud models, local models, and agents alike.
              </p>
              <ul className="mt-5 space-y-2.5">
                {FIXES.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm font-medium">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-mint-light text-emerald-700">
                      <Check className="h-3 w-3" aria-hidden />
                    </span>
                    {f}
                  </li>
                ))}
              </ul>
              <a
                href="#features"
                className="mt-6 inline-flex w-fit items-center rounded-lg bg-brand px-4 py-2 text-sm font-bold text-white transition hover:bg-brand-dark"
              >
                See how it works
              </a>
            </article>
          </ScaleIn>
        </div>
      </div>
    </section>
  );
}
