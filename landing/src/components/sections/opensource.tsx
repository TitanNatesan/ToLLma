"use client";

import { useLayoutEffect, useEffect, type RefObject } from "react";
import Link from "next/link";
import { Container, Section, SectionHeading } from "@/components/ui/layout";
import { Badge, CTA } from "@/components/ui/primitives";
import {
  IconArrowRight,
  IconCheck,
  IconGitHub,
  IconOrg,
  IconTerminal,
} from "@/components/ui/icons";
import {
  animate,
  scaleReveal,
  useInViewOnce,
  useReducedMotion,
  useRevealOnScroll,
  utils,
} from "@/lib/animations";
import {
  COMMUNITY_URL,
  DOCS_URL,
  GITHUB_URL,
  LICENSE_URL,
  ROADMAP_URL,
} from "@/lib/site";

// ============================================================
// Open-source & community — a large Apache 2.0 statement with a
// license seal, resource links, and contribution CTAs. The
// self-hosted Compose stack lives in selfhosted.tsx and is not
// duplicated here. No fabricated stars/contributors/downloads.
// ============================================================

const LICENSE_POINTS = [
  "Permissive Apache 2.0 — use it commercially, modify it freely.",
  "Fork it, audit the source, and keep control of your deployment.",
  "The code you run is the code in the public repo — audit every line.",
];

// Inline license seal (typographic treatment sits beside it in HTML).
function LicenseSeal({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 96 96" className={className} role="img" aria-label="Apache 2.0 license seal">
      <circle cx="48" cy="48" r="45" fill="none" stroke="var(--color-brand-soft)" strokeWidth="4" />
      <circle
        cx="48"
        cy="48"
        r="40"
        fill="none"
        stroke="var(--color-brand)"
        strokeWidth="2"
        strokeDasharray="5 8"
        strokeLinecap="round"
      />
      <circle
        cx="48"
        cy="48"
        r="31"
        fill="var(--color-surface)"
        stroke="var(--color-line-strong)"
        strokeWidth="1.5"
      />
      {/* open padlock: yours to run, fork, and shape */}
      <g
        fill="none"
        stroke="var(--color-brand)"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="35" y="47" width="26" height="20" rx="5" />
        <path d="M55 47v-6a7 7 0 0 0-14 0" />
        <circle cx="48" cy="55.5" r="2.4" fill="var(--color-teal)" stroke="none" />
      </g>
    </svg>
  );
}

export default function OpenSource() {
  const revealRef = useRevealOnScroll();
  const [licenseRef, licensed] = useInViewOnce<HTMLDivElement>(0.25);
  const reduced = useReducedMotion();

  // Pre-hide the seal only when JS is alive and motion is allowed,
  // so reduced-motion and no-JS keep the complete static statement.
  useLayoutEffect(() => {
    if (reduced) return;
    const seal = licenseRef.current?.querySelector(".os-seal");
    if (seal) utils.set(seal, { opacity: 0, scale: 0.9, rotate: -12 });
    return () => {
      if (seal) utils.set(seal, { clear: "all" });
    };
  }, [reduced, licenseRef]);

  // License seal: one calm rotate/settle as the statement block scrolls in.
  useEffect(() => {
    const seal = licenseRef.current?.querySelector(".os-seal");
    if (!seal || !licensed || reduced) return;
    const a = animate(seal, { ...scaleReveal(0.9, 700), rotate: [-12, 0] });
    return () => {
      a.revert();
    };
  }, [licensed, reduced, licenseRef]);

  return (
    <Section id="open-source" tone="surface">
      <Container width="wide">
        <div ref={revealRef as RefObject<HTMLDivElement | null>}>
          <SectionHeading
            eyebrow="Open source and community"
            title="Open source at the core"
            lead="ToLLma is open source under Apache 2.0 — yours to run, fork, and shape. Star the repo, join the discussion, and help steer the roadmap."
          />

          {/* --- Apache 2.0 statement block --- */}
          <div
            ref={licenseRef as RefObject<HTMLDivElement | null>}
            data-reveal
            className="bg-dots relative mt-12 rounded-3xl border border-line bg-surface p-6 sm:p-8 lg:p-12"
          >
            <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
              <div className="flex flex-col items-start gap-6">
                <div className="flex items-center gap-4 sm:gap-5">
                  <span className="os-seal block shrink-0">
                    <LicenseSeal className="h-16 w-16 sm:h-24 sm:w-24" />
                  </span>
                  <div className="min-w-0">
                    <p
                      className="font-semibold tracking-tight text-ink"
                      style={{ fontSize: "clamp(1.9rem, 7vw, 4.5rem)", lineHeight: 1.02 }}
                    >
                      Apache 2.0
                    </p>
                    <p className="mt-1 text-sm text-muted">Licensed and public on GitHub</p>
                  </div>
                </div>
                <p
                  className="text-ink-soft"
                  style={{ fontSize: "var(--t-lead)", lineHeight: 1.55, maxWidth: "34ch" }}
                >
                  Yours to run, fork, and shape. No open-core paywall, no proprietary
                  core — the gateway you deploy is the code in the repository.
                </p>
                <Link
                  href={LICENSE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group inline-flex items-center gap-1.5 text-sm font-medium text-brand hover:text-brand-strong"
                >
                  Read the license
                  <IconArrowRight
                    size={16}
                    className="transition-transform duration-200 group-hover:translate-x-0.5"
                  />
                </Link>
              </div>

              <ul className="flex flex-col gap-3.5">
                {LICENSE_POINTS.map((point) => (
                  <li key={point} className="flex items-start gap-3">
                    <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-ok-soft text-ok-ink">
                      <IconCheck size={14} />
                    </span>
                    <p className="text-[0.95rem] leading-6 text-ink-soft">{point}</p>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* --- resources + contribution CTAs --- */}
          <div className="mt-14 grid gap-10 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
            <div data-reveal className="grid gap-3 sm:grid-cols-3">
              {[
                { href: GITHUB_URL, icon: IconGitHub, title: "GitHub repository", body: "Source code, issues, and releases." },
                { href: COMMUNITY_URL, icon: IconOrg, title: "Discussions", body: "Questions, ideas, and show-and-tell." },
                { href: DOCS_URL, icon: IconTerminal, title: "Documentation", body: "Setup guides and the quickstart." },
              ].map(({ href, icon: Icon, title, body }) => (
                <Link
                  key={title}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex min-w-0 flex-col gap-1.5 rounded-2xl border border-line bg-surface p-5 transition-[transform,box-shadow,border-color] duration-[var(--dur-fast)] hover:-translate-y-0.5 hover:border-brand hover:shadow-[var(--shadow-sm)]"
                >
                  <Icon size={20} className="text-brand" />
                  <p className="mt-1 text-sm font-semibold text-ink">{title}</p>
                  <p className="text-[0.82rem] leading-5 text-muted">{body}</p>
                </Link>
              ))}
            </div>

            <div data-reveal className="flex max-w-md flex-col items-start gap-4">
              <p className="text-sm font-medium text-ink-soft">
                Get involved — star the repo, open an issue, or start a discussion.
              </p>
              <div className="flex flex-wrap gap-3">
                <CTA href={GITHUB_URL} variant="primary">
                  <IconGitHub size={18} />
                  Star on GitHub
                </CTA>
                <CTA href={COMMUNITY_URL} variant="secondary">
                  Join the community
                </CTA>
              </div>
              <Badge tone="brand">
                <Link
                  href={ROADMAP_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 hover:text-brand"
                >
                  See the public roadmap
                  <IconArrowRight size={12} />
                </Link>
              </Badge>
            </div>
          </div>
        </div>
      </Container>
    </Section>
  );
}
