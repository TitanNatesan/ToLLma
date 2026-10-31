"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Container, Section, SectionHeading } from "@/components/ui/layout";
import { Badge } from "@/components/ui/primitives";
import {
  IconActivity,
  IconChart,
  IconDoc,
  IconGateway,
  IconKey,
  IconLayers,
  IconOrg,
  IconShield,
  IconTerminal,
} from "@/components/ui/icons";
import {
  animate,
  animatePackets,
  createTimeline,
  drawSvgPaths,
  fadeUp,
  staggerReveal,
  useInViewOnce,
  usePointerTilt,
  useReducedMotion,
  utils,
} from "@/lib/animations";
import { GATEWAY_BASE, GUARDRAIL_CATEGORIES, PROVIDERS } from "@/lib/site";

/* ---------------------------------------------------------------
   Tile shell — asymmetric spans live on `span`, never uniform.
   Hover depth: --shadow-xs → --shadow-sm, line → brand-soft border.
---------------------------------------------------------------- */
function Tile({
  span,
  icon,
  title,
  desc,
  children,
}: {
  span: string;
  icon: ReactNode;
  title: string;
  desc: string;
  children: ReactNode;
}) {
  return (
    <div
      data-reveal
      className={`group flex min-w-0 flex-col rounded-2xl border border-line bg-surface p-6 shadow-xs transition-[border-color,box-shadow] duration-300 hover:border-brand-soft hover:shadow-sm focus-within:border-brand-soft focus-within:shadow-sm sm:p-7 ${span}`}
    >
      <div className="mb-5 flex items-start gap-3.5">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-line bg-brand-soft text-brand-strong transition-colors duration-300 group-hover:border-brand-soft">
          {icon}
        </span>
        <div className="min-w-0">
          <h3
            className="font-semibold tracking-tight text-ink"
            style={{ fontSize: "var(--t-h3)", lineHeight: 1.25 }}
          >
            {title}
          </h3>
          <p className="mt-1 text-sm text-muted" style={{ lineHeight: 1.55 }}>
            {desc}
          </p>
        </div>
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/* ---------------------------------------------------------------
   1. Gateway — animated request flow: app → hub → providers
---------------------------------------------------------------- */
const PROVIDER_CHIPS = ["OpenAI", "Anthropic", "Gemini", "Bedrock"];
const FAN_ROWS = [20, 62, 108, 150];

function GatewayFlow() {
  const [ref, seen] = useInViewOnce<SVGSVGElement>(0.3);
  const reduced = useReducedMotion();
  const hubPathRef = useRef<SVGPathElement | null>(null);
  const packetRefs = useRef<Array<SVGCircleElement | null>>([]);

  useEffect(() => {
    const svgEl = ref.current;
    const path = hubPathRef.current;
    if (!svgEl || !path || !seen || reduced) return;
    const packets = packetRefs.current.filter((p): p is SVGCircleElement => !!p);
    // Packets live at the SVG origin: animatePackets positions them with an
    // absolute translate(x, y), so any cx/cy would double-offset them.
    // Hidden until the animation starts (also keeps no-JS/reduced static).
    utils.set(packets, { opacity: 1 });
    const stopPackets = animatePackets(path, packets, { duration: 2600, staggerMs: 850 });
    const stopDraw = drawSvgPaths(svgEl, ".fan-line", { duration: 900, staggerMs: 140, delay: 200 });
    return () => {
      stopPackets.revert();
      stopDraw();
      packets.forEach((pkt) => pkt.removeAttribute("transform"));
      utils.set(packets, { opacity: 0 });
    };
  }, [ref, seen, reduced]);

  return (
    <svg
      ref={ref}
      viewBox="0 0 460 206"
      className="h-auto w-full"
      role="img"
      aria-label="Requests flow from your app through the ToLLma gateway out to every connected provider"
    >
      {/* client node */}
      <circle cx="26" cy="85" r="9" className="fill-brand-soft stroke-brand" strokeWidth="1.6" />
      <text x="26" y="112" textAnchor="middle" className="fill-muted" fontSize="10">
        your app
      </text>

      {/* request path + packets */}
      <path d="M40 85 H 186" className="stroke-line-strong" strokeWidth="1.6" fill="none" />
      <path ref={hubPathRef} d="M40 85 H 186" className="stroke-none" fill="none" />
      {[0, 1].map((i) => (
        <circle
          key={i}
          ref={(el) => {
            packetRefs.current[i] = el;
          }}
          r="3.5"
          cx={0}
          cy={0}
          opacity={0}
          className="fill-brand"
        />
      ))}
      <text x="113" y="72" textAnchor="middle" className="fill-faint" fontSize="9.5">
        POST /v1/chat/completions
      </text>

      {/* gateway hub */}
      <rect x="186" y="58" width="88" height="54" rx="12" className="fill-brand-soft stroke-brand" strokeWidth="1.6" />
      <text x="230" y="82" textAnchor="middle" className="fill-brand-strong" fontSize="11.5" fontWeight="600">
        Gateway
      </text>
      <text x="230" y="97" textAnchor="middle" className="fill-brand-strong" fontSize="9" opacity={0.7}>
        one API key
      </text>

      {/* fan-out */}
      {FAN_ROWS.map((y) => (
        <path
          key={y}
          d={`M274 85 C 320 85, 320 ${y + 15}, 356 ${y + 15}`}
          className="fan-line stroke-line-strong"
          strokeWidth="1.4"
          fill="none"
        />
      ))}
      {FAN_ROWS.map((y, i) => (
        <g key={`chip-${y}`}>
          <rect x="356" y={y} width="94" height="30" rx="8" className="fill-surface-cool stroke-line" strokeWidth="1.2" />
          <circle cx="370" cy={y + 15} r="3" className={i === 0 ? "fill-teal" : i === 1 ? "fill-violet" : "fill-brand"} />
          <text x="381" y={y + 19} className="fill-ink-soft" fontSize="10.5">
            {PROVIDER_CHIPS[i]}
          </text>
        </g>
      ))}
      <text x="403" y="198" textAnchor="middle" className="fill-faint" fontSize="9">
        + Vertex · Custom
      </text>
    </svg>
  );
}

/* ---------------------------------------------------------------
   2. API keys — credential card, masked value, budget bar
   Pointer tilt (3°) on the whole stack — desktop fine pointers only.
---------------------------------------------------------------- */
function KeyCard() {
  const [ref, seen] = useInViewOnce<HTMLDivElement>(0.4);
  const reduced = useReducedMotion();
  const tiltRef = usePointerTilt<HTMLDivElement>(3);
  const barRef = useRef<HTMLDivElement | null>(null);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    const bar = barRef.current;
    if (!bar || !seen || reduced) return;
    utils.set(bar, { scaleX: 0, transformOrigin: "0% 50%" });
    const a = animate(bar, { scaleX: 0.62, duration: 1100, ease: "outExpo", delay: 250 });
    return () => {
      a.revert();
      utils.set(bar, { clear: "all" });
    };
  }, [seen, reduced]);

  return (
    <div ref={tiltRef} className="h-full">
      <div ref={ref} className="flex h-full flex-col justify-center gap-3">
        <div className="rounded-xl border border-line bg-surface-cool p-4">
          <div className="flex items-center justify-between gap-3">
            <span className="truncate text-xs font-medium text-ink-soft">production-agent</span>
            <Badge tone="ok">active</Badge>
          </div>
          <div className="mt-2 flex items-center justify-between gap-2">
            <p className="min-w-0 truncate font-mono text-[0.8rem] text-muted">
              {revealed ? "sk-tollma-demo-4f2a" : "sk-tollma-••••••••••4f2a"}
            </p>
            <button
              type="button"
              aria-pressed={revealed}
              onClick={() => setRevealed((v) => !v)}
              className="shrink-0 rounded-md px-1.5 py-0.5 text-[0.68rem] font-medium text-brand transition-colors hover:text-brand-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
              {revealed ? "Hide" : "Reveal"}
            </button>
          </div>
        </div>
        <div className="rounded-xl border border-line p-4">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="font-medium text-ink-soft">Monthly budget</span>
            <span className="text-faint">resets in 12d</span>
          </div>
          <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-surface-tint">
            <div ref={barRef} className="h-full w-full rounded-full bg-gradient-to-r from-brand to-teal" />
          </div>
          <p className="mt-2 text-xs text-muted">Hitting the limit pauses the key.</p>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------
   3. Guardrails — INTERACTIVE simulation: toggle categories, then
   send a sample request through the gate. The sample request trips
   prompt_injection + secret_leakage (if those are on) → BLOCKED.
   Buttons + aria-pressed; reduced motion resolves instantly.
---------------------------------------------------------------- */
const GUARD_ROWS = GUARDRAIL_CATEGORIES.slice(0, 6);
// Categories a hostile sample request would trip (simulation only).
const DEMO_TRIGGERS = ["prompt_injection", "secret_leakage"];
const DEFAULT_ACTIVE = ["harmful_content", "prompt_injection", "secret_leakage", "pii"];

const humanize = (s: string) =>
  s
    .split("_")
    .map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ");

function GuardrailGate() {
  const [ref, seen] = useInViewOnce<HTMLDivElement>(0.35);
  const reduced = useReducedMotion();
  const [active, setActive] = useState<Set<string>>(() => new Set(DEFAULT_ACTIVE));
  const [outcome, setOutcome] = useState<"blocked" | "passed" | null>(null);
  const [matched, setMatched] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const chipRef = useRef<HTMLDivElement | null>(null);
  const badgeRef = useRef<HTMLSpanElement | null>(null);
  const tlRef = useRef<ReturnType<typeof createTimeline> | null>(null);
  const autoRan = useRef(false);

  const toggle = (cat: string) => {
    // Cancel any in-flight run so a mid-flight toggle can't land a stale verdict.
    tlRef.current?.revert();
    tlRef.current = null;
    setRunning(false);
    setOutcome(null); // stale result clears until the next run
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const run = () => {
    if (running) return;
    const hits = DEMO_TRIGGERS.filter((c) => active.has(c));
    setMatched(hits);
    const result: "blocked" | "passed" = hits.length ? "blocked" : "passed";
    const chip = chipRef.current;
    const badge = badgeRef.current;
    // Reduced motion (or missing refs): functional, just no animation.
    if (reduced || !chip || !badge) {
      setOutcome(result);
      return;
    }
    setRunning(true);
    setOutcome(null);
    tlRef.current?.revert();
    tlRef.current = null;
    utils.set(chip, { x: 0, opacity: 1 });
    utils.set(badge, { opacity: 0 });
    const tl = createTimeline({ defaults: { ease: "outExpo" } });
    tl.add(chip, { x: 118, duration: 900 })
      .add(
        badge,
        {
          opacity: 1,
          duration: 250,
          onBegin: () => {
            setOutcome(result);
            setRunning(false);
          },
        },
        "+=120"
      )
      .add(chip, { opacity: 0, duration: 300 }, "+=400");
    tlRef.current = tl;
  };

  // One-shot demo run the first time the tile is seen (resolves instantly
  // when reduced motion is preferred).
  useEffect(() => {
    if (!seen || autoRan.current) return;
    autoRan.current = true;
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seen]);

  // Cleanup any in-flight timeline on unmount.
  useEffect(() => {
    return () => {
      tlRef.current?.revert();
    };
  }, []);

  return (
    <div ref={ref} className="flex h-full flex-col gap-3.5">
      {/* simulated request travelling across the gate */}
      <div className="relative h-9 overflow-hidden">
        <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-line" aria-hidden="true" />
        <div
          ref={chipRef}
          className="absolute left-0 top-1/2 flex -translate-y-1/2 items-center rounded-full border border-brand-soft bg-surface px-3 py-1.5 shadow-sm"
        >
          <span className="font-mono text-[0.7rem] text-ink-soft">request</span>
        </div>
        <span
          ref={badgeRef}
          aria-hidden={outcome === null}
          style={{ opacity: outcome === null ? 0 : undefined }}
          className={`absolute right-0 top-1/2 -translate-y-1/2 rounded-full border px-2.5 py-1 text-[0.7rem] font-semibold ${
            outcome === "blocked" ? "border-danger/25 bg-danger-soft text-danger-ink" : "border-ok-soft bg-ok-soft text-ok-ink"
          }`}
        >
          {outcome === "blocked" ? "BLOCKED" : outcome === "passed" ? "PASSED" : ""}
        </span>
      </div>

      {/* result caption — clearly a simulation */}
      <p aria-live="polite" className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
        <Badge tone="neutral">simulated</Badge>
        {outcome === "blocked" && (
          <span className="text-danger-ink">matched: {matched.map(humanize).join(" · ")}</span>
        )}
        {outcome === "passed" && <span>no active category matched</span>}
        {outcome === null && <span className="text-faint">toggle categories, then send the sample request</span>}
      </p>

      {/* policy toggles — real buttons */}
      <ul className="grid gap-1.5">
        {GUARD_ROWS.map((cat) => {
          const on = active.has(cat);
          return (
            <li key={cat}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() => toggle(cat)}
                className={`flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
                  on
                    ? "border-brand-soft bg-brand-soft text-ink"
                    : "border-line bg-surface-cool text-muted hover:border-line-strong hover:text-ink-soft"
                }`}
              >
                <span className="truncate text-xs font-medium">{humanize(cat)}</span>
                <span
                  className={`relative h-4 w-7 shrink-0 rounded-full transition-colors duration-200 ${
                    on ? "bg-brand" : "bg-line-strong"
                  }`}
                  aria-hidden="true"
                >
                  <span
                    className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all duration-200 ${
                      on ? "left-3.5" : "left-0.5"
                    }`}
                  />
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <button
        type="button"
        onClick={run}
        disabled={running}
        className="inline-flex w-full items-center justify-center rounded-lg bg-brand px-3.5 py-2 text-xs font-semibold text-white transition-opacity duration-200 hover:opacity-90 disabled:opacity-60"
      >
        {running ? "Running…" : "Send request"}
      </button>

      <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-1">
        <Badge tone="neutral">monitor</Badge>
        <Badge tone="neutral">block</Badge>
        <Badge tone="neutral">global</Badge>
        <Badge tone="neutral">per key</Badge>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------
   4. Usage & cost — animated token/cost bars, hover lifts the column
   and reveals its series label (illustrative data, no invented metrics).
---------------------------------------------------------------- */
const BARS = [
  { h: 34, cost: false },
  { h: 52, cost: true },
  { h: 44, cost: false },
  { h: 68, cost: true },
  { h: 58, cost: false },
  { h: 86, cost: true },
  { h: 72, cost: false },
  { h: 96, cost: true },
];

function UsageChart() {
  const [ref, seen] = useInViewOnce<HTMLDivElement>(0.4);
  const reduced = useReducedMotion();
  const barRefs = useRef<Array<HTMLDivElement | null>>([]);

  useEffect(() => {
    if (!seen || reduced) return;
    const bars = barRefs.current.filter((b): b is HTMLDivElement => !!b);
    utils.set(bars, { scaleY: 0, transformOrigin: "50% 100%" });
    const a = animate(bars, {
      scaleY: [0, 1],
      duration: 800,
      delay: staggerReveal(70),
      ease: "outExpo",
    });
    return () => {
      a.revert();
      utils.set(bars, { clear: "all" });
    };
  }, [seen, reduced]);

  return (
    <div ref={ref} className="flex h-full min-h-0 flex-col gap-4">
      <div
        role="img"
        aria-label="Illustrative chart comparing token and cost series"
        className="flex min-h-[170px] flex-1 items-end gap-2 border-b border-line pb-1 sm:gap-3"
      >
        {BARS.map((bar, i) => (
          <div
            key={i}
            title={bar.cost ? "Cost — illustrative series" : "Tokens — illustrative series"}
            className="group relative flex h-full flex-1 origin-bottom items-end transition-transform duration-[var(--dur-fast)] hover:scale-[1.05]"
          >
            <span className="pointer-events-none absolute left-1/2 top-0 z-10 -translate-x-1/2 whitespace-nowrap rounded-md border border-line bg-surface px-1.5 py-0.5 text-[0.62rem] font-medium text-ink-soft opacity-0 shadow-sm transition-opacity duration-200 group-hover:opacity-100">
              {bar.cost ? "cost" : "tokens"}
            </span>
            <div
              ref={(el) => {
                barRefs.current[i] = el;
              }}
              className={`w-full rounded-t-md transition-[filter] duration-200 group-hover:brightness-105 ${
                bar.cost ? "bg-teal/70" : "bg-brand/80"
              }`}
              style={{ height: `${bar.h}%` }}
            />
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3 text-xs text-muted">
        <span className="flex items-center gap-4">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm bg-brand/80" aria-hidden="true" />
            Tokens
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm bg-teal/70" aria-hidden="true" />
            Cost
          </span>
        </span>
        <span className="text-faint">per key · per model · per org</span>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------
   5. Prompt logging — request timeline / metadata rows
---------------------------------------------------------------- */
const LOG_ROWS = [
  { id: "log_7c2f", meta: "openai · streaming · tools" },
  { id: "log_7c31", meta: "anthropic · prompt + completion" },
  { id: "log_7c38", meta: "gemini · retention applied" },
];

function LogTimeline() {
  const [ref, seen] = useInViewOnce<HTMLOListElement>(0.4);
  const reduced = useReducedMotion();

  useEffect(() => {
    const root = ref.current;
    if (!root || !seen || reduced) return;
    const rows = root.querySelectorAll("[data-log-row]");
    const a = animate(rows, {
      opacity: [0, 1],
      x: [-10, 0],
      duration: 550,
      delay: staggerReveal(110),
      ease: "outExpo",
    });
    return () => {
      a.revert();
    };
  }, [ref, seen, reduced]);

  return (
    <ol ref={ref} className="relative flex flex-col gap-2.5 border-l border-line pl-4">
      {LOG_ROWS.map((row, i) => (
        <li key={row.id} data-log-row className="relative min-w-0">
          <span
            className={`absolute -left-[21px] top-2 h-2 w-2 rounded-full ${i === 0 ? "bg-brand" : "bg-line-strong"}`}
            aria-hidden="true"
          />
          <p className="truncate font-mono text-[0.78rem] text-ink-soft">{row.id}</p>
          <p className="truncate text-xs text-muted">{row.meta}</p>
        </li>
      ))}
    </ol>
  );
}

/* ---------------------------------------------------------------
   6. Organizations — workspace hierarchy
---------------------------------------------------------------- */
function OrgTree() {
  const [ref, seen] = useInViewOnce<SVGSVGElement>(0.4);
  const reduced = useReducedMotion();

  useEffect(() => {
    const svgEl = ref.current;
    if (!svgEl || !seen || reduced) return;
    const stopDraw = drawSvgPaths(svgEl, ".org-line", { duration: 800, staggerMs: 120 });
    const boxes = svgEl.querySelectorAll(".org-node");
    const a = animate(boxes, {
      opacity: [0, 1],
      duration: 500,
      delay: staggerReveal(90, { start: 250 }),
      ease: "outExpo",
    });
    return () => {
      stopDraw();
      a.revert();
    };
  }, [ref, seen, reduced]);

  return (
    <svg
      ref={ref}
      viewBox="0 0 260 164"
      className="h-auto w-full"
      role="img"
      aria-label="An organization containing teams, each with their own members"
    >
      <rect x="85" y="6" width="90" height="28" rx="8" className="org-node fill-brand-soft stroke-brand" strokeWidth="1.4" />
      <text x="130" y="24" textAnchor="middle" className="fill-brand-strong" fontSize="10.5" fontWeight="600">
        Organization
      </text>

      <path
        d="M130 34 V 52 M 60 52 H 200 M 60 52 V 70 M 200 52 V 70"
        className="org-line stroke-line-strong"
        strokeWidth="1.4"
        fill="none"
      />

      <rect x="14" y="70" width="92" height="26" rx="7" className="org-node fill-surface-cool stroke-line" strokeWidth="1.3" />
      <text x="60" y="87" textAnchor="middle" className="fill-ink-soft" fontSize="10">
        Team · agents
      </text>
      <rect x="154" y="70" width="92" height="26" rx="7" className="org-node fill-surface-cool stroke-line" strokeWidth="1.3" />
      <text x="200" y="87" textAnchor="middle" className="fill-ink-soft" fontSize="10">
        Team · research
      </text>

      <path
        d="M60 96 V 112 M 34 112 H 86 M 34 112 V 120 M 60 112 V 120 M 86 112 V 120"
        className="org-line stroke-line-strong"
        strokeWidth="1.3"
        fill="none"
      />
      <path
        d="M200 96 V 112 M 174 112 H 226 M 174 112 V 120 M 200 112 V 120 M 226 112 V 120"
        className="org-line stroke-line-strong"
        strokeWidth="1.3"
        fill="none"
      />

      {[34, 60, 86, 174, 200, 226].map((x) => (
        <circle key={x} cx={x} cy="128" r="6" className="org-node fill-surface-tint stroke-line-strong" strokeWidth="1.2" />
      ))}
      <text x="130" y="156" textAnchor="middle" className="fill-faint" fontSize="9">
        members · roles · shared keys
      </text>
    </svg>
  );
}

/* ---------------------------------------------------------------
   7. Observability — request rows + sparkline
---------------------------------------------------------------- */
const OBS_ROWS = [
  { id: "req_9d41", text: "streamed · guardrails passed", tone: "ok" as const },
  { id: "req_9d42", text: "tool_calls mapped · 2 tools", tone: "ok" as const },
  { id: "req_9d43", text: "blocked by prompt_injection", tone: "danger" as const },
];

function ObservabilityFeed() {
  const [ref, seen] = useInViewOnce<HTMLDivElement>(0.4);
  const reduced = useReducedMotion();

  useEffect(() => {
    const root = ref.current;
    if (!root || !seen || reduced) return;
    const rows = root.querySelectorAll("[data-obs-row]");
    const a = animate(rows, {
      opacity: [0, 1],
      y: [10, 0],
      duration: 500,
      delay: staggerReveal(100),
      ease: "outExpo",
    });
    const stopDraw = drawSvgPaths(root, ".obs-spark", { duration: 1200, delay: 300 });
    return () => {
      a.revert();
      stopDraw();
    };
  }, [ref, seen, reduced]);

  return (
    <div ref={ref} className="flex h-full flex-col justify-center gap-3">
      <ul className="flex flex-col gap-2">
        {OBS_ROWS.map((row) => (
          <li
            key={row.id}
            data-obs-row
            className="flex items-center gap-2.5 rounded-lg border border-line bg-surface-cool px-3 py-2"
          >
            <span
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${row.tone === "ok" ? "bg-ok" : "bg-danger"}`}
              aria-hidden="true"
            />
            <span className="shrink-0 font-mono text-[0.72rem] text-ink-soft">{row.id}</span>
            <span className="truncate text-xs text-muted">{row.text}</span>
          </li>
        ))}
      </ul>
      <svg viewBox="0 0 240 44" className="mt-auto h-auto w-full" aria-hidden="true">
        <path
          d="M2 36 L 30 28 L 58 32 L 86 18 L 114 24 L 142 10 L 170 16 L 198 6 L 238 12"
          className="obs-spark stroke-teal"
          strokeWidth="1.8"
          fill="none"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}

/* ---------------------------------------------------------------
   8. Providers / models — verified adapter matrix + expandable
   endpoint details (aria-expanded disclosure, animated height).
---------------------------------------------------------------- */
function ProviderMatrix() {
  const [open, setOpen] = useState(false);
  const reduced = useReducedMotion();
  const regionRef = useRef<HTMLDivElement | null>(null);
  const mounted = useRef(false);

  useLayoutEffect(() => {
    const el = regionRef.current;
    if (!el) return;
    el.style.overflow = "hidden";
    // First pass: establish open/closed state without animating.
    if (!mounted.current || reduced) {
      mounted.current = true;
      el.style.height = open ? "auto" : "0px";
      el.style.opacity = open ? "1" : "0";
      return;
    }
    let a: ReturnType<typeof animate> | null = null;
    if (open) {
      el.style.height = "auto";
      const target = el.scrollHeight;
      el.style.height = "0px";
      el.style.opacity = "0";
      a = animate(el, {
        height: target,
        opacity: 1,
        duration: 450,
        ease: "outExpo",
        onComplete: () => {
          el.style.height = "auto";
        },
      });
    } else {
      el.style.height = `${el.scrollHeight}px`;
      a = animate(el, { height: 0, opacity: 0, duration: 300, ease: "inQuad" });
    }
    return () => {
      a?.revert();
    };
  }, [open, reduced]);

  return (
    <div className="-mt-0.5">
      <ul className="flex flex-col divide-y divide-line">
        {PROVIDERS.map((p) => (
          <li key={p.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-ink-soft">{p.name}</span>
              <span className="block truncate font-mono text-[0.7rem] text-faint">{p.api}</span>
            </span>
            <span className="flex shrink-0 gap-1.5">
              {p.tools && (
                <span className="rounded-md border border-teal-soft bg-teal-soft px-1.5 py-0.5 text-[0.65rem] font-medium text-teal">
                  tools
                </span>
              )}
              <span className="rounded-md border border-brand-soft bg-brand-soft px-1.5 py-0.5 text-[0.65rem] font-medium text-brand-strong">
                streaming
              </span>
            </span>
          </li>
        ))}
      </ul>

      <button
        type="button"
        aria-expanded={open}
        aria-controls="provider-endpoint-details"
        onClick={() => setOpen((o) => !o)}
        className="mt-3 flex w-full items-center justify-between gap-2 rounded-lg border border-line bg-surface-cool px-3 py-2 text-xs font-medium text-ink-soft transition-colors duration-200 hover:border-brand-soft hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        <span>Endpoint details</span>
        <svg
          viewBox="0 0 14 14"
          aria-hidden="true"
          className={`h-3.5 w-3.5 shrink-0 transition-transform duration-[var(--dur-fast)] ${open ? "rotate-180" : ""}`}
        >
          <path d="M3 5.5 L7 9.5 L11 5.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      <div id="provider-endpoint-details" ref={regionRef} aria-hidden={!open}>
        <ul className="mt-2 rounded-lg border border-line bg-surface-cool px-3 py-1">
          {PROVIDERS.map((p) => (
            <li key={p.id} className="flex flex-col gap-0.5 border-b border-line py-2 last:border-0 last:pb-2">
              <span className="truncate text-xs font-medium text-ink-soft">{p.name}</span>
              <span className="truncate font-mono text-[0.68rem] text-muted">{p.endpoints.join(" · ")}</span>
              <span className="truncate text-xs text-muted">{p.note}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------
   9. Developer API — OpenAI-compatible call (pointer tilt)
---------------------------------------------------------------- */
function ApiSnippet() {
  const tiltRef = usePointerTilt<HTMLDivElement>(3);
  return (
    <div ref={tiltRef}>
      <div
        tabIndex={0}
        role="region"
        aria-label="Example OpenAI-compatible API request"
        className="overflow-x-auto rounded-xl border border-line bg-ink p-4"
      >
        <pre className="font-mono text-[0.72rem] leading-relaxed text-line">
          <code>
            <span className="text-teal">POST</span> {GATEWAY_BASE}/chat/completions{"\n"}
            <span className="text-faint">Authorization:</span> Bearer sk-tollma-…{"\n"}
            {"\n"}
            {"{"}
            {"\n"}
            {"  "}
            <span className="text-teal">"model"</span>: "openai/gpt-…",{"\n"}
            {"  "}
            <span className="text-teal">"stream"</span>: true,{"\n"}
            {"  "}
            <span className="text-teal">"messages"</span>: […]
            {"\n"}
            {"}"}
          </code>
        </pre>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------
   Section — tiles reveal with fadeUp + staggerReveal(70) from the
   shared preset vocabulary; each tile's mini-visual fires on its
   own in-view latch inside.
---------------------------------------------------------------- */
export default function Features() {
  const [gridRef, gridSeen] = useInViewOnce<HTMLDivElement>(0.08);
  const reduced = useReducedMotion();

  // Hide tiles before paint, only when motion is allowed — reduced
  // motion and no-JS see everything immediately.
  useLayoutEffect(() => {
    const root = gridRef.current;
    if (!root || reduced) return;
    const items = root.querySelectorAll<HTMLElement>("[data-reveal]");
    utils.set(items, { opacity: 0, y: 24 });
    return () => {
      utils.set(items, { clear: "all" });
    };
  }, [reduced, gridRef]);

  useEffect(() => {
    const root = gridRef.current;
    if (!root || !gridSeen || reduced) return;
    const items = root.querySelectorAll<HTMLElement>("[data-reveal]");
    const a = animate(items, { ...fadeUp(24, 700), delay: staggerReveal(70) });
    return () => {
      a.revert();
    };
  }, [gridSeen, reduced, gridRef]);

  return (
    <Section tone="surface" id="features" className="overflow-hidden">
      <div className="bg-dots pointer-events-none absolute inset-0 opacity-60" aria-hidden="true" />
      <Container width="wide" className="relative">
        <SectionHeading
          eyebrow="Platform"
          title="Everything the gateway handles for you"
          lead="Access, cost, safety, and observability for every model call — governed from one place, with the API your code already speaks."
        />

        <div ref={gridRef} className="mt-12 grid grid-cols-1 gap-4 md:grid-cols-2 lg:mt-16 lg:grid-cols-12 lg:gap-5">
          <Tile
            span="md:col-span-2 lg:col-span-7"
            icon={<IconGateway size={20} />}
            title="Unified AI gateway"
            desc="One OpenAI-compatible endpoint fronts every provider. Point your SDK at ToLLma and swap models without touching application code."
          >
            <div className="rounded-xl border border-line bg-surface-cool/60 p-4">
              <GatewayFlow />
            </div>
          </Tile>

          <Tile
            span="lg:col-span-5"
            icon={<IconKey size={20} />}
            title="API key management"
            desc="Issue scoped keys with masked values and per-key budgets, so spend is capped before it surprises you."
          >
            <KeyCard />
          </Tile>

          <Tile
            span="lg:col-span-5"
            icon={<IconShield size={20} />}
            title="Guardrails"
            desc="Protection categories from prompt injection to PII, enforced in monitor or block mode — globally or per key."
          >
            <GuardrailGate />
          </Tile>

          <Tile
            span="md:col-span-2 lg:col-span-7"
            icon={<IconChart size={20} />}
            title="Usage & cost tracking"
            desc="Token and cost analytics broken down by key, model, and organization — see exactly where spend goes."
          >
            <UsageChart />
          </Tile>

          <Tile
            span="lg:col-span-4"
            icon={<IconDoc size={20} />}
            title="Prompt logging"
            desc="Prompts and completions captured with request metadata and configurable retention."
          >
            <LogTimeline />
          </Tile>

          <Tile
            span="lg:col-span-4"
            icon={<IconOrg size={20} />}
            title="Organizations & teams"
            desc="Group members, roles, and keys into organizations so every team gets its own governed workspace."
          >
            <OrgTree />
          </Tile>

          <Tile
            span="lg:col-span-4"
            icon={<IconActivity size={20} />}
            title="Request observability"
            desc="Conversation and request logs show what was routed, what streamed, and what guardrails did."
          >
            <ObservabilityFeed />
          </Tile>

          <Tile
            span="lg:col-span-5"
            icon={<IconLayers size={20} />}
            title="Models & providers"
            desc="Adapters for OpenAI, Anthropic, Gemini, Vertex AI, AWS Bedrock, and any OpenAI-compatible endpoint."
          >
            <ProviderMatrix />
          </Tile>

          <Tile
            span="md:col-span-2 lg:col-span-7"
            icon={<IconTerminal size={20} />}
            title="Built for developers"
            desc="Keep your existing OpenAI SDK, tools, and streaming code. Only the base URL changes."
          >
            <ApiSnippet />
          </Tile>
        </div>
      </Container>
    </Section>
  );
}
