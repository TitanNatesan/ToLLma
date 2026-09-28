import { HeartHandshake, Scale, Star } from "lucide-react";
import { GithubIcon } from "./icons";
import { SectionHeading } from "./nav";
import { COMMUNITY_URL, GITHUB_URL, LICENSE_URL } from "@/lib/site";

export default function OpenSource() {
  return (
    <section
      id="open-source"
      aria-label="Open source"
      className="noise-overlay section scroll-mt-20 overflow-hidden bg-ink text-white"
    >
      {/* Glowing highlight layers */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="bg-grid-dark absolute inset-0 [mask-image:radial-gradient(56rem_30rem_at_50%_20%,black,transparent_75%)]" />
        <div className="animate-glow-drift absolute top-0 left-1/2 h-64 w-[36rem] max-w-[100vw] -translate-x-1/2 rounded-full bg-blue-600/25 blur-3xl" />
        <div className="absolute right-[10%] bottom-0 h-48 w-48 rounded-full bg-emerald-500/15 blur-3xl" />
      </div>

      <div className="container-x relative z-[2]">
        <SectionHeading
          eyebrow="Open source"
          tone="dark"
          title="Apache 2.0. Yours to run, fork, and shape."
          sub="No open-core tease, no seat licenses. The gateway, the UI, and the docs are all in the repo."
          motion={false}
        />

        {/* License + community cards share one grid: identical tracks,
            same widths/spacing. Featured license card leads via type/color
            (gradient border, gold tile, stronger title, gold CTA) — not size. */}
        <div className="grid gap-4 sm:grid-cols-3">
          <article className="gradient-border-dark h-full rounded-2xl p-5 shadow-[0_0_48px_-16px_rgba(37,99,235,0.55)] ring-1 ring-white/10">
            <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-gold to-amber-600 shadow">
              <Scale className="h-5 w-5 text-slate-950" aria-hidden />
            </span>
            <h3 className="text-lg font-extrabold tracking-tight text-white">
              Apache 2.0 — use it commercially, forever.
            </h3>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-300">
              Use ToLLma commercially, modify it, embed it. Patent grant
              included.{" "}
              <a href={LICENSE_URL} className="font-semibold text-blue-300 underline-offset-2 hover:underline">
                Read the license
              </a>
              .
            </p>
            <a
              href={GITHUB_URL}
              className="mt-4 inline-flex items-center gap-2 rounded-xl bg-gold px-4 py-2.5 text-sm font-bold text-slate-950 shadow transition hover:brightness-110"
            >
              <Star className="h-4 w-4" aria-hidden /> Star on GitHub
            </a>
          </article>
          <article className="h-full rounded-2xl bg-white/5 p-5 ring-1 ring-white/10">
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
          <article className="h-full rounded-2xl bg-white/5 p-5 ring-1 ring-white/10">
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
        </div>
        <div className="mt-8 text-center">
          <p className="mx-auto max-w-xl font-mono text-xs leading-relaxed text-slate-400 sm:text-sm">
            docker compose up -d
            <span className="text-slate-600">{"  "}# → gateway on :8000, UI on :3000</span>
          </p>
        </div>
      </div>
    </section>
  );
}
