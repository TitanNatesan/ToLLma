"use client";

import { useEffect, useLayoutEffect } from "react";
import { Container, Section } from "@/components/ui/layout";
import { Badge, CTA } from "@/components/ui/primitives";
import { IconArrowRight, IconCheck, IconGitHub } from "@/components/ui/icons";
import { animate, fadeUp, stagger, useInViewOnce, useReducedMotion, utils } from "@/lib/animations";
import { BRAND, GET_STARTED_URL, GITHUB_URL } from "@/lib/site";
import HeroGateway from "./hero-gateway";

// Verified supporting points (site.ts facts, no invented claims).
const POINTS = [
  "Unified OpenAI-compatible API",
  "Multiple providers",
  "Usage & cost visibility",
];

export default function Hero() {
  const [textRef, textSeen] = useInViewOnce<HTMLDivElement>(0.2);
  const reduced = useReducedMotion();

  // Hide the text column before first paint only when motion is allowed;
  // reduced-motion + no-JS render everything immediately.
  useLayoutEffect(() => {
    const root = textRef.current;
    if (!root || reduced) return;
    const items = root.querySelectorAll("[data-reveal]");
    if (!items.length) return;
    utils.set(items, { opacity: 0, y: 22 });
    return () => {
      utils.set(items, { clear: "all" });
    };
  }, [reduced, textRef]);

  useEffect(() => {
    const root = textRef.current;
    if (!root || !textSeen || reduced) return;
    const items = root.querySelectorAll("[data-reveal]");
    if (!items.length) return;
    const a = animate(items, {
      ...fadeUp(22, 700),
      delay: stagger(60, { start: 0 }),
    });
    return () => {
      a.revert();
    };
  }, [textSeen, reduced, textRef]);

  return (
    <Section tone="canvas" className="overflow-hidden">
      <div className="bg-grid pointer-events-none absolute inset-0" aria-hidden="true" />
      <Container width="wide" className="relative">
        <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-16 xl:gap-20">
          <div ref={textRef} className="flex max-w-xl flex-col items-start gap-5">
            <div data-reveal>
              <Badge tone="brand">Open source · {BRAND.license}</Badge>
            </div>

            <h1
              data-reveal
              className="font-semibold tracking-tight text-balance text-ink"
              style={{ fontSize: "var(--t-display)", lineHeight: 1.06 }}
            >
              {BRAND.headline}.
            </h1>

            <p
              data-reveal
              className="text-muted"
              style={{ fontSize: "var(--t-lead)", lineHeight: 1.6, maxWidth: "54ch" }}
            >
              Connect every AI provider behind one OpenAI-compatible endpoint — manage API access,
              monitor usage, control costs, and govern each request from a single place.
            </p>

            <div data-reveal className="flex flex-wrap items-center gap-3 pt-1">
              <CTA href={GET_STARTED_URL} size="lg">
                Get Started
                <IconArrowRight size={18} />
              </CTA>
              <CTA href={GITHUB_URL} variant="secondary" size="lg">
                <IconGitHub size={18} />
                Explore GitHub
              </CTA>
            </div>

            <ul data-reveal className="flex flex-wrap gap-x-6 gap-y-2.5 pt-1">
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
      </Container>
    </Section>
  );
}
