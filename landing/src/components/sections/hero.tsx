"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import { Container } from "@/components/ui/layout";
import { Badge, CTA } from "@/components/ui/primitives";
import { IconArrowRight, IconCheck, IconGitHub } from "@/components/ui/icons";
import { useParallax } from "@/lib/animations";
import { BRAND, GET_STARTED_URL, GITHUB_URL } from "@/lib/site";
import HeroScene from "./hero-scene";

// Verified supporting points (site.ts facts, no invented claims).
const POINTS = [
  "Unified OpenAI-compatible API",
  "Multiple providers",
  "Usage & cost visibility",
];

// The headline is split so each word can rise independently. The h1 keeps
// the complete string in its accessible name.
const HEADLINE_WORDS = "One Gateway for All Your AI Models & Agents.".split(" ");
const ACCENT_START = HEADLINE_WORDS.indexOf("Models");

export default function Hero() {
  const blobRef = useParallax<HTMLDivElement>(0.11);
  const blobRef2 = useParallax<HTMLDivElement>(-0.07);
  const textRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<HTMLDivElement | null>(null);
  const cueRef = useRef<HTMLDivElement | null>(null);

  // Scroll parallax: the scene lifts and shrinks, the text lags behind and
  // fades, and the cue dissolves. Reverses exactly on scroll-up.
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const y = window.scrollY;
      const text = textRef.current;
      const scene = sceneRef.current;
      const cue = cueRef.current;
      if (!text || !scene || !cue) return;
      if (y < 4) {
        text.style.transform = "";
        text.style.opacity = "";
        scene.style.transform = "";
        cue.style.opacity = "";
        return;
      }
      const textShift = Math.min(y * 0.05, 36);
      text.style.transform = `translate3d(0, ${textShift.toFixed(2)}px, 0)`;
      text.style.opacity = String(Math.max(0, 1 - y / 760));
      const sceneShift = -Math.min(y * 0.11, 86);
      const sceneScale = 1 - Math.min(y / 900, 1) * 0.06;
      scene.style.transform = `translate3d(0, ${sceneShift.toFixed(2)}px, 0) scale(${sceneScale.toFixed(3)})`;
      cue.style.opacity = String(Math.max(0, 1 - y / 210));
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
    <section className="relative overflow-hidden bg-canvas">
      <div className="bg-grid pointer-events-none absolute inset-0" aria-hidden="true" />
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
        <div
          className="flex flex-col justify-center pb-8 pt-24 min-[900px]:pt-24"
          style={{ minHeight: "min(100svh, 900px)" }}
        >
          <div className="grid items-center gap-10 min-[900px]:grid-cols-[minmax(0,48fr)_minmax(0,52fr)] min-[900px]:gap-10 xl:gap-14">
            <div ref={textRef} className="min-w-0 max-w-xl">
              <div className="flex flex-col items-start gap-5">
                <div className="hero-badge">
                  <Badge tone="brand">Open source · {BRAND.license}</Badge>
                </div>

                <h1
                  aria-label={`${BRAND.headline}.`}
                  className="font-semibold tracking-tight text-balance text-ink"
                  style={{ fontSize: "var(--t-display)", lineHeight: 1.04 }}
                >
                  {HEADLINE_WORDS.map((word, i) => (
                    <span key={`${word}-${i}`} className="inline">
                      <span
                        className={`hero-word inline-block ${
                          i >= ACCENT_START ? "hero-gradient" : ""
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
                  className="hero-sub text-pretty text-muted"
                  style={{ fontSize: "var(--t-lead)", lineHeight: 1.6, maxWidth: "54ch" }}
                >
                  Connect every AI provider behind one OpenAI-compatible endpoint — manage API
                  access, monitor usage, control costs, and govern each request from a single place.
                </p>

                <div className="hero-cta flex flex-wrap items-center gap-3 pt-1">
                  <CTA href={GET_STARTED_URL} size="lg">
                    Get Started
                    <IconArrowRight size={18} />
                  </CTA>
                  <CTA href={GITHUB_URL} variant="secondary" size="lg">
                    <IconGitHub size={18} />
                    Explore GitHub
                  </CTA>
                </div>

                <ul className="hero-points grid w-full grid-cols-1 gap-x-5 gap-y-2.5 pt-1 sm:grid-cols-2">
                  {POINTS.map((point) => (
                    <li key={point} className="flex items-center gap-2 text-sm text-ink-soft">
                      <IconCheck size={16} className="shrink-0 text-brand" />
                      {point}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div ref={sceneRef} className="min-w-0">
              <HeroScene />
            </div>
          </div>

          <div ref={cueRef} className="hero-cue-wrap mt-7 flex justify-center">
            <span className="flex flex-col items-center gap-2 text-[0.68rem] font-medium uppercase tracking-[0.16em] text-faint">
              Scroll to explore
              <span className="hero-cue flex h-8 w-5 items-start justify-center rounded-full border border-line-strong pt-1">
                <span className="h-1.5 w-1 rounded-full bg-brand" />
              </span>
            </span>
          </div>
        </div>
      </Container>
    </section>
  );
}
