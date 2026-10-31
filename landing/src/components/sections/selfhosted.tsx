"use client";

import { useLayoutEffect, useEffect, type RefObject } from "react";
import { Container, Section, SectionHeading } from "@/components/ui/layout";
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
      className="os-link hidden h-px w-7 flex-none origin-left self-center bg-line-strong lg:block"
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
    if (boundary) utils.set(boundary, { opacity: 0 });
    if (svcs?.length) utils.set(svcs, { opacity: 0, y: 12, scale: 0.94 });
    if (links?.length) utils.set(links, { scaleX: 0 });
    if (caps?.length) utils.set(caps, { opacity: 0 });
    return () => {
      if (boundary) utils.set(boundary, { clear: "all" });
      if (svcs?.length) utils.set(svcs, { clear: "all" });
      if (links?.length) utils.set(links, { clear: "all" });
      if (caps?.length) utils.set(caps, { clear: "all" });
    };
  }, [reduced, stackRef]);

  // Stack diagram: boundary settles → services power on (stagger 80,
  // slight scale) → connectors draw → captions light. One-shot, ~1.7s.
  useEffect(() => {
    const root = stackRef.current;
    if (!root || !seen || reduced) return;
    const boundary = root.querySelector(".os-boundary");
    const tl = createTimeline({ defaults: { ease: "outExpo" } });
    if (boundary) tl.add(boundary, { ...fadeIn(600) }, 0);
    tl.add(root.querySelectorAll(".os-svc"), {
      ...scaleReveal(0.94, 550),
      y: [12, 0],
      delay: staggerReveal(80, { start: 350 }),
    });
    tl.add(root.querySelectorAll(".os-link"), {
      scaleX: [0, 1],
      duration: 350,
      delay: staggerReveal(80, { start: 950 }),
    });
    tl.add(root.querySelectorAll(".os-cap"), {
      ...fadeIn(400),
      delay: staggerReveal(50, { start: 1100 }),
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

            <div data-reveal className="mt-12 flex flex-col items-center text-center">
              <code className="inline-flex max-w-full items-center gap-2 overflow-x-auto rounded-lg border border-line bg-surface px-4 py-2 font-mono text-[0.82rem] whitespace-nowrap text-ink-soft">
                <IconTerminal size={16} className="shrink-0 text-teal" />
                docker compose up
              </code>
            </div>

            <div className="os-boundary relative mt-8 rounded-3xl border border-dashed border-line-strong bg-surface/60 p-6 sm:p-8">
              <p className="absolute -top-3 left-6 rounded-full border border-line bg-surface px-3 py-0.5 text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-faint">
                your server
              </p>
              <div
                role="img"
                aria-label="Docker Compose services: postgres, backend, frontend, valkey, and laya, all running on your own infrastructure."
                className="flex flex-wrap items-stretch justify-center gap-3 lg:gap-0"
              >
                {STACK.map((svc, i) => (
                  <div key={svc} className="flex min-w-0 flex-[1_1_9rem] items-stretch sm:max-w-52 lg:flex-none">
                    {i > 0 && <Connector />}
                    <div className="os-svc min-w-0 flex-1 rounded-xl border border-line bg-surface p-3.5 shadow-[var(--shadow-xs)] transition-[box-shadow,border-color] duration-[var(--dur-fast)] hover:border-brand-soft hover:shadow-[var(--shadow-sm)] lg:w-36 lg:flex-none">
                      <p className="font-mono text-[0.8rem] font-semibold text-ink">{svc}</p>
                      <p className="os-cap mt-0.5 text-[0.72rem] text-muted">{SERVICES[svc].role}</p>
                      <span
                        aria-hidden="true"
                        className={`mt-2.5 block h-1 w-8 rounded-full ${
                          i === 1 ? "bg-teal" : "bg-brand-soft"
                        }`}
                      />
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
