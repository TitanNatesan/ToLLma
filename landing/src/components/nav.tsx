"use client";

import { motion } from "framer-motion";
import { Boxes, Menu, X } from "lucide-react";
import { useState } from "react";
import { GithubIcon } from "./icons";
import { DOCS_URL, GET_STARTED_URL, GITHUB_URL } from "@/lib/site";

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
    <header className="sticky top-0 z-50 border-b border-slate-200/80 bg-white/90 backdrop-blur">
      <nav
        aria-label="Primary"
        className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6"
      >
        <a href="#top" className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-white">
            <Boxes className="h-5 w-5" aria-hidden />
          </span>
          <span className="text-lg font-bold tracking-tight">
            ToLLma
            <span className="ml-2 hidden rounded-full bg-brand-light px-2 py-0.5 text-xs font-semibold whitespace-nowrap text-brand-dark sm:inline">
              Open Source AI Gateway
            </span>
          </span>
        </a>
        <div className="hidden items-center gap-6 text-sm font-medium text-slate-600 lg:flex">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href} className="transition hover:text-brand">
              {l.label}
            </a>
          ))}
        </div>
        <div className="hidden items-center gap-2 lg:flex">
          <a
            href={DOCS_URL}
            className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
          >
            Docs
          </a>
          <a
            href={GITHUB_URL}
            className="flex items-center gap-1.5 rounded-lg bg-ink px-3 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
          >
            <GithubIcon className="h-4 w-4" aria-hidden /> GitHub
          </a>
          <a
            href={GET_STARTED_URL}
            className="rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white transition hover:bg-brand-dark"
          >
            Get Started
          </a>
        </div>
        <button
          type="button"
          className="rounded-lg p-2 text-slate-700 hover:bg-slate-100 lg:hidden"
          aria-expanded={open}
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </nav>
      {open && (
        <div className="border-t border-slate-200 bg-white px-4 py-3 lg:hidden">
          <div className="flex flex-col gap-1">
            {LINKS.map((l) => (
              <a
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
              >
                {l.label}
              </a>
            ))}
            <div className="mt-2 flex gap-2">
              <a
                href={GITHUB_URL}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-ink px-3 py-2 text-sm font-semibold text-white"
              >
                <GithubIcon className="h-4 w-4" aria-hidden /> GitHub
              </a>
              <a
                href={GET_STARTED_URL}
                className="flex-1 rounded-lg bg-brand px-3 py-2 text-center text-sm font-semibold text-white"
              >
                Get Started
              </a>
            </div>
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
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.55, delay, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  sub,
  tone = "light",
}: {
  eyebrow: string;
  title: string;
  sub?: string;
  tone?: "light" | "dark";
}) {
  const dark = tone === "dark";
  return (
    <Reveal className="mx-auto mb-10 max-w-2xl text-center sm:mb-12">
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
    </Reveal>
  );
}
