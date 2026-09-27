"use client";

import { Boxes, Menu, X } from "lucide-react";
import { useState } from "react";
import { GithubIcon } from "./icons";
import { DOCS_URL, GET_STARTED_URL, GITHUB_URL } from "@/lib/site";
import { FadeUp } from "@/lib/motion";

const LINKS = [
  { label: "Problem", href: "#problem" },
  { label: "Features", href: "#features" },
  { label: "Architecture", href: "#architecture" },
  { label: "Screenshots", href: "#screenshots" },
  { label: "Why ToLLma", href: "#why" },
  { label: "Roadmap", href: "#roadmap" },
  { label: "Open Source", href: "#open-source" },
];

export default function Nav() {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-50 border-b border-slate-200/70 bg-white/80 shadow-[0_8px_24px_-16px_rgba(15,23,42,0.25)] backdrop-blur-xl backdrop-saturate-150 supports-[backdrop-filter]:bg-white/70">
      <nav
        aria-label="Primary"
        className="container-x flex h-16 items-center justify-between gap-4"
      >
        <a
          href="#top"
          className="flex min-h-[44px] items-center gap-2 rounded-lg focus-visible:outline-2"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-white">
            <Boxes className="h-5 w-5" aria-hidden />
          </span>
          <span className="text-lg font-bold tracking-tight">
            ToLLma
            <span className="ml-2 hidden rounded-full bg-brand-light px-2 py-0.5 text-xs font-semibold whitespace-nowrap text-brand-dark sm:inline xl:hidden">
              Open Source AI Gateway
            </span>
          </span>
        </a>
        {/* Section links fit the shared container only at xl+: compact type,
            no wrap, 44px touch targets. Below xl the hamburger menu serves. */}
        <div className="hidden items-center gap-1 text-[13px] font-medium text-slate-600 xl:flex">
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="inline-flex min-h-[44px] items-center rounded-lg px-2 whitespace-nowrap transition hover:text-brand"
            >
              {l.label}
            </a>
          ))}
        </div>
        <div className="hidden items-center gap-2 xl:flex">
          <a
            href={DOCS_URL}
            className="inline-flex min-h-[44px] items-center rounded-lg px-3 text-sm font-semibold whitespace-nowrap text-slate-700 transition hover:bg-slate-100"
          >
            Docs
          </a>
          <a
            href={GITHUB_URL}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-ink px-3 text-sm font-semibold whitespace-nowrap text-white transition hover:bg-slate-800"
          >
            <GithubIcon className="h-4 w-4" aria-hidden /> GitHub
          </a>
          <a
            href={GET_STARTED_URL}
            className="inline-flex min-h-[44px] items-center rounded-lg bg-brand px-4 text-sm font-bold whitespace-nowrap text-white shadow-md shadow-blue-600/25 transition hover:bg-brand-dark"
          >
            Get Started
          </a>
        </div>
        <button
          type="button"
          className="rounded-lg p-2.5 text-slate-700 hover:bg-slate-100 xl:hidden"
          aria-expanded={open}
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </nav>
      {open && (
        <div className="border-t border-slate-200 bg-white px-4 py-3 xl:hidden">
          <div className="flex flex-col gap-1">
            {LINKS.map((l) => (
              <a
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="flex min-h-[44px] items-center rounded-lg px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
              >
                {l.label}
              </a>
            ))}
            <div className="mt-2 flex gap-2">
              <a
                href={GITHUB_URL}
                className="flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-lg bg-ink px-3 text-sm font-semibold text-white"
              >
                <GithubIcon className="h-4 w-4" aria-hidden /> GitHub
              </a>
              <a
                href={GET_STARTED_URL}
                className="flex min-h-[44px] flex-1 items-center justify-center rounded-lg bg-brand px-3 text-center text-sm font-semibold text-white"
              >
                Get Started
              </a>
            </div>
            <a
              href={DOCS_URL}
              className="flex min-h-[44px] items-center justify-center rounded-lg border border-slate-300 px-3 text-sm font-semibold text-slate-700"
            >
              Docs
            </a>
          </div>
        </div>
      )}
    </header>
  );
}

export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <FadeUp className={className} delay={delay}>
      {children}
    </FadeUp>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  sub,
  tone = "light",
  motion = true,
}: {
  eyebrow: string;
  title: string;
  sub?: string;
  tone?: "light" | "dark";
  /** False in calm sections (motion restraint: entrances only in
      hero / architecture / roadmap / screenshots / CTA). */
  motion?: boolean;
}) {
  const dark = tone === "dark";
  const inner = (
    <>
      <p
        className={`mb-2 text-xs font-bold tracking-widest uppercase ${
          dark ? "text-blue-300" : "text-brand"
        }`}
      >
        {eyebrow}
      </p>
      <h2
        className={`text-2xl font-bold tracking-tight text-balance sm:text-3xl ${
          dark ? "text-white" : ""
        }`}
      >
        {title}
      </h2>
      {sub && (
        <p
          className={`mt-3 text-base text-balance ${
            dark ? "text-slate-300" : "text-muted"
          }`}
        >
          {sub}
        </p>
      )}
    </>
  );
  const cls = "mx-auto mb-10 max-w-2xl text-center sm:mb-12";
  if (!motion) return <div className={cls}>{inner}</div>;
  return <FadeUp className={cls}>{inner}</FadeUp>;
}
