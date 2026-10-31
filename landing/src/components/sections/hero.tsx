"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import { Container, Section } from "@/components/ui/layout";
import { Badge, CTA } from "@/components/ui/primitives";
import { IconArrowRight, IconCheck, IconGitHub } from "@/components/ui/icons";
import { useParallax } from "@/lib/animations";
import { BRAND, GET_STARTED_URL, GITHUB_URL } from "@/lib/site";
import HeroGateway from "./hero-gateway";

// Verified supporting points (site.ts facts, no invented claims).
const POINTS = [
  "Unified OpenAI-compatible API",
  "Multiple providers",
  "Usage & cost visibility",
];

// Headline split so words can rise individually; the provider phrase gets
// the gradient treatment. The h1 keeps the full string for assistive tech.
const HEADLINE_WORDS = "One Gateway for All Your AI Models & Agents.".split(" ");
const ACCENT_START = HEADLINE_WORDS.indexOf("Models");

export default function Hero() {
  const blobRef = useParallax<HTMLDivElement>(0.12);
  const blobRef2 = useParallax<HTMLDivElement>(-0.08);
  const cueRef = useRef<HTMLDivElement | null>(null);

  // Scroll cue dissolves once the hero starts leaving (transform/opacity only).
  useEffect(() => {
    let raf = 0;
    const update = () => {
      raf = 0;
      if (cueRef.current) {
        cueRef.current.style.opacity = String(Math.max(0, 1 - window.scrollY / 260));
      }
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <Section tone="canvas" className="overflow-hidden">
      <div className="bg-grid pointer-events-none absolute inset-0" aria-hidden="true" />
      {/* Soft depth blobs — background parallax layers, decorative only. */}
      <div
        ref={blobRef}
        aria-hidden="true"
        className="pointer-events-none absolute -left-48 -top-24 h-[34rem] w-[34rem] rounded-full bg-brand/10 blur-3xl"
      />
      <div
        ref={blobRef2}
        aria-hidden="true"
        className="pointer-events-none absolute -right-40 top-24 h-[30rem] w-[30rem] rounded-full bg-teal/10 blur-3xl"
      />
      <Container width="wide" className="relative">
        <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-16 xl:gap-20">
          {/* The hero text is deliberately never hidden by JS: it is the
              LCP region, and hiding painted text delays Largest Contentful
              Paint. The word entrance is CSS-only. */}
          <div className="flex max-w-xl flex-col items-start gap-5">
            <div>
              <Badge tone="brand">Open source · {BRAND.license}</Badge>
            </div>

            <h1
              aria-label={`${BRAND.headline}.`}
              className="font-semibold tracking-tight text-balance text-ink"
              style={{ fontSize: "var(--t-display)", lineHeight: 1.06 }}
            >
              {HEADLINE_WORDS.map((word, i) => (
                <span key={`${word}-${i}`} className="inline">
                  <span
                    className={`hero-word inline-block ${
                      i >= ACCENT_START ? "text-gradient-brand" : ""
                    }`}
                    style={{ "--wi": i } as CSSProperties}
                  >
                    {word}
                  </span>
                  {i < HEADLINE_WORDS.length - 1 ? " " : null}
                </span>
              ))}
            </h1>

            <p
              className="text-pretty text-muted"
              style={{ fontSize: "var(--t-lead)", lineHeight: 1.6, maxWidth: "54ch" }}
            >
              Connect every AI provider behind one OpenAI-compatible endpoint — manage API access,
              monitor usage, control costs, and govern each request from a single place.
            </p>

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <CTA href={GET_STARTED_URL} size="lg">
                Get Started
                <IconArrowRight size={18} />
              </CTA>
              <CTA href={GITHUB_URL} variant="secondary" size="lg">
                <IconGitHub size={18} />
                Explore GitHub
              </CTA>
            </div>

            <ul className="flex flex-wrap gap-x-6 gap-y-2.5 pt-1">
              {POINTS.map((point) => (
                <li key={point} className="flex items-center gap-2 text-sm text-ink-soft">
                  <IconCheck size={16} className="shrink-0 text-brand" />
                  {point}
                </li>
              ))}
            </ul>
          </div>

          <HeroGateway />
        </div>

        {/* Scroll cue — fades out as soon as the page moves. */}
        <div
          ref={cueRef}
          aria-hidden="true"
          className="pointer-events-none mt-12 hidden justify-center lg:flex"
        >
          <span className="flex flex-col items-center gap-2 text-[0.7rem] font-medium uppercase tracking-[0.16em] text-faint">
            Scroll to explore
            <span className="hero-cue flex h-8 w-5 items-start justify-center rounded-full border border-line-strong pt-1">
              <span className="h-1.5 w-1 rounded-full bg-brand" />
            </span>
          </span>
        </div>
      </Container>
    </Section>
  );
}
