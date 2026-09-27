import {
  ArrowDownUp,
  KeyRound,
  PiggyBank,
  Puzzle,
  Radar,
} from "lucide-react";
import { SectionHeading, Reveal } from "./nav";

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

export default function Problem() {
  return (
    <section id="problem" className="scroll-mt-20 bg-slate-50 py-16 sm:py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHeading
          eyebrow="The problem"
          title="Every new model adds a new mess"
          sub="Teams stitch AI providers directly into their apps — and pay for it in keys, costs, and rewrites."
        />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {PAINS.map((p, i) => (
            <Reveal key={p.title} delay={Math.min(i * 0.06, 0.24)}>
              <article className="h-full rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-red-50 text-red-600">
                  <p.icon className="h-5 w-5" aria-hidden />
                </span>
                <h3 className="text-base font-bold">{p.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted">{p.body}</p>
              </article>
            </Reveal>
          ))}
          <Reveal delay={0.24}>
            <article className="flex h-full flex-col justify-center rounded-2xl bg-ink p-5 text-white shadow-sm">
              <p className="text-sm font-semibold tracking-wide text-gold uppercase">
                The fix
              </p>
              <h3 className="mt-1 text-xl font-bold text-balance">
                ToLLma unifies everything behind one gateway.
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-300">
                One endpoint, one key system, one dashboard for spend, logs, and
                routing — for cloud models, local models, and agents alike.
              </p>
              <a
                href="#features"
                className="mt-4 inline-flex w-fit items-center rounded-lg bg-brand px-4 py-2 text-sm font-bold transition hover:bg-brand-dark"
              >
                See how it works
              </a>
            </article>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
