"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { Container } from "@/components/ui/layout";
import { useRevealOnScroll } from "@/lib/animations";
import { prefersReducedMotion } from "@/lib/animations/motion-preference";
import { COMMUNITY_URL, DOCS_URL, GET_STARTED_URL, GITHUB_URL, LICENSE_URL, ROADMAP_URL } from "@/lib/site";
import tollmaLight from "./brand/tollma-light-256.png";

// Cream footer with top border: wordmark + 6 link columns (all hrefs are
// verified site.ts links or in-page anchors), bottom bar with
// © 2026 ToLLma, Apache-2.0, and Privacy/Terms as plain spans.
//
// Phase D motion: link underlines sweep left → right on hover; the wordmark
// does one small rotation per hover; columns fade up in sequence on entry
// with the bottom line last; headings share one baseline (min-h-8).
const COLS: { title: string; links: { label: string; href: string; external?: boolean }[] }[] = [
  {
    title: "Meet Our Gateway",
    links: [
      { label: "Route", href: "#platform" },
      { label: "Unify", href: "#platform" },
      { label: "Govern", href: "#platform" },
      { label: "Observe", href: "#platform" },
    ],
  },
  {
    title: "Solutions by Use Case",
    links: [
      { label: "Multi-provider routing", href: "#providers" },
      { label: "Guardrails", href: "#outcomes" },
      { label: "Request activity", href: "#activity" },
      { label: "Observability", href: "#knowledge" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "Platform", href: "#platform" },
      { label: "Documentation", href: DOCS_URL, external: true },
      { label: "GitHub", href: GITHUB_URL, external: true },
      { label: "License", href: LICENSE_URL, external: true },
    ],
  },
  {
    title: "Solutions by Provider",
    links: [
      { label: "OpenAI", href: "#providers" },
      { label: "Anthropic", href: "#providers" },
      { label: "Gemini", href: "#providers" },
      { label: "Bedrock", href: "#providers" },
    ],
  },
  {
    title: "Connect",
    links: [
      { label: "Documentation", href: DOCS_URL, external: true },
      { label: "Discussions", href: COMMUNITY_URL, external: true },
      { label: "Roadmap", href: ROADMAP_URL, external: true },
      { label: "Get Started", href: GET_STARTED_URL, external: true },
    ],
  },
  {
    title: "Knowledge Base",
    links: [
      { label: "Routing guide", href: "#knowledge" },
      { label: "Governance guide", href: "#knowledge" },
      { label: "Observability guide", href: "#knowledge" },
    ],
  },
];

// R11 wordmark rise: scroll-linked translate on the drift child, measured
// off the untransformed clip parent (never self-measured, so the offset is a
// pure function of scroll position and exactly reversible). Negative speed
// rises from below the footer edge as the footer scrolls in. Transform-only,
// rAF-throttled, inert under prefers-reduced-motion.
const WORDMARK_SPEED = -2.0;

function useWordmarkRise(
  clipRef: React.RefObject<HTMLDivElement | null>,
  driftRef: React.RefObject<HTMLDivElement | null>
) {
  useEffect(() => {
    const clip = clipRef.current;
    const drift = driftRef.current;
    if (!clip || !drift || prefersReducedMotion()) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const rect = clip.getBoundingClientRect();
      const vh = window.innerHeight || 1;
      const progress = (vh - rect.top) / (vh + rect.height) - 0.5;
      drift.style.transform = `translate3d(0, ${(progress * WORDMARK_SPEED * 100).toFixed(2)}px, 0)`;
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (raf) cancelAnimationFrame(raf);
      drift.style.transform = "";
    };
  }, [clipRef, driftRef]);
}

export function Footer() {
  const revealRef = useRevealOnScroll({ staggerMs: 90, y: 16 });
  const clipRef = useRef<HTMLDivElement | null>(null);
  const driftRef = useRef<HTMLDivElement | null>(null);
  useWordmarkRise(clipRef, driftRef);
  return (
    <footer id="company" ref={revealRef} className="scroll-mt-20 border-t border-cream-line bg-cream">
      <Container width="wide" className="py-14">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,2fr)_minmax(0,10fr)]">
          <div data-reveal className="flex flex-col items-start gap-3">
            <Link href="#top" className="foot-logo flex items-center gap-2" aria-label="ToLLma home">
              <img
                src={tollmaLight.src}
                alt=""
                width={28}
                height={28}
                className="size-7"
              />
              <span className="text-[1.1rem] font-semibold tracking-tight text-coal">ToLLma</span>
            </Link>
            <p className="max-w-xs text-sm leading-relaxed text-coal/60">
              The open source AI gateway for models and agents. Apache 2.0.
            </p>
            <span className="foot-pill">Apache 2.0 · Self-hosted</span>
          </div>
          <nav className="grid grid-cols-2 gap-8 min-[560px]:grid-cols-3 xl:grid-cols-6" aria-label="Footer">
            {COLS.map((c) => (
              <div key={c.title} data-reveal className="flex flex-col items-start gap-4">
                <p className="flex min-h-8 items-start text-xs font-semibold text-coal/50">{c.title}</p>
                <ul className="flex flex-col items-start gap-2.5">
                  {c.links.map((l) =>
                    l.external ? (
                      <li key={l.label}>
                        <a
                          href={l.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="foot-link text-sm leading-relaxed text-coal/75"
                        >
                          {l.label}
                        </a>
                      </li>
                    ) : (
                      <li key={l.label}>
                        <Link
                          href={l.href}
                          className="foot-link text-sm leading-relaxed text-coal/75"
                        >
                          {l.label}
                        </Link>
                      </li>
                    )
                  )}
                </ul>
              </div>
            ))}
          </nav>
        </div>
        {/* R11 giant wordmark: link columns above, copyright bar below.
            Negative parallax speed rises from below the footer edge as the
            footer scrolls in (fully reversible); the clip cuts it at the
            footer bottom. Decorative duplicate of the logo wordmark. */}
        <div data-reveal aria-hidden="true" ref={clipRef} className="foot-wordmark-clip">
          <div ref={driftRef} className="foot-wordmark-drift">
            <span className="foot-wordmark">ToLLma</span>
          </div>
        </div>
        <div data-reveal className="mt-12 flex flex-col gap-3 border-t border-cream-line pt-6 text-sm text-coal/60 sm:flex-row sm:items-center sm:justify-between">
          <p>© 2026 ToLLma · Apache-2.0</p>
          <p className="flex gap-5">
            <span>Privacy</span>
            <span>Terms</span>
          </p>
        </div>
      </Container>
    </footer>
  );
}
