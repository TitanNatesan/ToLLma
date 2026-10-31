"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Container, Section, SectionHeading } from "@/components/ui/layout";
import { Badge } from "@/components/ui/primitives";
import {
  IconChart,
  IconDoc,
  IconKey,
  IconLayers,
  IconOrg,
  IconShield,
} from "@/components/ui/icons";
import {
  animate,
  createTimeline,
  drawSvgPaths,
  fadeIn,
  fadeUp,
  scaleReveal,
  staggerReveal,
  useInViewOnce,
  useParallax,
  useReducedMotion,
  useRevealOnScroll,
  utils,
} from "@/lib/animations";
import { GUARDRAIL_CATEGORIES } from "@/lib/site";

// ============================================================
// Security & governance — a request crossing security checkpoints.
// Desktop (xl+): inline SVG pipeline. The packet's journey through
// the four checkpoints (key auth → policy scope → guardrail
// categories → prompt log) is scroll-linked to the section's travel
// through the viewport; gates light cumulatively as it passes. At
// the fork the outcomes resolve once: a violating request drops onto
// the blocked branch while the passing one rides the ok branch to
// the provider. Below xl: the same checkpoints stack vertically.
// Reduced motion / no-JS: fully readable static diagram.
// Guardrails are opt-in, user-configured policies — copy says so.
// ============================================================

const CHECKPOINTS: { full: string; label: [string, string] }[] = [
  { full: "API key authenticated", label: ["API key", "authenticated"] },
  { full: "Policy scope resolved", label: ["Policy scope", "resolved"] },
  { full: "Guardrail categories evaluated", label: ["Guardrail categories", "evaluated"] },
  { full: "Prompt logged with retention", label: ["Prompt logged", "with retention"] },
];

// --- horizontal diagram geometry (viewBox units) ---
const VW = 1040;
const VH = 296;
const CY = 140;
const GATE_X = [210, 400, 590, 780];
const SPLIT_X = 872;
const OK = { x: 972, y: 76 };
const BAD = { x: 972, y: 204 };

const OK_BRANCH = `M ${SPLIT_X} ${CY} C 916 ${CY} 928 ${OK.y} ${OK.x - 16} ${OK.y}`;
const BAD_BRANCH = `M ${SPLIT_X} ${CY} C 916 ${CY} 928 ${BAD.y} ${BAD.x - 16} ${BAD.y}`;

// Line segments between gates (the packet passes *through* each gate).
const SEGMENTS: [number, number][] = [
  [88, GATE_X[0] - 7],
  [GATE_X[0] + 7, GATE_X[1] - 7],
  [GATE_X[1] + 7, GATE_X[2] - 7],
  [GATE_X[2] + 7, GATE_X[3] - 7],
  [GATE_X[3] + 7, SPLIT_X],
];

// Scroll-linked travel window: the packet runs entry → fork while the
// diagram crosses the middle band of the viewport (raw progress is 0
// when it enters from the bottom, 1 when it exits the top).
const TRAVEL_START = 0.25;
const TRAVEL_END = 0.7;
const PACKET_X = [72, ...GATE_X, SPLIT_X]; // entry → each gate → fork

// Piecewise map so every gate arrival is evenly spaced in scroll.
function xAt(t: number) {
  const segs = PACKET_X.length - 1;
  const s = Math.min(segs - 1, Math.floor(t * segs));
  const local = t * segs - s;
  return PACKET_X[s] + (PACKET_X[s + 1] - PACKET_X[s]) * local;
}

const EXIT_DUR = 620; // fork beat: packet rides the ok branch to the provider

// Plain-language descriptions for the interactive category chips.
const CATEGORY_DESC: Record<string, string> = {
  harmful_content: "Violent, hateful, or explicit material.",
  prompt_injection: "Attempts to override system or developer instructions.",
  secret_leakage: "API keys, tokens, or credentials in the content.",
  pii: "Personally identifiable information.",
  unsafe_output: "Responses that violate the configured policy.",
  data_disclosure: "Exposure of protected or internal data.",
  untrusted_instruction: "Instructions arriving from untrusted sources.",
  invalid_structure: "Malformed or unexpected request or response shape.",
  domain_violation: "Content outside approved domains or topics.",
  tool_action: "Risky or disallowed tool calls.",
};

// Compact segmented control used for scope/enforcement and request type.
function Segmented({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[0.7rem] font-semibold uppercase tracking-[0.1em] text-faint">
        {label}
      </span>
      <div role="group" aria-label={label} className="inline-flex rounded-full border border-line bg-surface-cool p-0.5">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            aria-pressed={value === o.value}
            onClick={() => onChange(o.value)}
            className={`rounded-full px-2.5 py-1 text-[0.72rem] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
              value === o.value ? "bg-surface text-ink shadow-xs" : "text-muted hover:text-ink"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function chevronD(x: number) {
  return `M ${x - 5} ${CY - 6} L ${x + 1} ${CY} L ${x - 5} ${CY + 6}`;
}

// Governance rail rows — a checklist beside the pipeline, not a card grid.
const RAIL: { icon: typeof IconKey; title: string; body: ReactNode }[] = [
  {
    icon: IconKey,
    title: "API key controls",
    body: "Issue per-application keys with masked values and set a max budget on each one.",
  },
  {
    icon: IconShield,
    title: "Configured guardrail policies",
    body: "Opt in to the protection categories you need — policies you create, not defaults forced on you.",
  },
  {
    icon: IconLayers,
    title: "Policy scope and enforcement",
    body: "Apply a policy globally or to a single API key, then choose monitor or block.",
  },
  {
    icon: IconDoc,
    title: "Prompt logging with retention",
    body: "Record prompts and responses, with retention you configure per workspace.",
  },
  {
    icon: IconOrg,
    title: "Workspaces and roles",
    body: "Organization isolation, team management, and role-based permissions on membership.",
  },
  {
    icon: IconChart,
    title: "Usage budgets",
    body: "Track spend against budgets so a runaway agent cannot burn through your quota.",
  },
];

export default function Security() {
  const revealRef = useRevealOnScroll();
  const [diagramRef, seen] = useInViewOnce<HTMLDivElement>(0.25);
  const reduced = useReducedMotion();
  const gridRef = useParallax<HTMLDivElement>(0.05);
  const [forced, setForced] = useState(false);
  // Fallback latch: if IntersectionObserver delivery is ever blocked,
  // scroll position still reveals the section (mirrors useRevealOnScroll).
  useEffect(() => {
    if (seen || forced || reduced) return;
    const check = () => {
      const el = diagramRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (r.top < window.innerHeight * 0.75 && r.bottom > 0) {
        window.removeEventListener("scroll", check);
        window.removeEventListener("resize", check);
        setForced(true);
      }
    };
    window.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check, { passive: true });
    check();
    return () => {
      window.removeEventListener("scroll", check);
      window.removeEventListener("resize", check);
    };
  }, [seen, forced, reduced, diagramRef]);
  const visible = seen || forced;
  const manualRef = useRef(false);
  const [scope, setScope] = useState<"global" | "api_key">("global");
  const [enforcement, setEnforcement] = useState<"monitor" | "block">("block");
  const [requestKind, setRequestKind] = useState<"safe" | "attack">("safe");
  const [simResult, setSimResult] = useState<"passed" | "blocked" | null>(null);
  const [run, setRun] = useState<{ kind: "safe" | "attack"; enforcement: "monitor" | "block"; n: number } | null>(
    null
  );
  const [category, setCategory] = useState<string | null>(null);

  // Pre-hide animated targets only when JS is alive and motion is allowed,
  // so reduced-motion and no-JS keep the complete static diagram.
  useLayoutEffect(() => {
    const root = diagramRef.current;
    if (!root || reduced) return;
    const faded: Element[] = [];
    const links = root.querySelector(".sec-links");
    if (links) faded.push(links);
    faded.push(...root.querySelectorAll(".sec-lit"));
    faded.push(...root.querySelectorAll(".sec-lit-exit"));
    faded.push(...root.querySelectorAll(".sec-row"));
    faded.push(...root.querySelectorAll(".sec-chip"));
    faded.push(...root.querySelectorAll(".sec-mnode"));
    const rails = root.querySelectorAll(".sec-rail");
    if (rails.length) utils.set(rails, { scaleY: 0 });
    const packet = root.querySelector(".sec-packet");
    const blocked = root.querySelector(".sec-blocked");
    const legend = root.querySelector(".sec-legend");
    if (packet) faded.push(packet);
    if (blocked) faded.push(blocked);
    if (legend) faded.push(legend);
    utils.set(faded, { opacity: 0 });
    return () => {
      utils.set(faded, { clear: "all" });
      if (rails.length) utils.set(rails, { clear: "all" });
    };
  }, [reduced, diagramRef]);

  // Entrance choreography (fires once in view): the pipeline draws
  // first, then the checklist waves in, then the legend's category
  // chips pop. Packet travel itself is scroll-linked (next effect).
  useEffect(() => {
    const root = diagramRef.current;
    if (!root || !visible || reduced) return;
    const cleanups: Array<() => void> = [];

    // 1) connectors + ok branch draw in; chevrons and the dashed
    // blocked branch fade with the group (dash-draw would flatten
    // its dashes solid, breaking parity with the static state)
    const links = root.querySelector(".sec-links");
    if (links) {
      const linksFade = animate(links, { ...fadeIn(450) });
      cleanups.push(() => linksFade.revert());
    }
    cleanups.push(drawSvgPaths(root, ".sec-draw", { duration: 750, staggerMs: 80 }));

    // packet fades in as the connectors land
    const packet = root.querySelector(".sec-packet");
    if (packet) {
      const fade = animate(packet, { opacity: [0, 1], duration: 400, delay: 850, ease: "outQuad" });
      cleanups.push(() => fade.revert());
    }

    // 2) checklist rows wave in slightly AFTER the pipeline starts
    const rows = Array.from(root.querySelectorAll<HTMLElement>(".sec-row"));
    if (rows.length) {
      const wave = animate(rows, {
        ...fadeUp(18, 560),
        delay: staggerReveal(60, { start: 620 }),
      });
      cleanups.push(() => wave.revert());
    }

    // 3) legend fades, then the category chips pop with a tiny stagger
    const legend = root.querySelector(".sec-legend");
    if (legend) {
      const lf = animate(legend, fadeIn(500));
      cleanups.push(() => lf.revert());
    }
    const chips = Array.from(root.querySelectorAll<HTMLElement>(".sec-chip"));
    if (chips.length) {
      const pop = animate(chips, {
        ...scaleReveal(0.92, 420),
        delay: staggerReveal(40, { start: 300 }),
      });
      cleanups.push(() => pop.revert());
    }

    // 4) mobile: rails draw down, steps fade in
    const rails = Array.from(root.querySelectorAll<HTMLElement>(".sec-rail"));
    if (rails.length) {
      const railAnim = animate(rails, {
        scaleY: [0, 1],
        duration: 700,
        delay: staggerReveal(80),
        ease: "outExpo",
      });
      cleanups.push(() => railAnim.revert());
    }
    const mnodes = Array.from(root.querySelectorAll<HTMLElement>(".sec-mnode"));
    if (mnodes.length) {
      const stepAnim = animate(mnodes, {
        opacity: [0, 1],
        y: [14, 0],
        duration: 520,
        delay: staggerReveal(80, { start: 60 }),
        ease: "outExpo",
      });
      cleanups.push(() => stepAnim.revert());
    }

    return () => cleanups.forEach((fn) => fn());
  }, [visible, reduced, diagramRef]);

  // Scroll-linked packet (desktop xl+ only). Own passive scroll
  // listener + rAF (rather than useScrollProgress's setState) so
  // per-frame work is attribute writes only, no React re-render.
  // Gates light cumulatively as the packet passes (calm, no flicker).
  // When the packet reaches the fork (travel t → 1) the outcomes
  // resolve ONCE — fire-once is calmer than a scroll-driven fork
  // that would reverse mid-beat on scroll-up.
  useEffect(() => {
    const root = diagramRef.current;
    if (!root || !visible || reduced) return;
    const wrap = root.querySelector<HTMLElement>(".sec-svgwrap");
    const packet = root.querySelector<SVGGElement>(".sec-packet");
    const lits = Array.from(root.querySelectorAll<SVGElement>(".sec-lit"));
    if (!wrap || !packet || lits.length !== CHECKPOINTS.length) return;

    const mq = window.matchMedia("(min-width: 1280px)");
    let raf = 0;
    let forked = false;
    const anims: Array<{ revert: () => void }> = [];

    const fork = () => {
      forked = true;
      const okPath = root.querySelector<SVGPathElement>(".sec-ok-branch");
      // a violating request drops onto the blocked branch…
      const blocked = root.querySelector(".sec-blocked");
      if (blocked) {
        anims.push(
          animate(blocked, { opacity: [0, 1], x: [918, 918], y: [166, 178], duration: 420, ease: "outExpo" })
        );
      }
      // …while the passing one rides the ok branch to the provider
      if (okPath) {
        const total = okPath.getTotalLength();
        const run = { p: 0 };
        anims.push(
          animate(run, {
            p: 1,
            duration: EXIT_DUR,
            ease: "inOutQuad",
            onUpdate: () => {
              const pt = okPath.getPointAtLength(run.p * total);
              packet.setAttribute("transform", `translate(${pt.x.toFixed(1)} ${pt.y.toFixed(1)})`);
            },
          })
        );
      }
      // exit ticks land just as the packet arrives at the provider
      const exitMarks = Array.from(root.querySelectorAll(".sec-lit-exit"));
      if (exitMarks.length) {
        anims.push(
          animate(exitMarks, {
            opacity: [0, 1],
            duration: 360,
            delay: okPath ? EXIT_DUR - 140 : 0,
            ease: "outQuad",
          })
        );
      }
    };

    const apply = () => {
      raf = 0;
      if (manualRef.current) return; // user simulation takes over the diagram
      if (!mq.matches || forked) return; // svg hidden below xl — skip the work
      const rect = wrap.getBoundingClientRect();
      const vh = window.innerHeight || 1;
      const raw = (vh - rect.top) / (vh + rect.height); // 0 → 1 crossing
      const t = Math.min(1, Math.max(0, (raw - TRAVEL_START) / (TRAVEL_END - TRAVEL_START)));
      const px = xAt(t);
      packet.setAttribute("transform", `translate(${px.toFixed(1)} ${CY})`);
      for (let i = 0; i < lits.length; i++) {
        if (px >= GATE_X[i] - 4) lits[i].style.opacity = "1"; // cumulative, stays lit
      }
      if (t >= 1) fork();
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
      anims.forEach((a) => a.revert());
      for (const lit of lits) lit.style.transition = "";
      packet.setAttribute("transform", `translate(${PACKET_X[0]} ${CY})`); // park at entry
    };
  }, [visible, reduced, diagramRef]);

  // Manual simulation: drives the same packet through the gates and lands
  // the chosen outcome. Once used, it owns the diagram (the scroll effect
  // stops writing) so the two never fight over the packet.
  useEffect(() => {
    if (!run) return;
    const root = diagramRef.current;
    if (!root) return;
    manualRef.current = true;

    const packet = root.querySelector<SVGGElement>(".sec-packet");
    const lits = Array.from(root.querySelectorAll<SVGElement>(".sec-lit"));
    const okGroup = root.querySelector<SVGGElement>(".sec-out-ok");
    const badGroup = root.querySelector<SVGGElement>(".sec-out-bad");
    const blocked = root.querySelector<SVGGElement>(".sec-blocked");
    const result: "passed" | "blocked" =
      run.kind === "attack" && run.enforcement === "block" ? "blocked" : "passed";

    if (packet) {
      utils.set(packet, { clear: "all" });
      utils.set(packet, { opacity: 1 });
      packet.setAttribute("transform", `translate(${PACKET_X[0]} ${CY})`);
    }
    for (const lit of lits) lit.style.opacity = "0";
    if (blocked) utils.set(blocked, { opacity: 0, clear: "all" });
    const groups = [okGroup, badGroup].filter((g): g is SVGGElement => !!g);
    if (groups.length) {
      utils.set(groups, { clear: "all" });
      utils.set(groups, { opacity: 1 });
    }

    const finish = () => {
      setSimResult(result);
      if (okGroup) utils.set(okGroup, { opacity: result === "passed" ? 1 : 0.3 });
      if (badGroup) utils.set(badGroup, { opacity: result === "blocked" ? 1 : 0.3 });
    };

    if (reduced) {
      for (const lit of lits) lit.style.opacity = "1";
      if (packet) packet.setAttribute("transform", `translate(${SPLIT_X} ${CY})`);
      if (result === "blocked" && blocked) utils.set(blocked, { opacity: 1, clear: "all" });
      finish();
      return;
    }

    const anims: Array<{ revert: () => void }> = [];
    const proxy = { t: 0 };
    const tl = createTimeline({ defaults: { ease: "inOutQuad" } });
    tl.add(proxy, {
      t: 1,
      duration: 1250,
      onUpdate: () => {
        const px = xAt(proxy.t);
        if (packet) packet.setAttribute("transform", `translate(${px.toFixed(1)} ${CY})`);
        for (let i = 0; i < lits.length; i++) {
          if (px >= GATE_X[i] - 4) lits[i].style.opacity = "1";
        }
      },
    });

    const timer = window.setTimeout(() => {
      finish();
      if (result === "blocked") {
        if (packet) {
          anims.push(animate(packet, { opacity: [1, 0], duration: 260, ease: "outQuad" }));
        }
        if (blocked) {
          anims.push(
            animate(blocked, {
              opacity: [0, 1],
              y: [160, 178],
              duration: 420,
              ease: "outExpo",
            })
          );
        }
      } else {
        const okPath = root.querySelector<SVGPathElement>(".sec-ok-branch");
        if (okPath && packet) {
          const total = okPath.getTotalLength();
          const ride = { p: 0 };
          anims.push(
            animate(ride, {
              p: 1,
              duration: 620,
              ease: "inOutQuad",
              onUpdate: () => {
                const pt = okPath.getPointAtLength(ride.p * total);
                packet.setAttribute("transform", `translate(${pt.x.toFixed(1)} ${pt.y.toFixed(1)})`);
              },
            })
          );
        }
      }
    }, 1280);

    return () => {
      window.clearTimeout(timer);
      anims.forEach((a) => a.revert());
      tl.revert();
    };
  }, [run, reduced]);

  const desc =
    "A request passes four security checkpoints: the API key is authenticated, " +
    "the policy scope is resolved as global or per API key, the configured " +
    "guardrail protection categories are evaluated, and the prompt is logged " +
    "with retention. Under block enforcement a violating request stops at the " +
    "gateway; otherwise it passes through to the provider.";

  return (
    <Section id="security" tone="cool">
      <Container width="wide">
        <div ref={revealRef as RefObject<HTMLDivElement | null>}>
          <SectionHeading
            eyebrow="Security and governance"
            title="Your policies, enforced at the gateway"
            lead="API keys, guardrail policies, prompt logs, and budgets all live in your self-hosted workspace. You choose which protection categories a policy checks, whether it applies globally or to one key, and whether it only monitors or actually blocks."
          />

          <div
            ref={diagramRef}
            className="mt-12 grid gap-8 xl:grid-cols-[minmax(0,1fr)_22rem] xl:items-stretch"
          >
            <div className="flex min-w-0 flex-col gap-6">
              {/* --- horizontal pipeline (xl+), depth card with parallax grid --- */}
              <div className="hidden xl:block">
                <div className="relative overflow-hidden rounded-xl border border-line bg-surface shadow-sm transition-shadow duration-[var(--dur-base)] ease-[var(--ease-out-expo)] hover:shadow-md">
                  <div
                    ref={gridRef}
                    aria-hidden="true"
                    className="pointer-events-none absolute -inset-4 opacity-60"
                    style={{
                      backgroundImage: "radial-gradient(var(--color-line) 1px, transparent 1px)",
                      backgroundSize: "26px 26px",
                    }}
                  />
                  <div className="sec-svgwrap relative px-5 py-7 sm:px-7">
                    <svg
                      viewBox={`0 0 ${VW} ${VH}`}
                      className="block h-auto w-full"
                      role="img"
                      aria-labelledby="sec-title sec-desc"
                    >
                      <title id="sec-title">Security checkpoints for a gateway request</title>
                      <desc id="sec-desc">{desc}</desc>

                      {/* connectors, chevrons, branches (drawn on scroll into view) */}
                      <g className="sec-links" fill="none" aria-hidden="true">
                        {SEGMENTS.map(([a, b], i) => (
                          <path
                            key={`seg-${i}`}
                            className="sec-draw"
                            d={`M ${a} ${CY} L ${b} ${CY}`}
                            stroke="var(--color-line-strong)"
                            strokeWidth="2"
                            strokeLinecap="round"
                          />
                        ))}
                        {SEGMENTS.map(([a, b], i) => (
                          <path
                            key={`chev-${i}`}
                            d={chevronD((a + b) / 2)}
                            stroke="var(--color-faint)"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        ))}
                        <path
                          className="sec-draw sec-ok-branch"
                          d={OK_BRANCH}
                          stroke="var(--color-ok)"
                          strokeWidth="2"
                          strokeLinecap="round"
                        />
                        <path
                          d={BAD_BRANCH}
                          stroke="var(--color-danger)"
                          strokeWidth="2"
                          strokeDasharray="6 6"
                          strokeLinecap="round"
                        />
                      </g>

                      {/* enforcement fork label */}
                      <text
                        x="892"
                        y="110"
                        textAnchor="middle"
                        fontSize="11"
                        fontWeight="600"
                        fill="var(--color-faint)"
                        aria-hidden="true"
                      >
                        enforcement
                      </text>

                      {/* entry node */}
                      <g aria-hidden="true">
                        <rect
                          x="44"
                          y={CY - 14}
                          width="28"
                          height="28"
                          rx="8"
                          fill="var(--color-surface)"
                          stroke="var(--color-line-strong)"
                          strokeWidth="1.5"
                        />
                        <circle cx="58" cy={CY} r="4" fill="var(--color-brand)" />
                        <text
                          x="58"
                          y={CY + 40}
                          textAnchor="middle"
                          fontSize="12.5"
                          fill="var(--color-muted)"
                        >
                          Request
                        </text>
                      </g>

                      {/* checkpoints: gate column + two-line label.
                          Hover ring + label emphasis are decorative — the
                          SVG is role="img"; full text lives in the
                          checklist rail and the mobile list. */}
                      {CHECKPOINTS.map((cp, i) => {
                        const gx = GATE_X[i];
                        return (
                          <g key={cp.full} className="group" aria-hidden="true">
                            <text
                              x={gx}
                              y={CY - 58}
                              textAnchor="middle"
                              fontSize="11"
                              fontWeight="700"
                              letterSpacing="0.08em"
                              fill="var(--color-faint)"
                            >
                              {`0${i + 1}`}
                            </text>
                            <g className="sec-gate">
                              <rect
                                x={gx - 7}
                                y={CY - 45}
                                width="14"
                                height="90"
                                rx="7"
                                fill="var(--color-surface)"
                                stroke="var(--color-line-strong)"
                                strokeWidth="1.5"
                              />
                              <rect
                                className="sec-lit"
                                x={gx - 7}
                                y={CY - 45}
                                width="14"
                                height="90"
                                rx="7"
                                fill="var(--color-brand-soft)"
                                stroke="var(--color-brand)"
                                strokeWidth="1.8"
                                opacity="0"
                              />
                              <rect
                                x={gx - 11}
                                y={CY - 49}
                                width="22"
                                height="98"
                                rx="11"
                                fill="none"
                                stroke="var(--color-brand)"
                                strokeWidth="1.5"
                                className="opacity-0 transition-opacity duration-[var(--dur-fast)] ease-[var(--ease-out-expo)] group-hover:opacity-60"
                              />
                            </g>
                            <g
                              fontSize="12.5"
                              textAnchor="middle"
                              className="fill-muted transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out-expo)] group-hover:fill-ink"
                            >
                              <text x={gx} y={CY + 64}>
                                {cp.label[0]}
                              </text>
                              <text x={gx} y={CY + 80}>
                                {cp.label[1]}
                              </text>
                            </g>
                          </g>
                        );
                      })}

                      {/* exits: passed (ok) and blocked (danger) */}
                      <g className="sec-out-ok" aria-hidden="true">
                        <text
                          x={OK.x}
                          y="38"
                          textAnchor="middle"
                          fontSize="12"
                          fontWeight="700"
                          letterSpacing="0.12em"
                          fill="var(--color-ok)"
                        >
                          PASSED
                        </text>
                        <text x={OK.x} y="54" textAnchor="middle" fontSize="12" fill="var(--color-muted)">
                          to the provider
                        </text>
                        <circle
                          cx={OK.x}
                          cy={OK.y}
                          r="16"
                          fill="var(--color-ok-soft)"
                          stroke="var(--color-ok)"
                          strokeWidth="1.8"
                        />
                        <path
                          className="sec-lit-exit"
                          d={`M ${OK.x - 7} ${OK.y} l 5 5 l 9 -10`}
                          fill="none"
                          stroke="var(--color-ok)"
                          strokeWidth="2.2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          opacity="1"
                        />
                      </g>
                      <g className="sec-out-bad" aria-hidden="true">
                        <circle
                          cx={BAD.x}
                          cy={BAD.y}
                          r="16"
                          fill="var(--color-danger-soft)"
                          stroke="var(--color-danger)"
                          strokeWidth="1.8"
                        />
                        <path
                          className="sec-lit-exit"
                          d={`M ${BAD.x - 5} ${BAD.y - 5} l 10 10 M ${BAD.x + 5} ${BAD.y - 5} l -10 10`}
                          fill="none"
                          stroke="var(--color-danger)"
                          strokeWidth="2.2"
                          strokeLinecap="round"
                          opacity="1"
                        />
                        <text
                          x={BAD.x}
                          y={BAD.y + 40}
                          textAnchor="middle"
                          fontSize="12"
                          fontWeight="700"
                          letterSpacing="0.12em"
                          fill="var(--color-danger)"
                        >
                          BLOCKED
                        </text>
                        <text
                          x={BAD.x}
                          y={BAD.y + 56}
                          textAnchor="middle"
                          fontSize="12"
                          fill="var(--color-muted)"
                        >
                          at the gateway
                        </text>
                      </g>

                      {/* passing request — parked at entry in the static state */}
                      <g className="sec-packet" transform={`translate(${PACKET_X[0]} ${CY})`} aria-hidden="true">
                        <circle r="11" fill="var(--color-brand-soft)" />
                        <circle r="6" fill="var(--color-brand)" />
                      </g>
                      {/* violating request — stopped on the blocked branch */}
                      <g className="sec-blocked" transform="translate(918 178)" aria-hidden="true">
                        <circle r="8.5" fill="var(--color-danger-soft)" />
                        <circle r="4.5" fill="var(--color-danger)" />
                      </g>
                    </svg>
                  </div>
                </div>
              </div>

              {/* --- vertical checkpoints (below xl) --- */}
              <ol className="relative mx-auto max-w-2xl xl:hidden">
                {CHECKPOINTS.map((cp, i) => (
                  <li key={cp.full} className="sec-mnode relative flex gap-4 pb-6 last:pb-0">
                    {i < CHECKPOINTS.length - 1 && (
                      <span
                        className="sec-rail absolute left-4 top-8 bottom-0 w-px bg-line-strong"
                        style={{ transformOrigin: "top" }}
                        aria-hidden="true"
                      />
                    )}
                    <span className="relative z-10 grid h-8 w-8 shrink-0 place-items-center rounded-full border border-line-strong bg-surface text-[0.8rem] font-semibold text-brand">
                      {i + 1}
                    </span>
                    <p className="pt-1.5 text-sm leading-6 text-ink-soft">{cp.full}</p>
                  </li>
                ))}
                <li className="sec-mnode mt-2 flex flex-col items-start gap-2 pl-12">
                  <Badge tone="ok" className="max-w-full break-words text-left">Block enforcement: violation stops at the gateway</Badge>
                  <Badge tone="neutral" className="max-w-full break-words text-left">Monitor enforcement: request passes, event recorded</Badge>
                </li>
              </ol>

              {/* --- simulation controls --- */}
              <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="eyebrow">Preview the pipeline</p>
                  <span className="rounded-full border border-line bg-surface-cool px-2 py-0.5 text-[0.62rem] font-semibold uppercase tracking-[0.08em] text-faint">
                    simulated
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2.5">
                  <Segmented
                    label="Scope"
                    options={[
                      { value: "global", label: "Global" },
                      { value: "api_key", label: "API key" },
                    ]}
                    value={scope}
                    onChange={(v) => setScope(v === "api_key" ? "api_key" : "global")}
                  />
                  <Segmented
                    label="Enforcement"
                    options={[
                      { value: "monitor", label: "Monitor" },
                      { value: "block", label: "Block" },
                    ]}
                    value={enforcement}
                    onChange={(v) => setEnforcement(v === "monitor" ? "monitor" : "block")}
                  />
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
                  <Segmented
                    label="Request"
                    options={[
                      { value: "safe", label: "Safe request" },
                      { value: "attack", label: "Prompt injection" },
                    ]}
                    value={requestKind}
                    onChange={(v) => setRequestKind(v === "attack" ? "attack" : "safe")}
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setRun({ kind: requestKind, enforcement, n: Date.now() })
                    }
                    className="inline-flex h-9 items-center rounded-full bg-brand px-4 text-sm font-medium text-white transition-colors hover:bg-brand-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                  >
                    Run simulation
                  </button>
                </div>
                <p
                  aria-live="polite"
                  className="mt-3 min-h-[2.5rem] text-sm leading-5 text-muted"
                >
                  {simResult === "blocked" ? (
                    <span>
                      <span className="font-medium text-danger-ink">Blocked at the gateway</span> — the
                      violating request never reaches the provider.
                    </span>
                  ) : simResult === "passed" ? (
                    run?.kind === "attack" ? (
                      <span>
                        <span className="font-medium text-ok-ink">Passed with the event recorded</span> —
                        monitor enforcement does not stop the request.
                      </span>
                    ) : (
                      <span>
                        <span className="font-medium text-ok-ink">Passed to the provider</span> — usage and
                        the prompt log are recorded.
                      </span>
                    )
                  ) : (
                    "Choose a request and run it to see the decision."
                  )}
                </p>
                <p className="mt-1 text-xs text-faint">
                  Policy scope:{" "}
                  {scope === "global"
                    ? "every key in the workspace"
                    : "this API key only"}
                  {" · "}Enforcement: {enforcement}.
                </p>
              </div>

              {/* --- protection categories (interactive reference) --- */}
              <div className="sec-legend rounded-2xl border border-line bg-surface p-5 shadow-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="eyebrow">Protection categories</p>
                  <p className="text-xs text-faint">The exact set a policy can check</p>
                </div>
                <ul className="mt-3 flex flex-wrap gap-1.5">
                  {GUARDRAIL_CATEGORIES.map((c) => (
                    <li key={c} translate="no">
                      <button
                        type="button"
                        aria-pressed={category === c}
                        onMouseEnter={() => setCategory(c)}
                        onFocus={() => setCategory(c)}
                        onClick={() => setCategory(c)}
                        className={`sec-chip rounded-md border px-2 py-1 font-mono text-[0.7rem] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
                          category === c
                            ? "border-brand bg-brand-soft text-brand-strong"
                            : "border-line bg-surface-cool text-ink-soft hover:border-brand/40 hover:text-ink"
                        }`}
                      >
                        {c}
                      </button>
                    </li>
                  ))}
                </ul>
                <p aria-live="polite" className="mt-3 min-h-[2.5rem] text-sm leading-5 text-muted">
                  {category
                    ? CATEGORY_DESC[category]
                    : "Hover, focus, or tap a category to see what it checks."}
                </p>
                <p className="mt-2 text-[0.75rem] text-faint">
                  Policies are opt-in — you choose the categories and enforcement per policy.
                </p>
              </div>
            </div>

            {/* --- governance checklist rail (waves in after the pipeline starts) --- */}
            <div className="flex h-full flex-col rounded-2xl border border-line bg-surface p-6 shadow-sm">
              <p className="eyebrow">Governance controls</p>
              <ul className="mt-4 flex flex-1 flex-col justify-between divide-y divide-line">
                {RAIL.map(({ icon: Icon, title, body }) => (
                  <li key={title} className="sec-row -mx-2 flex gap-3 rounded-lg px-2 py-3.5 transition-colors hover:bg-surface-cool first:pt-0 last:pb-0">
                    <Icon className="mt-0.5 shrink-0 text-brand" size={20} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-ink">{title}</p>
                      <p className="mt-0.5 text-[0.82rem] leading-5 text-muted">{body}</p>
                    </div>
                  </li>
                ))}
              </ul>

              <p className="mt-auto border-t border-line pt-4 text-[0.78rem] leading-5 text-faint">
                Guardrails are opt-in: a policy checks the categories you choose and
                applies the enforcement you set.
              </p>
            </div>
          </div>
        </div>
      </Container>
    </Section>
  );
}
