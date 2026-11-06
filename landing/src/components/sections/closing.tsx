"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Container } from "@/components/ui/layout";
import { IconChat, IconGitHub } from "@/components/ui/icons";
import StickerPeel from "@/components/ui/sticker-peel";
import GradientASCII from "@/components/ui/gradient-ascii";
import { useReducedMotion, useRevealOnScroll } from "@/lib/animations";
import { prefersReducedMotion } from "@/lib/animations/motion-preference";
import { COMMUNITY_URL, DOCS_URL, GET_STARTED_URL, GITHUB_URL, LICENSE_URL, ROADMAP_URL } from "@/lib/site";
import tollmaLight from "./brand/tollma-light-256.png";

// Cream footer (CrewAI-inspired composition on ToLLma cream): brand +
// Stay-connected community strip, 6 nav columns (all hrefs verified
// site.ts links or in-page anchors), giant Jersey 10 wordmark
// (static pixel face, per-letter scroll parallax),
// divider + bottom bar (dynamic year, Privacy/Terms as plain spans,
// GitHub + Discussions icons).
//
// Motion: link underlines sweep left → right; wordmark letters shear
// on scroll (per-letter speeds, rAF, inert under reduced-motion);
// columns fade
// up in sequence; headings share one baseline (min-h-8).
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

// Per-letter scroll parallax (from 76b8e1e): T rides fastest, a
// slowest, so the word shears gently while the footer scrolls through —
// fully reversible. Uses the independent `translate` property on static
// spans, so nothing fights over styles. Measured off .foot-pressure
// (never self-measured). Static when reduced-motion is preferred.
const LETTER_SPEEDS = [-3, -1.5, -2, -0.1, -1, -0.2];
function useWordmarkParallax() {
  useEffect(() => {
    const word = document.querySelector<HTMLElement>("#company .foot-wordmark");
    if (!word || prefersReducedMotion()) return;
    const spans = Array.from(word.querySelectorAll<HTMLElement>("span"));
    if (!spans.length) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const block = word.parentElement;
      if (!block) return;
      const rect = block.getBoundingClientRect();
      const vh = window.innerHeight || 1;
      const progress = (vh - rect.top) / (vh + rect.height) - 0.5;
      // Anchor to the end state (footer can't scroll past page bottom,
      // so the word would otherwise rest sheared). Zero at max scroll,
      // alive mid-passage, still a pure function of scroll position.
      const docH = document.documentElement.scrollHeight;
      const maxScroll = Math.max(1, docH - vh);
      const rectTopAtEnd = rect.top + window.scrollY - maxScroll;
      const endP = (vh - rectTopAtEnd) / (vh + rect.height) - 0.5;
      const p = progress - endP;
      spans.forEach((s, i) => {
        const sp = LETTER_SPEEDS[i % LETTER_SPEEDS.length];
        s.style.translate = `0 ${(p * sp * 100).toFixed(2)}px`;
      });
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
      for (const s of spans) s.style.translate = "";
    };
  }, []);
}

// R11 wordmark rise: per-letter scroll-linked translate. Each letter has
// its own speed (outer letters travel fastest, inner slowest) so the word
// shears gently as it rises from below the footer edge. Measured off the
// untransformed clip parent (never self-measured), so every offset is a
// pure function of scroll position and exactly reversible. Transform-only,
// rAF-throttled, inert under prefers-reduced-motion (static full word).
export function Footer() {
  const revealRef = useRevealOnScroll({ staggerMs: 90, y: 16 });
  useWordmarkParallax();
  // Static blended mark for reduced-motion (no WebGL sticker).
  const reduced = useReducedMotion();
  // Static mark when WebGL2 is unavailable (sticker needs it to draw).
  const [noGL, setNoGL] = useState(false);
  useEffect(() => {
    try {
      if (!document.createElement("canvas").getContext("webgl2")) setNoGL(true);
    } catch {
      setNoGL(true);
    }
  }, []);
  return (
    <footer id="company" ref={revealRef} className="relative scroll-mt-20 overflow-clip rounded-t-[40px] bg-cream md:rounded-t-[64px]">
      {/* Ambient ASCII wash behind the whole footer: cream/sand glyph
          field drifting behind the footer content (lightMode on).
          Decorative only (aria-hidden, pointer-transparent); content
          paints above. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-[0.40]">
        <GradientASCII
          colors={["#d8d0b8", "#e6e0cd", "#bfb59c", "#9d937a"]}
          shape="rise"
          characters=" =+xX0S8#@"
          cellSize={20}
          density={0.65}
          glyphOpacity={0.8}
          gradientOpacity={0.6}
          scale={3.6}
          glow={0.1}
          flicker={0.1}
          speed={0.6}
          flow={0.4}
          grain={0.05}
          mouseInteraction={true}
          clickEffect="wave"
          intro={true}
          lightMode={true}
        />
      </div>
      <Container width="wide" className="relative pt-10 md:pt-12">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,2fr)_minmax(0,10fr)]">
          <div data-reveal className="flex flex-col items-start gap-3">
            {/* Brand block: peelable logo sticker spans the full column
                width, wordmark sits below it as the home link. Capped
                on small screens where the column itself goes full width.
                Reduced-motion gets the static blended mark (no WebGL). */}
            <div className="w-full max-w-56 lg:max-w-none">
            {reduced || noGL ? (
              <img
                src={tollmaLight.src}
                alt="ToLLma"
                width={256}
                height={256}
                className="h-auto w-full"
              />
            ) : (
              <div className="relative aspect-square w-full" role="img" aria-label="ToLLma logo sticker — hover to peel">
                <StickerPeel
                  imageSrc={tollmaLight.src}
                  width={200}
                  finish="gloss"
                  draggable={false}
                  backColor="#ddd8cc"
                  peelBackHoverPct={25}
                  peelBackActivePct={40}
                />
              </div>
            )}
            <Link href="#top" aria-label="ToLLma home" className="block w-full">
              <span
                className="block w-full text-justify text-3xl tracking-tight text-coal [text-align-last:justify] [text-justify:inter-character]"
                style={{ fontFamily: '"Jersey 10", sans-serif', fontWeight: 400 }}
              >
                ToLLma
              </span>
            </Link>
            </div>
          </div>
          <nav className="grid grid-cols-2 gap-x-12 gap-y-12 min-[560px]:grid-cols-3 xl:grid-cols-6" aria-label="Footer">
            {COLS.map((c) => (
              <div key={c.title} data-reveal className="flex flex-col items-start gap-8">
                <p className="flex min-h-8 items-start text-xs font-semibold text-coal/50">{c.title}</p>
                <ul className="flex flex-col items-start gap-4">
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
        {/* Giant wordmark: plain Jersey 10 pixel face (no engine).
            Static per-letter spans ride the scroll parallax below;
            flex spreads the line edge to edge, clamp() sizes it, so it
            can never overflow by construction. Decorative duplicate of
            the logo wordmark (aria-hidden, the nav link names it). */}
      </Container>
      <div data-reveal className="foot-pressure relative">
        <div aria-hidden="true" className="foot-wordmark">
          {"tOllMA".split("").map((ch, i) => (
            <span key={i} data-letter="" className="foot-letter">
              {ch}
            </span>
          ))}
        </div>
      </div>
      <Container width="wide" className="relative pb-1 pt-0">
        <div data-reveal className="flex flex-col gap-2 border-t border-cream-line pt-2 text-sm text-coal/60 sm:flex-row sm:items-center sm:justify-between">
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
