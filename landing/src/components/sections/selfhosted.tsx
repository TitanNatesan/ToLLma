"use client";

import { useLayoutEffect, useEffect, type RefObject } from "react";
import { Container, Section, SectionHeading } from "@/components/ui/layout";
import { CopyButton } from "@/components/ui/copy-button";
import { IconTerminal } from "@/components/ui/icons";
import {
  createTimeline,
  fadeIn,
  scaleReveal,
  staggerReveal,
  useInViewOnce,
  useReducedMotion,
  useRevealOnScroll,
  utils,
} from "@/lib/animations";
import { STACK } from "@/lib/site";

// ============================================================
// Self-hosted by default — Docker Compose stack diagram showing
// the compose services inside a "your server" boundary. All
// services come from the verified STACK list in site.ts.
// On view: the boundary settles, services power on one by one
// (status dot + progress bar), then connectors draw.
// ============================================================

const SERVICES: Record<(typeof STACK)[number], { role: string }> = {
  postgres: { role: "database" },
  backend: { role: "API gateway" },
  frontend: { role: "dashboard" },
  valkey: { role: "cache" },
  laya: { role: "guardrails" },
};

function Connector() {
  return (
    <span
      aria-hidden="true"
      className="os-link hidden h-px w-6 flex-none origin-left self-center bg-line-strong lg:block"
    />
  );
}

export default function SelfHosted() {
  const revealRef = useRevealOnScroll();
  const [stackRef, seen] = useInViewOnce<HTMLDivElement>(0.3);
  const reduced = useReducedMotion();

  // Pre-hide animated pieces only when JS is alive and motion is allowed,
  // so reduced-motion and no-JS keep the complete static diagram.
  useLayoutEffect(() => {
    if (reduced) return;
    const root = stackRef.current;
    const boundary = root?.querySelector(".os-boundary");
    const svcs = root?.querySelectorAll(".os-svc");
    const links = root?.querySelectorAll(".os-link");
    const caps = root?.querySelectorAll(".os-cap");
    const dots = root?.querySelectorAll(".os-dot-live");
    const bars = root?.querySelectorAll(".os-bar");
    if (boundary) utils.set(boundary, { opacity: 0 });
    if (svcs?.length) utils.set(svcs, { opacity: 0, y: 12, scale: 0.94 });
    if (links?.length) utils.set(links, { scaleX: 0 });
    if (caps?.length) utils.set(caps, { opacity: 0 });
    if (dots?.length) utils.set(dots, { opacity: 0 });
    if (bars?.length) utils.set(bars, { scaleX: 0, transformOrigin: "0% 50%" });
    return () => {
      if (boundary) utils.set(boundary, { clear: "all" });
      if (svcs?.length) utils.set(svcs, { clear: "all" });
      if (links?.length) utils.set(links, { clear: "all" });
      if (caps?.length) utils.set(caps, { clear: "all" });
      if (dots?.length) utils.set(dots, { clear: "all" });
      if (bars?.length) utils.set(bars, { clear: "all" });
    };
  }, [reduced, stackRef]);

  // Boot sequence: boundary settles → services appear → each status dot
  // flips green and its progress bar fills → connectors draw. ~1.9s.
  useEffect(() => {
    const root = stackRef.current;
    if (!root || !seen || reduced) return;
    const boundary = root.querySelector(".os-boundary");
    const tl = createTimeline({ defaults: { ease: "outExpo" } });
    if (boundary) tl.add(boundary, { ...fadeIn(600) }, 0);
    tl.add(root.querySelectorAll(".os-svc"), {
      ...scaleReveal(0.94, 550),
      y: [12, 0],
      delay: staggerReveal(90, { start: 300 }),
    });
    tl.add(root.querySelectorAll(".os-dot-live"), {
      opacity: [0, 1],
      duration: 320,
      delay: staggerReveal(90, { start: 720 }),
    });
    tl.add(root.querySelectorAll(".os-bar"), {
      scaleX: [0, 1],
      duration: 520,
      delay: staggerReveal(90, { start: 760 }),
    });
    tl.add(root.querySelectorAll(".os-link"), {
      scaleX: [0, 1],
      duration: 350,
      delay: staggerReveal(80, { start: 1150 }),
    });
    tl.add(root.querySelectorAll(".os-cap"), {
      ...fadeIn(400),
      delay: staggerReveal(40, { start: 1250 }),
    });
    return () => {
      tl.revert();
    };
  }, [seen, reduced, stackRef]);

  return (
    <Section id="self-hosted" tone="cool">
      <Container width="wide">
        <div ref={revealRef as RefObject<HTMLDivElement | null>}>
          <div ref={stackRef as RefObject<HTMLDivElement | null>}>
            <SectionHeading
              eyebrow="Self-hosted by default"
              title="Your infrastructure, your data."
              lead="Run the whole gateway with Docker Compose. Five services, one file, zero data leaving your infrastructure."
            />

            <div
              data-reveal
              className="mt-12 flex flex-col items-center justify-center gap-2 sm:flex-row"
            >
              <div className="inline-flex max-w-full items-center gap-2 rounded-full border border-line bg-surface px-3.5 py-2 shadow-xs">
                <IconTerminal size={16} className="shrink-0 text-teal" />
                <code className="font-mono text-[0.82rem] whitespace-nowrap text-ink-soft">
                  docker compose up
                </code>
              </div>
              <CopyButton value="docker compose up" label="Copy command" />
            </div>

            <div className="os-boundary relative mx-auto mt-9 max-w-4xl rounded-3xl border border-dashed border-line-strong bg-surface/60 p-6 sm:p-8">
              <p className="absolute -top-3 left-6 rounded-full border border-line bg-surface px-3 py-0.5 text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-faint">
                your server
              </p>
              <div
                role="img"
                aria-label="Docker Compose services: postgres, backend, frontend, valkey, and laya, all running on your own infrastructure."
                className="flex flex-wrap items-stretch justify-center gap-3 lg:flex-nowrap lg:justify-center lg:gap-0"
              >
                {STACK.map((svc, i) => (
                  <div key={svc} className="flex min-w-0 flex-[1_1_9rem] items-stretch sm:max-w-52 lg:flex-none">
                    {i > 0 && <Connector />}
                    <div className="os-svc min-w-0 flex-1 rounded-xl border border-line bg-surface p-3.5 shadow-[var(--shadow-xs)] transition-[box-shadow,border-color] duration-[var(--dur-fast)] hover:border-brand-soft hover:shadow-[var(--shadow-sm)] lg:w-36 lg:flex-none">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate font-mono text-[0.8rem] font-semibold text-ink">{svc}</p>
                        <span
                          aria-hidden="true"
                          className="relative size-2 shrink-0 rounded-full bg-line-strong"
                        >
                          <span className="os-dot-live absolute inset-0 rounded-full bg-ok" />
                        </span>
                      </div>
                      <p className="os-cap mt-0.5 text-[0.72rem] text-muted">{SERVICES[svc].role}</p>
                      <span
                        aria-hidden="true"
                        className="mt-3 block h-1 overflow-hidden rounded-full bg-surface-tint"
                      >
                        <span className="os-bar block h-full w-full origin-left rounded-full bg-brand" />
                      </span>
                    </div>
                  </div>
                ))}
              </div>
              <p className="os-cap mt-6 text-center text-sm text-muted">
                One <span className="font-mono text-[0.8rem] text-ink-soft">docker-compose.yml</span>,
                five services, zero data leaving your infrastructure.
              </p>
            </div>
          </div>
        </div>
      </Container>
    </Section>
  );
}
