import { HeartHandshake, Scale } from "lucide-react";
import { GithubIcon } from "./icons";
import { SectionHeading, Reveal } from "./nav";
import { COMMUNITY_URL, GITHUB_URL, LICENSE_URL } from "@/lib/site";

export default function OpenSource() {
  return (
    <section id="open-source" className="scroll-mt-20 bg-ink py-16 text-white sm:py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHeading
          eyebrow="Open source"
          tone="dark"
          title="Apache 2.0. Yours to run, fork, and shape."
          sub="No open-core tease, no seat licenses. The gateway, the UI, and the docs are all in the repo."
        />
        <div className="grid gap-4 sm:grid-cols-3">
          <Reveal>
            <article className="h-full rounded-2xl bg-white/5 p-5 ring-1 ring-white/10">
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
          </Reveal>
          <Reveal delay={0.08}>
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
          </Reveal>
          <Reveal delay={0.16}>
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
          </Reveal>
        </div>
        <Reveal className="mt-8 text-center">
          <p className="mx-auto max-w-xl font-mono text-xs leading-relaxed text-slate-400 sm:text-sm">
            docker compose up -d
            <span className="text-slate-600">{"  "}# → gateway on :8000, UI on :3000</span>
          </p>
        </Reveal>
      </div>
    </section>
  );
}
