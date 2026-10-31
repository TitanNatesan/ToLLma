"use client";

// ============================================================
// Get started: final CTA panel. The last beat of the page —
// one confident ask. CTA choreography: converging lines draw
// toward the center node → headline words rise → buttons pop
// (copy + buttons land ≤1.8s) → one-shot node pulse with two
// packets arriving (decorative tail settles ~2.15s).
// ============================================================

import { Fragment, useLayoutEffect, useEffect, type RefObject } from "react";
import { Container, Section } from "@/components/ui/layout";
import { CTA as Button } from "@/components/ui/primitives";
import { IconGitHub, IconArrowRight } from "@/components/ui/icons";
import {
  animate,
  animatePackets,
  createTimeline,
  drawSvgPaths,
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
    const pkts = root.querySelectorAll(".cta-pkt");
    if (rise.length) utils.set(rise, { opacity: 0, y: 18 });
    if (pop.length) utils.set(pop, { opacity: 0, scale: 0.96 });
    if (pkts.length) utils.set(pkts, { opacity: 0 });
    return () => {
      if (rise.length) utils.set(rise, { clear: "all" });
      if (pop.length) utils.set(pop, { clear: "all" });
      if (pkts.length) utils.set(pkts, { clear: "all" });
    };
  }, [reduced, rootRef]);

  // Convergence choreography — lines draw inward (staggered inOutQuad),
  // headline words rise, buttons pop last. One-shot, non-blocking.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !seen || reduced) return;
    const cleanups: Array<() => void> = [];

    // 1) converging lines draw toward the center node
    cleanups.push(
      drawSvgPaths(root, ".cta-line", { duration: 550, staggerMs: 50 })
    );

    // 2) copy reveals (fadeUp), then buttons pop (scaleReveal) — ends ≈1.75s
    const tl = createTimeline({ defaults: { ease: "outExpo" } });
    tl.add(root.querySelectorAll(".cta-eyebrow"), fadeUp(14, 600), 400);
    root.querySelectorAll<HTMLElement>(".cta-word").forEach((el, i) => {
      tl.add(el, fadeUp(16, 600), 550 + i * 40);
    });
    tl.add(root.querySelectorAll(".cta-lead"), fadeUp(16, 600), 720);
    tl.add(root.querySelectorAll(".cta-pop"), scaleReveal(0.96, 600), 1150);
    cleanups.push(() => tl.revert());

    // 3) once converged: two packets arrive at the node, then a one-shot
    //    pulse. Both are one-shots (no loops), so nothing keeps running
    //    while the section is off-screen.
    const timer = window.setTimeout(() => {
      const paths = Array.from(
        root.querySelectorAll<SVGPathElement>(".cta-line")
      );
      const pkts = Array.from(
        root.querySelectorAll<SVGCircleElement>(".cta-pkt")
      );
      if (pkts.length) utils.set(pkts, { opacity: 1 });
      pkts.forEach((pkt, i) => {
        const path = paths[i === 0 ? 1 : paths.length - 2];
        if (path) {
          const flow = animatePackets(path, [pkt], { duration: 1100, loop: false });
          cleanups.push(() => flow.revert());
        }
      });
      const node = root.querySelector(".cta-node");
      const halo = root.querySelector(".cta-halo");
      if (node) {
        const nodeAnim = animate(node, {
          scale: [1, 1.2, 1],
          duration: 900,
          ease: "inOutQuad",
          svgOrigin: "600 356",
        });
        cleanups.push(() => { nodeAnim.revert(); });
      }
      if (halo) {
        const haloAnim = animate(halo, {
          scale: [1, 1.6, 1],
          opacity: [0.35, 0.06],
          duration: 1000,
          ease: "outQuad",
          svgOrigin: "600 356",
        });
        cleanups.push(() => { haloAnim.revert(); });
      }
    }, 1050);

    return () => {
      window.clearTimeout(timer);
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
            {/* Converging gateway motif — every model in, one endpoint out. */}
            <svg
              viewBox="0 0 1200 400"
              preserveAspectRatio="xMidYMid slice"
              className="absolute inset-0 h-full w-full text-brand"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
              strokeLinecap="round"
            >
              <g opacity="0.3">
                <path className="cta-line" d="M-40 60 C 320 60 420 200 600 356" />
                <path className="cta-line" d="M-40 130 C 300 130 430 200 600 356" />
                <path className="cta-line" d="M-40 200 C 240 200 440 200 600 356" />
                <path className="cta-line" d="M-40 270 C 300 270 430 200 600 356" />
                <path className="cta-line" d="M-40 340 C 320 340 420 200 600 356" />
              </g>
              <g opacity="0.26" className="text-teal">
                <path className="cta-line" d="M1240 60 C 880 60 780 200 600 356" />
                <path className="cta-line" d="M1240 130 C 900 130 770 200 600 356" />
                <path className="cta-line" d="M1240 200 C 960 200 760 200 600 356" />
                <path className="cta-line" d="M1240 270 C 900 270 770 200 600 356" />
                <path className="cta-line" d="M1240 340 C 880 340 780 200 600 356" />
              </g>
              {/* center node: halo breathes once as the lines land */}
              <circle
                className="cta-halo"
                cx="600"
                cy="356"
                r="12"
                fill="none"
                stroke="var(--color-brand)"
                strokeWidth="1.5"
                opacity="0.22"
              />
              <circle className="cta-pkt" r="3.5" fill="var(--color-brand)" stroke="none" opacity="0" />
              <circle className="cta-pkt" r="3.5" fill="var(--color-teal)" stroke="none" opacity="0" />
              <circle className="cta-node fill-brand stroke-none" cx="600" cy="356" r="5" />
            </svg>
            <div className="bg-grid absolute inset-0 opacity-60" />
          </div>

          <div className="relative flex flex-col items-center gap-7 px-6 py-16 text-center sm:px-10 md:py-24">
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
                  <span className="cta-word inline-block">{word}</span>
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
