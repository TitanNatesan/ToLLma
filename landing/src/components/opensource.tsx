import { HeartHandshake, Scale, Star } from "lucide-react";
import { GithubIcon } from "./icons";
import { SectionHeading } from "./nav";
import { COMMUNITY_URL, GITHUB_URL, LICENSE_URL } from "@/lib/site";
import { FadeUp, ScaleIn } from "@/lib/motion";

export default function OpenSource() {
  return (
    <section
      id="open-source"
      aria-label="Open source"
      className="noise-overlay scroll-mt-20 bg-ink py-16 text-white sm:py-20"
    >
      {/* Glowing highlight layers */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="bg-grid-dark absolute inset-0 [mask-image:radial-gradient(56rem_30rem_at_50%_20%,black,transparent_75%)]" />
        <div className="animate-glow-drift absolute top-0 left-1/2 h-64 w-[36rem] -translate-x-1/2 rounded-full bg-blue-600/25 blur-3xl" />
        <div className="absolute right-[10%] bottom-0 h-48 w-48 rounded-full bg-emerald-500/15 blur-3xl" />
      </div>

      <div className="relative z-[2] mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHeading
          eyebrow="Open source"
          tone="dark"
          title="Apache 2.0. Yours to run, fork, and shape."
          sub="No open-core tease, no seat licenses. The gateway, the UI, and the docs are all in the repo."
        />

        {/* Large license badge + star CTA */}
        <ScaleIn className="mx-auto mb-6 max-w-3xl">
          <div className="gradient-border-dark flex flex-col items-center gap-4 rounded-2xl px-6 py-7 text-center shadow-[0_0_64px_-16px_rgba(37,99,235,0.6)] sm:flex-row sm:gap-6 sm:text-left">
            <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-gold to-amber-600 shadow-lg">
              <Scale className="h-8 w-8 text-slate-950" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xl font-extrabold tracking-tight sm:text-2xl">
                Apache 2.0 — use it commercially, forever.
              </p>
              <p className="mt-1 text-sm leading-relaxed text-slate-300">
                Patent grant included.{" "}
                <a href={LICENSE_URL} className="font-semibold text-blue-300 underline-offset-2 hover:underline">
                  Read the license
                </a>
                .
              </p>
            </div>
            <a
              href={GITHUB_URL}
              className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-gold px-5 py-3 text-sm font-bold text-slate-950 shadow-lg transition hover:brightness-110"
            >
              <Star className="h-4 w-4" aria-hidden /> Star on GitHub
            </a>
          </div>
        </ScaleIn>

        <div className="grid gap-4 sm:grid-cols-3">
          <FadeUp>
            <article className="h-full rounded-2xl bg-white/5 p-5 ring-1 ring-white/10 transition hover:bg-white/[0.07] hover:ring-white/20">
              <Scale className="mb-3 h-6 w-6 text-gold" aria-hidden />
              <h3 className="font-bold">Apache 2.0 licensed</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-300">
                Use ToLLma commercially, modify it, embed it. Patent grant
                included.{" "}
                <a href={LICENSE_URL} className="font-semibold text-blue-300 underline-offset-2 hover:underline">
                  Read the license
                </a>
                .
              </p>
            </article>
          </FadeUp>
          <FadeUp delay={0.08}>
            <article className="h-full rounded-2xl bg-white/5 p-5 ring-1 ring-white/10 transition hover:bg-white/[0.07] hover:ring-white/20">
              <GithubIcon className="mb-3 h-6 w-6 text-blue-300" aria-hidden />
              <h3 className="font-bold">Built in the open</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-300">
                Roadmap, issues, and decisions happen on GitHub where everyone
                can follow along.{" "}
                <a href={GITHUB_URL} className="font-semibold text-blue-300 underline-offset-2 hover:underline">
                  Browse the repo
                </a>
                .
              </p>
            </article>
          </FadeUp>
          <FadeUp delay={0.16}>
            <article className="h-full rounded-2xl bg-white/5 p-5 ring-1 ring-white/10 transition hover:bg-white/[0.07] hover:ring-white/20">
              <HeartHandshake className="mb-3 h-6 w-6 text-mint" aria-hidden />
              <h3 className="font-bold">Community first</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-300">
                Good-first-issues, discussion forums, and a roadmap voted on by
                the people who deploy it.{" "}
                <a href={COMMUNITY_URL} className="font-semibold text-blue-300 underline-offset-2 hover:underline">
                  Join the discussion
                </a>
                .
              </p>
            </article>
          </FadeUp>
        </div>
        <FadeUp className="mt-8 text-center">
          <p className="mx-auto max-w-xl font-mono text-xs leading-relaxed text-slate-400 sm:text-sm">
            docker compose up -d
            <span className="text-slate-600">{"  "}# → gateway on :8000, UI on :3000</span>
          </p>
        </FadeUp>
      </div>
    </section>
  );
}
