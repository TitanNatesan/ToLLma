"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { Container } from "@/components/ui/layout";
import { IconChat, IconGitHub } from "@/components/ui/icons";
import { useRevealOnScroll } from "@/lib/animations";
import { prefersReducedMotion } from "@/lib/animations/motion-preference";
import { COMMUNITY_URL, DOCS_URL, GET_STARTED_URL, GITHUB_URL, LICENSE_URL, ROADMAP_URL } from "@/lib/site";
import tollmaLight from "./brand/tollma-light-256.png";

// Cream footer (CrewAI-inspired composition on ToLLma cream): brand +
// Stay-connected community column, 6 nav columns (all hrefs verified
// site.ts links or in-page anchors), giant parallax wordmark, divider +
// bottom bar (dynamic year, Privacy/Terms as plain spans, GitHub +
// Discussions icons).
//
// Motion: link underlines sweep left → right; wordmark letters ride
// per-letter scroll parallax (transform-only, reversible, inert under
// reduced-motion); columns fade up in sequence; headings share one
// baseline (min-h-8).
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

// R11 wordmark rise: per-letter scroll-linked translate. Each letter has
// its own speed (outer letters travel fastest, inner slowest) so the word
// shears gently as it rises from below the footer edge. Measured off the
// untransformed clip parent (never self-measured), so every offset is a
// pure function of scroll position and exactly reversible. Transform-only,
// rAF-throttled, inert under prefers-reduced-motion (static full word).
const LETTERS = [
  { ch: "T", speed: -1.6 },
  { ch: "o", speed: -4.6 },
  { ch: "L", speed: -5.6 },
  { ch: "L", speed: -4.6 },
  { ch: "m", speed: -1.8 },
  { ch: "a", speed: -1.0 },
];

function useWordmarkRise(
  clipRef: React.RefObject<HTMLDivElement | null>,
  driftRef: React.RefObject<HTMLDivElement | null>
) {
  useEffect(() => {
    const clip = clipRef.current;
    const drift = driftRef.current;
    if (!clip || !drift || prefersReducedMotion()) return;
    const spans = Array.from(drift.querySelectorAll<HTMLElement>("[data-letter]"));
    if (!spans.length) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const rect = clip.getBoundingClientRect();
      const vh = window.innerHeight || 1;
      const progress = (vh - rect.top) / (vh + rect.height) - 0.5;
      // Settle: as the page reaches its very bottom, ease every offset
      // to exactly 0 so the wordmark sits straight at rest. Pure
      // function of scroll position — fully reversible on scroll-up.
      const max = document.documentElement.scrollHeight - vh;
      const remaining = Math.max(0, max - (window.scrollY || 0));
      const settle = Math.min(1, remaining / (vh * 0.6));
      for (const s of spans) {
        const sp = parseFloat(s.dataset.speed || "-1");
        if (settle <= 0) { s.style.transform = ""; continue; }
        s.style.transform = `translate3d(0, ${(progress * sp * 100 * settle).toFixed(2)}px, 0)`;
      }
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
      for (const s of spans) s.style.transform = "";
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
      <Container width="wide" className="pt-16 md:pt-20">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,2fr)_minmax(0,10fr)]">
          <div data-reveal className="flex flex-col items-start gap-3">
            {/* Brand block: logo spans the full column width, wordmark
                sits below it. Capped on small screens where the column
                itself goes full width. */}
            <div className="w-full max-w-56 lg:max-w-none">
            <Link href="#top" className="block w-full" aria-label="ToLLma home">
              <img
                src={tollmaLight.src}
                alt=""
                width={256}
                height={256}
                className="h-auto w-full"
              />
            </Link>
            <span className="block w-full text-justify text-3xl font-bold tracking-tight text-coal [text-align-last:justify] [text-justify:inter-character]">ToLLma</span>
            </div>
          </div>
          <nav className="grid grid-cols-2 gap-x-10 gap-y-12 min-[560px]:grid-cols-3 xl:grid-cols-6" aria-label="Footer">
            {COLS.map((c) => (
              <div key={c.title} data-reveal className="flex flex-col items-start gap-6">
                <p className="flex min-h-8 items-start text-xs font-semibold text-coal/50">{c.title}</p>
                <ul className="flex flex-col items-start gap-3">
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
        {/* Compact meta strip below the grid: description, license pill,
            and community links in one wrapping row so the tall brand
            column doesn't leave a void under the nav. No newsletter
            backend exists, so Stay connected links the real GitHub repo,
            discussions, and roadmap. */}
        <div data-reveal className="mt-12 flex flex-col gap-x-10 gap-y-4 lg:flex-row lg:items-center">
          <p className="max-w-md text-sm leading-relaxed text-coal/60">
            The open source AI gateway for models and agents. One unified
            interface to connect, route, govern, and observe your AI
            infrastructure.
          </p>
          <span className="foot-pill shrink-0">Apache 2.0 · Self-hosted</span>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 lg:ml-auto">
            <span className="text-xs font-semibold text-coal/50">Stay connected</span>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="foot-link inline-flex items-center gap-2 text-sm leading-relaxed text-coal/75"
            >
              <IconGitHub size={16} /> GitHub repository
            </a>
            <a
              href={COMMUNITY_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="foot-link inline-flex items-center gap-2 text-sm leading-relaxed text-coal/75"
            >
              <IconChat size={16} /> Community discussions
            </a>
            <a
              href={ROADMAP_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="foot-link text-sm leading-relaxed text-coal/75"
            >
              Roadmap
            </a>
          </div>
        </div>
        {/* R11 giant wordmark: full-bleed below the link columns, copyright
            bar after it. Each letter rides its own parallax speed (outer
            letters fastest) rising from below the footer edge as the footer
            scrolls in (fully reversible); the clip cuts it at the footer
            bottom. Decorative duplicate of the logo wordmark. */}
      </Container>
      <div data-reveal aria-hidden="true" ref={clipRef} className="foot-wordmark-clip">
        <div ref={driftRef} className="foot-wordmark-drift">
          <span className="foot-wordmark">
            {LETTERS.map((l, i) => (
              <span key={i} data-letter="" data-speed={l.speed} className="foot-letter">
                {l.ch}
              </span>
            ))}
          </span>
        </div>
      </div>
      <Container width="wide" className="pb-10 pt-4">
        <div data-reveal className="flex flex-col gap-3 border-t border-cream-line pt-6 text-sm text-coal/60 sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} ToLLma · Apache-2.0</p>
          {/* Privacy/Terms are plain text: no such pages exist, and fake
              links are worse than none. Only real destinations get icons:
              GitHub + Discussions (no LinkedIn/X/Discord exists). */}
          <p className="flex items-center gap-5">
            <span>Privacy</span>
            <span>Terms</span>
            <span className="flex items-center gap-3">
              <a
                href={GITHUB_URL}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="ToLLma on GitHub"
                className="text-coal/60 transition-colors duration-200 hover:text-coal"
              >
                <IconGitHub size={18} />
              </a>
              <a
                href={COMMUNITY_URL}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="ToLLma community discussions"
                className="text-coal/60 transition-colors duration-200 hover:text-coal"
              >
                <IconChat size={18} />
              </a>
            </span>
          </p>
        </div>
      </Container>
    </footer>
  );
}
