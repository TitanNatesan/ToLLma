"use client";

import { useEffect, useLayoutEffect, type RefObject } from "react";
import { Container, Section, SectionHeading } from "@/components/ui/layout";
import { Badge } from "@/components/ui/primitives";
import {
  animate,
  drawSvgPaths,
  fadeIn,
  fadeUp,
  stagger,
  useInViewOnce,
  useParallax,
  useReducedMotion,
  useRevealOnScroll,
  utils,
} from "@/lib/animations";

// ============================================================
// Request lifecycle — 8 numbered stages.
// Desktop (xl+): one horizontal SVG pipeline. The request packet is
// scroll-linked — its position along the pipeline maps to the
// section's travel through the viewport (reverses on scroll-up),
// and nodes light cumulatively as the packet passes them.
// Below xl: a vertical stacked timeline (no horizontal overflow).
// Static state (reduced motion / no JS) shows everything, packet
// parked at stage 1. Animation is progressive enhancement only.
// ============================================================

const STAGES: { full: string; label: [string, string] }[] = [
  { full: "Application sends a request", label: ["Application sends", "a request"] },
  { full: "ToLLma authenticates the API key", label: ["ToLLma authenticates", "the API key"] },
  { full: "Resolves provider & model", label: ["Resolves provider", "& model"] },
  { full: "Applies configured policies", label: ["Applies configured", "policies"] },
  { full: "Routes the request to the provider", label: ["Routes the request", "to the provider"] },
  { full: "Receives the response", label: ["Receives the", "response"] },
  { full: "Records usage & cost", label: ["Records usage", "& cost"] },
  { full: "Returns the response to the application", label: ["Returns the response", "to the application"] },
];

// --- horizontal diagram geometry (viewBox units) ---
const VW = 1200;
const VH = 146;
const PAD = 80;
const CY = 68;
const R = 26;
const LABEL_Y = 112;
const STEP_X = (VW - PAD * 2) / (STAGES.length - 1);
const X = (i: number) => PAD + i * STEP_X;

// Scroll-progress window: the packet runs the full pipeline while the
// diagram crosses the middle band of the viewport (raw progress is
// 0 when the diagram enters from the bottom, 1 when it exits the top).
const TRAVEL_START = 0.3;
const TRAVEL_END = 0.75;

function connectorD(i: number) {
  return `M ${X(i) + R + 8} ${CY} L ${X(i + 1) - R - 20} ${CY}`;
}

function arrowD(i: number) {
  const tip = X(i + 1) - R - 6;
  return `M ${tip - 8} ${CY - 7} L ${tip} ${CY} L ${tip - 8} ${CY + 7}`;
}

export default function HowItWorks() {
  const revealRef = useRevealOnScroll();
  const [diagramRef, seen] = useInViewOnce<HTMLDivElement>(0.25);
  const reduced = useReducedMotion();
  const gridRef = useParallax<HTMLDivElement>(0.06);

  // Pre-hide animated targets — only when JS is alive and motion is
  // allowed, so reduced-motion + no-JS keep the full static diagram.
  useLayoutEffect(() => {
    const root = diagramRef.current;
    if (!root || reduced) return;
    const links = root.querySelector(".hiw-links");
    const packet = root.querySelector(".hiw-packet");
    const rails = root.querySelectorAll(".hiw-rail");
    const mnodes = root.querySelectorAll(".hiw-mnode");
    const faded: Element[] = [];
    if (links) faded.push(links);
    if (packet) faded.push(packet);
    faded.push(...mnodes);
    utils.set(faded, { opacity: 0 });
    utils.set(rails, { scaleY: 0 });
    return () => {
      utils.set(faded, { clear: "all" });
      utils.set(rails, { clear: "all" });
    };
  }, [reduced, diagramRef]);

  // Entrance: draw connectors on first in-view; packet fades in only
  // after the lines have drawn. Heading/legend reveal via
  // useRevealOnScroll ([data-reveal] = fadeUp preset).
  useEffect(() => {
    const root = diagramRef.current;
    if (!root || !seen || reduced) return;
    const cleanups: Array<() => void> = [];

    const links = root.querySelector(".hiw-links");
    if (links) utils.set(links, { opacity: 1 });
    cleanups.push(drawSvgPaths(root, ".hiw-link", { duration: 800, staggerMs: 90 }));

    const packet = root.querySelector<SVGGElement>(".hiw-packet");
    if (packet) {
      const fade = animate(packet, {
        ...fadeIn(400),
        delay: 950, // connectors finish ~1340ms; packet appears as they land
      });
      cleanups.push(() => fade.revert());
    }

    // mobile: rail draws down, steps fade in one by one
    const rails = Array.from(root.querySelectorAll<HTMLElement>(".hiw-rail"));
    if (rails.length) {
      const railAnim = animate(rails, {
        scaleY: [0, 1],
        duration: 750,
        delay: stagger(80),
        ease: "outExpo",
      });
      cleanups.push(() => railAnim.revert());
    }
    const mnodes = Array.from(root.querySelectorAll<HTMLElement>(".hiw-mnode"));
    if (mnodes.length) {
      const stepAnim = animate(mnodes, {
        ...fadeUp(14, 520),
        delay: stagger(80, { start: 60 }),
      });
      cleanups.push(() => stepAnim.revert());
    }

    return () => cleanups.forEach((fn) => fn());
  }, [seen, reduced, diagramRef]);

  // Scroll-linked packet (desktop xl+ only). The pipeline is a straight
  // horizontal line at CY, so progress maps directly to x — no
  // getPointAtLength needed. Own passive scroll listener + rAF (rather
  // than useScrollProgress's setState) so per-frame work is attribute
  // writes only, no SVG re-render. Nodes stay lit once lit (calm).
  useEffect(() => {
    const root = diagramRef.current;
    if (!root || !seen || reduced) return;
    const wrap = root.querySelector<HTMLElement>(".hiw-svgwrap");
    const packet = root.querySelector<SVGGElement>(".hiw-packet");
    const lits = Array.from(root.querySelectorAll<SVGCircleElement>(".hiw-lit"));
    if (!wrap || !packet) return;

    const mq = window.matchMedia("(min-width: 1280px)");
    let raf = 0;

    const apply = () => {
      raf = 0;
      if (!mq.matches) return; // svg hidden below xl — skip the work
      const rect = wrap.getBoundingClientRect();
      const vh = window.innerHeight || 1;
      const raw = (vh - rect.top) / (vh + rect.height); // 0 → 1 crossing
      const t = Math.min(1, Math.max(0, (raw - TRAVEL_START) / (TRAVEL_END - TRAVEL_START)));
      const px = X(0) + t * (X(STAGES.length - 1) - X(0));
      packet.setAttribute("transform", `translate(${px.toFixed(1)} ${CY})`);
      for (let i = 0; i < lits.length; i++) {
        if (px >= X(i) - 4) lits[i].style.opacity = "1"; // cumulative, stays lit
      }
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(apply);
    };

    for (const lit of lits) {
      lit.style.transition = "opacity var(--dur-base) var(--ease-out-expo)";
    }
    apply();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    mq.addEventListener("change", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      mq.removeEventListener("change", onScroll);
      if (raf) cancelAnimationFrame(raf);
      for (const lit of lits) {
        lit.style.transition = "";
        lit.style.opacity = ""; // back to static unlit state (attribute opacity="0")
      }
      packet.setAttribute("transform", `translate(${X(0)} ${CY})`); // park at stage 1
    };
  }, [seen, reduced, diagramRef]);

  const desc =
    "Eight stages: the application sends a request, ToLLma authenticates the API key, " +
    "resolves the provider and model, applies configured policies, routes the request to " +
    "the provider, receives the response, records usage and cost, and returns the response " +
    "to the application.";

  return (
    <Section id="how-it-works" tone="surface">
      <Container width="wide">
        {/* cast: useRevealOnScroll's ref is typed HTMLElement */}
        <div ref={revealRef as RefObject<HTMLDivElement | null>}>
          <SectionHeading
            eyebrow="How it works"
            title="How ToLLma works"
            lead="Every request follows the same path: authenticate, resolve the provider and model you configured, apply your guardrail policies, route, record usage — then return the response to your application."
          />

          <div ref={diagramRef} className="mt-12">
            {/* depth card: subtle layered elevation, parallax grid behind */}
            <div className="relative overflow-hidden rounded-xl border border-line bg-canvas shadow-sm transition-shadow duration-[var(--dur-base)] ease-[var(--ease-out-expo)] hover:shadow-md">
              <div
                ref={gridRef}
                aria-hidden="true"
                className="pointer-events-none absolute -inset-3 opacity-70"
                style={{
                  backgroundImage: "radial-gradient(var(--color-line) 1px, transparent 1px)",
                  backgroundSize: "26px 26px",
                }}
              />
              <div className="relative px-5 py-7 sm:px-8">
                {/* --- horizontal pipeline (xl+) --- */}
                <div className="hiw-svgwrap hidden xl:block">
                  <svg
                    viewBox={`0 0 ${VW} ${VH}`}
                    className="block h-auto w-full"
                    role="img"
                    aria-labelledby="hiw-title hiw-desc"
                  >
                    <title id="hiw-title">How ToLLma works</title>
                    <desc id="hiw-desc">{desc}</desc>

                    {/* connectors + arrows (drawn on scroll into view) */}
                    <g className="hiw-links" fill="none">
                      {STAGES.slice(0, -1).map((_, i) => (
                        <path
                          key={`link-${i}`}
                          className="hiw-link"
                          d={connectorD(i)}
                          stroke="var(--color-line-strong)"
                          strokeWidth="2"
                          strokeLinecap="round"
                        />
                      ))}
                      {STAGES.slice(0, -1).map((_, i) => (
                        <path
                          key={`arrow-${i}`}
                          d={arrowD(i)}
                          stroke="var(--color-faint)"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      ))}
                    </g>

                    {/* stage nodes: circle + number, label below.
                        hover ring is decorative (SVG is role="img"); the
                        vertical timeline below xl carries the text a11y. */}
                    {STAGES.map((s, i) => {
                      const x = X(i);
                      return (
                        <g key={s.full} className="group">
                          <g className="hiw-node">
                            <circle
                              cx={x}
                              cy={CY}
                              r={R}
                              fill="var(--color-surface)"
                              stroke="var(--color-line-strong)"
                              strokeWidth="1.5"
                            />
                            <circle
                              className="hiw-lit"
                              cx={x}
                              cy={CY}
                              r={R}
                              fill="var(--color-brand-soft)"
                              stroke="var(--color-brand)"
                              strokeWidth="2"
                              opacity="0"
                            />
                            <circle
                              cx={x}
                              cy={CY}
                              r={R + 5}
                              fill="none"
                              stroke="var(--color-brand)"
                              strokeWidth="1.5"
                              className="opacity-0 transition-opacity duration-[var(--dur-fast)] group-hover:opacity-60"
                            />
                            <text
                              x={x}
                              y={CY}
                              textAnchor="middle"
                              dominantBaseline="central"
                              fontSize="15"
                              fontWeight="700"
                              fill="var(--color-ink-soft)"
                            >
                              {i + 1}
                            </text>
                          </g>
                          <g fill="var(--color-muted)" fontSize="13" textAnchor="middle">
                            <text x={x} y={LABEL_Y}>
                              {s.label[0]}
                            </text>
                            <text x={x} y={LABEL_Y + 18}>
                              {s.label[1]}
                            </text>
                          </g>
                        </g>
                      );
                    })}

                    {/* request packet — parked at stage 1 in the static state;
                        scroll-linked once connectors have drawn */}
                    <g className="hiw-packet" transform={`translate(${X(0)} ${CY})`} aria-hidden="true">
                      <circle r="12" fill="var(--color-brand-soft)" />
                      <circle r="6.5" fill="var(--color-brand)" />
                    </g>
                  </svg>
                </div>

                {/* --- vertical timeline (below xl) --- */}
                <ol className="relative mx-auto max-w-2xl xl:hidden">
                  {STAGES.map((s, i) => (
                    <li key={s.full} className="hiw-mnode relative flex gap-4 pb-6 last:pb-0">
                      {i < STAGES.length - 1 && (
                        <span
                          className="hiw-rail absolute left-4 top-8 bottom-0 w-px bg-line-strong"
                          style={{ transformOrigin: "top" }}
                          aria-hidden="true"
                        />
                      )}
                      <span className="relative z-10 grid h-8 w-8 shrink-0 place-items-center rounded-full border border-line-strong bg-surface text-[0.8rem] font-semibold text-ink">
                        {i + 1}
                      </span>
                      <p className="pt-1.5 text-sm leading-6 text-ink-soft">{s.full}</p>
                    </li>
                  ))}
                </ol>
              </div>
            </div>

            <div data-reveal className="mt-10 flex flex-wrap items-center justify-center gap-3">
              <Badge tone="brand">Deterministic routing</Badge>
              <Badge tone="teal">Provider &amp; model from your configuration</Badge>
              <Badge tone="ok">Usage recorded on every request</Badge>
            </div>
          </div>
        </div>
      </Container>
    </Section>
  );
}
