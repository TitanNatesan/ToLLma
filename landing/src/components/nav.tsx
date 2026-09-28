"use client";

import { Menu, X } from "lucide-react";
import { useEffect, useState } from "react";
import { GithubIcon } from "./icons";
import { DOCS_URL, GET_STARTED_URL, GITHUB_URL } from "@/lib/site";
import { FadeUp } from "@/lib/motion";

/* Grouped section links: product story first, project second.
   Flat anchors (no dropdown) — 7 destinations stay one click away,
   the hairline divider signals the grouping. */
const PRODUCT_LINKS = [
  { label: "Problem", href: "#problem" },
  { label: "Features", href: "#features" },
  { label: "Architecture", href: "#architecture" },
  { label: "Screenshots", href: "#screenshots" },
];

const PROJECT_LINKS = [
  { label: "Why ToLLma", href: "#why" },
  { label: "Roadmap", href: "#roadmap" },
  { label: "Open Source", href: "#open-source" },
];

const ALL_LINKS = [...PRODUCT_LINKS, ...PROJECT_LINKS];

function linkCls(active: boolean) {
  return active
    ? "bg-brand-light/70 text-brand-dark"
    : "text-slate-600 hover:bg-slate-100/70 hover:text-brand";
}

export default function Nav() {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const [scrolled, setScrolled] = useState(false);

  /* Active-section awareness: the link matching the section in view
     gets aria-current + highlight (desktop and mobile alike). */
  useEffect(() => {
    const sections = ALL_LINKS.map((l) => document.getElementById(l.href.slice(1))).filter(
      (el): el is HTMLElement => el !== null,
    );
    if (sections.length === 0) return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) setActive(`#${e.target.id}`);
        }
      },
      { rootMargin: "-35% 0px -60% 0px", threshold: 0 },
    );
    sections.forEach((s) => obs.observe(s));
    return () => obs.disconnect();
  }, []);

  /* Premium glass deepens once the page scrolls (class toggle only). */
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  /* Close the mobile menu on Escape, and when resizing up to xl where
     the inline links take over. */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const mq = window.matchMedia("(min-width: 1280px)");
    const onChange = (e: MediaQueryListEvent) => {
      if (e.matches) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    mq.addEventListener("change", onChange);
    return () => {
      document.removeEventListener("keydown", onKey);
      mq.removeEventListener("change", onChange);
    };
  }, [open ]);

  return (
    <header
      className={`sticky top-0 z-50 border-b backdrop-blur-xl backdrop-saturate-150 transition-colors ${
        scrolled
          ? "border-slate-200/80 bg-white/85 shadow-[0_16px_40px_-24px_rgba(15,23,42,0.35)] supports-[backdrop-filter]:bg-white/75"
          : "border-slate-200/60 bg-white/75 shadow-[0_8px_24px_-16px_rgba(15,23,42,0.25)] supports-[backdrop-filter]:bg-white/65"
      }`}
    >
      <nav
        aria-label="Primary"
        className="container-x flex h-16 items-center justify-between gap-4"
      >
        <a
          href="#top"
          className="flex min-h-[44px] items-center gap-2 rounded-lg focus-visible:outline-2"
        >
          <img
            src="/brand/logo-icon.svg"
            alt="ToLLma"
            width={32}
            height={32}
            className="h-8 w-8 shrink-0"
          />
          <span className="text-lg font-bold tracking-tight">
            ToLLma
            <span className="ml-2 hidden rounded-full bg-brand-light px-2 py-0.5 text-xs font-semibold whitespace-nowrap text-brand-dark sm:inline xl:hidden">
              Open Source AI Gateway
            </span>
          </span>
        </a>
        {/* Section links fit the shared container only at xl+: compact type,
            no wrap, 44px touch targets. Below xl the hamburger menu serves. */}
        <div className="hidden items-center text-[13px] font-medium xl:flex">
          <ul className="flex items-center gap-1" aria-label="Product">
            {PRODUCT_LINKS.map((l) => {
              const isActive = active === l.href;
              return (
                <li key={l.href}>
                  <a
                    href={l.href}
                    aria-current={isActive ? "true" : undefined}
                    className={`inline-flex min-h-[44px] items-center rounded-lg px-2 whitespace-nowrap transition-colors ${linkCls(isActive)}`}
                  >
                    {l.label}
                  </a>
                </li>
              );
            })}
          </ul>
          <span aria-hidden="true" className="mx-2 h-4 w-px shrink-0 bg-slate-200" />
          <ul className="flex items-center gap-1" aria-label="Project">
            {PROJECT_LINKS.map((l) => {
              const isActive = active === l.href;
              return (
                <li key={l.href}>
                  <a
                    href={l.href}
                    aria-current={isActive ? "true" : undefined}
                    className={`inline-flex min-h-[44px] items-center rounded-lg px-2 whitespace-nowrap transition-colors ${linkCls(isActive)}`}
                  >
                    {l.label}
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
        {/* CTA hierarchy: one dominant filled CTA (Get Started), GitHub as
            ghost, Docs as tertiary text. */}
        <div className="hidden items-center gap-2 xl:flex">
          <a
            href={DOCS_URL}
            className="inline-flex min-h-[44px] items-center rounded-lg px-3 text-sm font-medium whitespace-nowrap text-slate-500 transition-colors hover:bg-slate-100/70 hover:text-brand"
          >
            Docs
          </a>
          <a
            href={GITHUB_URL}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white/60 px-3 text-sm font-semibold whitespace-nowrap text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-100"
          >
            <GithubIcon className="h-4 w-4" aria-hidden /> GitHub
          </a>
          <a
            href={GET_STARTED_URL}
            className="inline-flex min-h-[44px] items-center rounded-[10px] bg-brand px-4 text-sm font-bold whitespace-nowrap text-white shadow-md shadow-blue-600/25 transition-colors hover:bg-brand-dark"
          >
            Get Started
          </a>
        </div>
        <button
          type="button"
          className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg p-2.5 text-slate-700 hover:bg-slate-100 xl:hidden"
          aria-expanded={open}
          aria-controls="primary-menu"
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </nav>
      {open && (
        <div
          id="primary-menu"
          className="border-t border-slate-200/70 bg-white/95 px-4 py-3 backdrop-blur-xl xl:hidden"
        >
          <div className="flex flex-col gap-1">
            <p className="px-3 pt-1 text-[11px] font-bold tracking-widest text-slate-400 uppercase">
              Product
            </p>
            {PRODUCT_LINKS.map((l) => {
              const isActive = active === l.href;
              return (
                <a
                  key={l.href}
                  href={l.href}
                  onClick={() => setOpen(false)}
                  aria-current={isActive ? "true" : undefined}
                  className={`flex min-h-[44px] items-center rounded-lg px-3 py-1.5 text-sm font-medium transition-colors hover:bg-slate-100 ${linkCls(isActive)}`}
                >
                  {l.label}
                </a>
              );
            })}
            <p className="px-3 pt-2 text-[11px] font-bold tracking-widest text-slate-400 uppercase">
              Project
            </p>
            {PROJECT_LINKS.map((l) => {
              const isActive = active === l.href;
              return (
                <a
                  key={l.href}
                  href={l.href}
                  onClick={() => setOpen(false)}
                  aria-current={isActive ? "true" : undefined}
                  className={`flex min-h-[44px] items-center rounded-lg px-3 py-1.5 text-sm font-medium transition-colors hover:bg-slate-100 ${linkCls(isActive)}`}
                >
                  {l.label}
                </a>
              );
            })}
            <div className="mt-2 flex gap-2">
              <a
                href={GITHUB_URL}
                className="flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100"
              >
                <GithubIcon className="h-4 w-4" aria-hidden /> GitHub
              </a>
              <a
                href={GET_STARTED_URL}
                className="flex min-h-[44px] flex-1 items-center justify-center rounded-[10px] bg-brand px-3 text-center text-sm font-semibold text-white shadow-md shadow-blue-600/25 transition-colors hover:bg-brand-dark"
              >
                Get Started
              </a>
            </div>
            <a
              href={DOCS_URL}
              className="flex min-h-[44px] items-center justify-center rounded-lg px-3 text-sm font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-brand"
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
