"use client";

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
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

const STAGES: { full: string; label: [string, string]; desc: string }[] = [
  {
    full: "Application sends a request",
    label: ["Application sends", "a request"],
    desc: "Your app calls the OpenAI-compatible endpoint with a provider-prefixed model name.",
  },
  {
    full: "ToLLma authenticates the API key",
    label: ["ToLLma authenticates", "the API key"],
    desc: "The gateway validates the key and resolves the limits and budgets attached to it.",
  },
  {
    full: "Resolves provider & model",
    label: ["Resolves provider", "& model"],
    desc: "The model prefix selects the provider adapter and the model configured behind it.",
  },
  {
    full: "Applies configured policies",
    label: ["Applies configured", "policies"],
    desc: "Guardrail policies for the key's scope are evaluated before the request is routed.",
  },
  {
    full: "Routes the request to the provider",
    label: ["Routes the request", "to the provider"],
    desc: "The request is translated to the provider's native API and sent upstream.",
  },
  {
    full: "Receives the response",
    label: ["Receives the", "response"],
    desc: "Streaming or buffered output comes back through the gateway without a second API shape.",
  },
  {
    full: "Records usage & cost",
    label: ["Records usage", "& cost"],
    desc: "Tokens, requests, and cost are recorded against the key that made the call.",
  },
  {
    full: "Returns the response to the application",
    label: ["Returns the response", "to the application"],
    desc: "Your app receives one consistent response shape, whichever provider served it.",
  },
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
  const pinRef = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState(0);

  // Active step follows the pinned wrapper on desktop and the timeline's
  // travel through the viewport below xl. State changes only when the
  // index changes, so scrolling does not re-render every frame.
  useEffect(() => {
    const el = pinRef.current;
    if (!el) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const xl = window.matchMedia("(min-width: 1280px)").matches && !reduced;
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight || 1;
      let idx: number;
      if (xl) {
        const p = Math.min(1, Math.max(0, -r.top / Math.max(1, el.offsetHeight - vh)));
        idx = Math.min(STAGES.length - 1, Math.floor(p * STAGES.length));
      } else {
        // Below xl the timeline is in normal flow: highlight the step
        // nearest the viewport center rather than mapping the whole card.
        const steps = Array.from(el.querySelectorAll<HTMLElement>('[id^="hiw-step-"]'));
        let best = 0;
        let dist = Infinity;
        steps.forEach((step, i) => {
          const sr = step.getBoundingClientRect();
          const d = Math.abs((sr.top + sr.bottom) / 2 - vh * 0.5);
          if (d < dist) {
            dist = d;
            best = i;
          }
        });
        idx = steps.length ? best : 0;
      }
      setActive((a) => (a === idx ? a : idx));
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [reduced]);

  const goToStep = (i: number) => {
    const el = pinRef.current;
    if (!el) return;
    const pinned = window.matchMedia("(min-width: 1280px)").matches && !reduced;
    if (pinned) {
      const total = Math.max(1, el.offsetHeight - window.innerHeight);
      const docTop = el.getBoundingClientRect().top + window.scrollY;
      window.scrollTo({
        top: docTop + ((i + 0.2) / STAGES.length) * total,
        behavior: reduced ? "auto" : "smooth",
      });
    } else {
      document.getElementById(`hiw-step-${i}`)?.scrollIntoView({
        block: "center",
        behavior: reduced ? "auto" : "smooth",
      });
    }
    setActive(i);
  };

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
            <div ref={pinRef} className={`hiw-pin ${reduced ? "" : "xl:h-[200vh]"}`}>
              <div
                className={`hiw-sticky ${
                  reduced
                    ? ""
                    : "xl:sticky xl:top-24 xl:flex xl:min-h-[calc(100vh-8rem)] xl:flex-col xl:justify-center"
                }`}
              >
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
                <div className="hiw-svgwrap relative hidden xl:block">
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
                              opacity={i <= active ? 1 : 0}
                              style={{ transition: "opacity 300ms var(--ease-out-expo)" }}
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
                            <circle
                              cx={x}
                              cy={CY}
                              r={R + 5}
                              fill="none"
                              stroke="var(--color-brand)"
                              strokeWidth="2"
                              opacity={i === active ? 1 : 0}
                              className="transition-opacity duration-200"
                            />
                            <text
                              x={x}
                              y={CY}
                              textAnchor="middle"
                              dominantBaseline="central"
                              fontSize="15"
                              fontWeight="700"
                              fill={i === active ? "var(--color-brand-strong)" : "var(--color-ink-soft)"}
                            >
                              {i + 1}
                            </text>
                          </g>
                          <g
                            fill={i === active ? "var(--color-ink)" : "var(--color-muted)"}
                            fontSize="13"
                            fontWeight={i === active ? 600 : 400}
                            textAnchor="middle"
                          >
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
                    <g
                      className="hiw-packet"
                      style={{
                        transform: `translate(${X(active)}px, ${CY}px)`,
                        transition: reduced ? undefined : "transform 600ms var(--ease-out-expo)",
                      }}
                      aria-hidden="true"
                    >
                      <circle r="12" fill="var(--color-brand-soft)" />
                      <circle r="6.5" fill="var(--color-brand)" />
                    </g>
                  </svg>
                  <div className="absolute inset-0 grid grid-cols-8 px-2">
                    {STAGES.map((s, i) => (
                      <button
                        key={s.full}
                        type="button"
                        onClick={() => goToStep(i)}
                        aria-label={`Step ${i + 1}: ${s.full}`}
                        aria-current={i === active ? "step" : undefined}
                        className="h-full w-full rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                      />
                    ))}
                  </div>
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
                      <button
                        id={`hiw-step-${i}`}
                        type="button"
                        onClick={() => goToStep(i)}
                        aria-current={i === active ? "step" : undefined}
                        className="flex w-full items-start gap-4 text-left"
                      >
                        <span
                          className={`relative z-10 grid h-8 w-8 shrink-0 place-items-center rounded-full border text-[0.8rem] font-semibold transition-colors ${
                            i === active
                              ? "border-brand bg-brand-soft text-brand-strong"
                              : "border-line-strong bg-surface text-ink"
                          }`}
                        >
                          {i + 1}
                        </span>
                        <span
                          className={`pt-1.5 text-sm leading-6 transition-colors ${
                            i === active ? "font-medium text-ink" : "text-ink-soft"
                          }`}
                        >
                          {s.full}
                        </span>
                      </button>
                    </li>
                  ))}
                </ol>
              </div>
            </div>

            {/* active step detail — swaps as the stepper advances */}
            <div className="mt-4 grid gap-3 rounded-2xl border border-line bg-surface p-5 shadow-sm sm:grid-cols-[auto_1fr] sm:items-start">
              <span
                aria-hidden="true"
                className="grid size-10 place-items-center rounded-xl bg-brand-soft text-sm font-semibold text-brand-strong"
              >
                {String(active + 1).padStart(2, "0")}
              </span>
              <div className="min-w-0">
                <p className="text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-faint">
                  Step {active + 1} of {STAGES.length}
                </p>
                <p className="mt-1 text-sm font-semibold text-ink">{STAGES[active].full}</p>
                <p className="mt-1 min-h-[3.5rem] text-sm leading-6 text-muted">{STAGES[active].desc}</p>
              </div>
            </div>
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
