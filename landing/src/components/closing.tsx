import { ArrowRight, BookOpen, Boxes } from "lucide-react";
import { GithubIcon } from "./icons";
import { Reveal } from "./nav";
import {
  COMMUNITY_URL,
  DOCS_URL,
  GET_STARTED_URL,
  GITHUB_URL,
  IS_PLACEHOLDER_LINKS,
  LICENSE_URL,
  ROADMAP_URL,
} from "@/lib/site";

export function CTA() {
  return (
    <section className="bg-white py-16 sm:py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <Reveal>
          <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand via-blue-700 to-slate-900 px-6 py-12 text-center text-white sm:px-12 sm:py-16">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 bg-[radial-gradient(40rem_20rem_at_50%_120%,rgba(16,185,129,0.35),transparent)]"
            />
            <h2 className="relative text-2xl font-extrabold tracking-tight text-balance sm:text-4xl">
              Put one gateway in front of all your AI.
            </h2>
            <p className="relative mx-auto mt-3 max-w-xl text-sm text-blue-100 text-balance sm:text-base">
              Self-host ToLLma in minutes, connect your first provider, and stop
              rewiring your app for every new model.
            </p>
            <div className="relative mt-7 flex flex-col justify-center gap-3 sm:flex-row">
              <a
                href={GET_STARTED_URL}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-white px-6 py-3 text-sm font-bold text-brand-dark shadow-lg transition hover:bg-blue-50"
              >
                Get Started <ArrowRight className="h-4 w-4" aria-hidden />
              </a>
              <a
                href={DOCS_URL}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-white/10 px-6 py-3 text-sm font-bold text-white ring-1 ring-white/30 transition hover:bg-white/20"
              >
                <BookOpen className="h-4 w-4" aria-hidden /> Read the Docs
              </a>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

const FOOT_COLS: { title: string; links: { label: string; href: string }[] }[] = [
  {
    title: "Project",
    links: [
      { label: "GitHub", href: GITHUB_URL },
      { label: "License (Apache 2.0)", href: LICENSE_URL },
      { label: "Roadmap", href: ROADMAP_URL },
    ],
  },
  {
    title: "Resources",
    links: [
      { label: "Documentation", href: DOCS_URL },
      { label: "Quickstart", href: GET_STARTED_URL },
    ],
  },
  {
    title: "Community",
    links: [
      { label: "Discussions", href: COMMUNITY_URL },
      { label: "Issues", href: `${GITHUB_URL}/issues` },
    ],
  },
];

export function Footer() {
  return (
    <footer className="border-t border-slate-200 bg-slate-50">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <div className="grid gap-8 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <p className="flex items-center gap-2 text-lg font-bold">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-white">
                <Boxes className="h-5 w-5" aria-hidden />
              </span>
              ToLLma
            </p>
            <p className="mt-2 max-w-xs text-sm text-muted">
              The Open Source AI Gateway for Models and Agents.
            </p>
            <a
              href={GITHUB_URL}
              className="mt-4 inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold transition hover:border-slate-400"
            >
              <GithubIcon className="h-4 w-4" aria-hidden /> Star on GitHub
            </a>
          </div>
          {FOOT_COLS.map((col) => (
            <nav key={col.title} aria-label={`Footer — ${col.title}`}>
              <p className="text-xs font-bold tracking-widest text-slate-500 uppercase">
                {col.title}
              </p>
              <ul className="mt-3 space-y-2">
                {col.links.map((l) => (
                  <li key={l.label}>
                    <a href={l.href} className="text-sm font-medium text-slate-700 transition hover:text-brand">
                      {l.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        <div className="mt-10 flex flex-col gap-2 border-t border-slate-200 pt-6 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
          <p>© 2026 ToLLma. Licensed under Apache 2.0.</p>
          {IS_PLACEHOLDER_LINKS && (
            <p>
              Link placeholder: outbound URLs point to{" "}
              <span className="font-mono">github.com/TOLLMA/tollma</span> until
              the public repo exists.
            </p>
          )}
        </div>
      </div>
    </footer>
  );
}
