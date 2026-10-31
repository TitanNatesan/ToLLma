"use client";

// ============================================================
// Get started: final CTA panel. The last beat of the page —
// one confident ask over an aurora background, with a floating
// gateway mark. Choreography: orb rises → headline words rise →
// buttons pop (≤1.8s). One-shot.
// ============================================================

import { Fragment, useLayoutEffect, useEffect, type RefObject } from "react";
import { Container, Section } from "@/components/ui/layout";
import { CTA as Button } from "@/components/ui/primitives";
import { IconGateway, IconGitHub, IconArrowRight } from "@/components/ui/icons";
import {
  animate,
  createTimeline,
  float,
  fadeUp,
  scaleReveal,
  useInViewOnce,
  useParallax,
  useReducedMotion,
  utils,
} from "@/lib/animations";
import { GITHUB_URL, GET_STARTED_URL } from "@/lib/site";

const HEADLINE = "Put One Gateway in Front of All Your AI.";

export function CTA() {
  const [rootRef, seen] = useInViewOnce<HTMLDivElement>(0.2);
  const bgRef = useParallax<HTMLDivElement>(0.04);
  const reduced = useReducedMotion();

  // Pre-hide only when JS is alive and motion is allowed — reduced-motion
  // and no-JS get the complete static panel.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || reduced) return;
    const rise = root.querySelectorAll(".cta-eyebrow, .cta-word, .cta-lead");
    const pop = root.querySelectorAll(".cta-pop");
    const orb = root.querySelectorAll(".cta-orb");
    if (rise.length) utils.set(rise, { opacity: 0, y: 18 });
    if (pop.length) utils.set(pop, { opacity: 0, scale: 0.96 });
    if (orb.length) utils.set(orb, { opacity: 0, scale: 0.9 });
    return () => {
      if (rise.length) utils.set(rise, { clear: "all" });
      if (pop.length) utils.set(pop, { clear: "all" });
      if (orb.length) utils.set(orb, { clear: "all" });
    };
  }, [reduced, rootRef]);

  // Convergence choreography — lines draw inward (staggered inOutQuad),
  // headline words rise, buttons pop last. One-shot, non-blocking.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !seen || reduced) return;
    const cleanups: Array<() => void> = [];

    // 1) orb + copy reveal, then buttons pop (scaleReveal) — ends ≈1.75s
    const tl = createTimeline({ defaults: { ease: "outExpo" } });
    tl.add(root.querySelectorAll(".cta-eyebrow"), fadeUp(14, 600), 400);
    root.querySelectorAll<HTMLElement>(".cta-word").forEach((el, i) => {
      tl.add(el, fadeUp(16, 600), 550 + i * 40);
    });
    tl.add(root.querySelectorAll(".cta-lead"), fadeUp(16, 600), 720);
    tl.add(root.querySelectorAll(".cta-pop"), scaleReveal(0.96, 600), 1150);
    tl.add(root.querySelectorAll(".cta-orb"), scaleReveal(0.9, 500), 260);
    cleanups.push(() => tl.revert());
    const orb = root.querySelector<HTMLElement>(".cta-orb");
    if (orb) {
      const bob = animate(orb, { ...float(6, 3200), delay: 760 });
      cleanups.push(() => bob.revert());
    }

    return () => {
      cleanups.forEach((fn) => fn());
    };
  }, [seen, reduced, rootRef]);

  return (
    <Section id="get-started">
      <Container width="wide">
        <div
          ref={rootRef as RefObject<HTMLDivElement>}
          className="relative overflow-hidden rounded-[var(--radius-xl)] border border-line bg-linear-to-br from-brand-soft via-surface to-teal-soft shadow-[var(--shadow-md)] ring-1 ring-brand/10"
        >
          {/* Background layer (grid + converging motif) — inset so the
              sub-2px parallax drift never exposes an edge. */}
          <div ref={bgRef} className="pointer-events-none absolute -inset-4" aria-hidden>
            {/* Aurora wash — brand/teal/violet, kept low-contrast. */}
            <div className="absolute -left-24 -top-32 h-96 w-96 rounded-full bg-brand/20 blur-3xl" />
            <div className="absolute -right-24 top-1/4 h-[26rem] w-[26rem] rounded-full bg-teal/20 blur-3xl" />
            <div className="absolute bottom-0 left-1/3 h-72 w-72 rounded-full bg-violet/10 blur-3xl" />
            <div className="bg-grid absolute inset-0 opacity-60" />
          </div>

          <div className="relative flex flex-col items-center gap-7 px-6 py-16 text-center sm:px-10 md:py-24">
            <div
              className="cta-orb relative grid size-16 place-items-center rounded-2xl border border-brand/25 bg-surface/80 text-brand shadow-[0_18px_40px_-18px_rgba(31,94,255,0.55)] backdrop-blur"
              aria-hidden="true"
            >
              <span className="absolute -inset-2 -z-10 rounded-3xl bg-brand/10 blur-lg" />
              <IconGateway size={28} />
            </div>
            <span className="cta-eyebrow eyebrow">
              Get started
            </span>
            <h2
              className="max-w-3xl font-semibold tracking-tight text-ink"
              style={{ fontSize: "var(--t-h2)", lineHeight: 1.1 }}
            >
              {HEADLINE.split(" ").map((word, i) => (
                <Fragment key={`${word}-${i}`}>
                  {i > 0 ? " " : null}
                  <span className={`cta-word inline-block ${i >= 6 ? "text-gradient-brand" : ""}`}>{word}</span>
                </Fragment>
              ))}
            </h2>
            <p
              className="cta-lead max-w-[54ch] text-muted"
              style={{ fontSize: "var(--t-lead)", lineHeight: 1.6 }}
            >
              Explore the code, follow the quickstart, and route your first request
              through ToLLma in minutes. Self-host it, own your keys, keep your data.
            </p>
            <div className="cta-pop flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
              <Button href={GET_STARTED_URL} size="lg" className="w-full sm:w-auto">
                Get Started
                <IconArrowRight size={18} />
              </Button>
              <Button href={GITHUB_URL} variant="secondary" size="lg" className="w-full sm:w-auto">
                <IconGitHub size={18} />
                View on GitHub
              </Button>
            </div>
          </div>
        </div>
      </Container>
    </Section>
  );
}
