"use client";

// How-it-works: cinematic scroll-driven architecture scene (2D/CSS/SVG only).
// ONE connected SVG scene (Applications → TOLLMA GATEWAY → ROUTING / POLICIES
// / TRACKING → providers) fills the stage below a docked top header. A
// CENTRALIZED camera (single scale + x/y translate on the visualization layer,
// driven by one paused anime.js timeline seeked by scroll progress) tours
// per-stage targets: overview → Route → Unify → Govern → Observe → overview
// return + exit. Fully reversible: scrolling up seeks the same timeline
// backwards. The camera anchors on the gateway center (symmetric expansion,
// tight clamp, leftward panel bias) and holds steady across stage boundaries
// while the annotation/panel layer crossfades separately (~400ms). The info
// panel lives in a SEPARATE opaque overlay layer (never zoomed) with reserved
// layout space. Packets flow along real SVG paths (request in → gateway →
// mid-layer, responses back); legs whose endpoints leave the viewport never
// run — packets terminate at ROUTING / POLICIES / TRACKING with a fade.
// Govern gets a lightweight allow/block preview toggle (visual only, no
// backend); Observe gets illustrative sample-data bars. Anime.js instances are
// created ONCE (camera timeline, packet loops, gateway pulse) — scroll only
// seeks and sets transforms/opacity. Cleanup on unmount.
// Reduced-motion / no-JS / mobile: the same scene renders statically with all
// four stage texts, no camera, no pinning.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { Container } from "@/components/ui/layout";
import { EVALUATORS, GET_STARTED_URL, GUARDRAIL_CATEGORIES, PROVIDERS } from "@/lib/site";
import { useReducedMotion } from "@/lib/animations";
import {
  animate,
  animatePackets,
  createTimeline,
  prefersReducedMotion,
  utils,
  type PacketFlow,
} from "@/lib/animations";

const MINT = "#72ddb1";
const BLUE = "#a9bdf4";
const PINK = "#e8b1a2";
const YELLOW = "#f5e6a3";

type Stage = "route" | "unify" | "govern" | "observe";

const STEPS: {
  n: string;
  stage: Stage;
  title: string;
  color: string;
  desc: string;
  bullets: string[];
}[] = [
  {
    n: "01",
    stage: "route",
    title: "Route",
    color: MINT,
    desc: "Every provider plugs in behind one OpenAI-compatible surface.",
    bullets: [
      `${PROVIDERS.filter((p) => p.id !== "custom").map((p) => p.name).join(", ")} adapters`, 
      "Any OpenAI-compatible endpoint as custom",
      "Streaming and tool calls where supported",
    ],
  },
  {
    n: "02",
    stage: "unify",
    title: "Unify",
    color: BLUE,
    desc: "One request shape for every model — Chat Completions (+ Responses where available).",
    bullets: [
      "Same keys, same shape, every model",
      "Apps and agents integrate once",
      "Swap providers without rewrites",
    ],
  },
  {
    n: "03",
    stage: "govern",
    title: "Govern",
    color: PINK,
    desc: "Guardrails, keys, and policies decide what runs.",
    bullets: [
      `${GUARDRAIL_CATEGORIES.length} guardrail categories · ${EVALUATORS.length} evaluators`,
      "Monitor or block enforcement",
      "Global or per-key policy scope",
    ],
  },
  {
    n: "04",
    stage: "observe",
    title: "Observe",
    color: YELLOW,
    desc: "Usage, cost, and logs for every request.",
    bullets: [
      "Usage and cost visibility per key",
      "Request logs with prompt logging",
      "Analytics and exports for audit",
    ],
  },
];

type StepT = (typeof STEPS)[number];

const STAGE_NAMES = ["intro", "route", "unify", "govern", "observe", "exit"] as const;
type StageName = (typeof STAGE_NAMES)[number];

/** Scroll-progress boundaries for [intro, route, unify, govern, observe, exit]. */
function stageOf(p: number): number {
  if (p < 0.1) return 0;
  if (p < 0.3) return 1;
  if (p < 0.5) return 2;
  if (p < 0.7) return 3;
  if (p < 0.92) return 4;
  return 5;
}

/**
 * Centralized camera keyframes: scale + focus point (fractions of scene).
 * Anchored on the gateway center (~0.415) so zoom expands symmetrically;
 * duplicate keys form plateau holds across stage boundaries (zoom holds while
 * the annotation/panel layer crossfades), an observe hold precedes the
 * eased de-zoom, and the final keys freeze the camera during the conclusion.
 */
const CAM_KEYS: { at: number; s: number; fx: number; fy: number }[] = [
  { at: 0, s: 1, fx: 0.5, fy: 0.5 }, // overview
  { at: 60, s: 1.5, fx: 0.42, fy: 0.5 }, // Route: apps → gateway
  { at: 220, s: 1.5, fx: 0.42, fy: 0.5 }, // hold across Route→Unify
  { at: 300, s: 1.75, fx: 0.415, fy: 0.5 }, // Unify: gateway tollma/v1
  { at: 440, s: 1.75, fx: 0.415, fy: 0.5 }, // hold across Unify→Govern
  { at: 520, s: 1.5, fx: 0.53, fy: 0.5 }, // Govern: policy engine
  { at: 660, s: 1.5, fx: 0.53, fy: 0.5 }, // hold across Govern→Observe
  { at: 720, s: 1.45, fx: 0.5, fy: 0.55 }, // Observe: tracking + chart
  { at: 860, s: 1.45, fx: 0.5, fy: 0.55 }, // hold final stage before return
  { at: 1000, s: 1, fx: 0.5, fy: 0.5 }, // eased de-zoom retracing the inward path
  { at: 1080, s: 1, fx: 0.5, fy: 0.5 }, // frozen during conclusion (no drift)
];

/** Nodes at full emphasis per stage; everything else falls to FLOOR (never 0). */
const EMPHASIS: Record<StageName, string[] | "all"> = {
  intro: "all",
  route: ["apps", "gateway", "routing", "policies", "tracking", "providers", "links"],
  unify: ["apps", "gateway", "links"],
  govern: ["gateway", "policies", "govern", "links"],
  observe: ["gateway", "tracking", "chart", "responses", "apps", "links"],
  exit: "all",
};

/**
 * Inactive opacity floor: architecture never drops to near-zero. Mid-layer
 * nodes stay legible (0.45), far providers dim but remain visible (0.4).
 * Overlay-only annotations (govern preview, chart, responses) hide when
 * inactive — they are callouts, not architecture.
 */
const FLOOR: Record<string, number> = {
  apps: 0.4,
  gateway: 0.4,
  routing: 0.45,
  policies: 0.45,
  tracking: 0.45,
  providers: 0.4,
  links: 0.85,
  govern: 0,
  chart: 0,
  responses: 0,
};

const SCENE_PROVIDERS = (["openai", "anthropic", "gemini", "bedrock"] as const).map(
  (id) => PROVIDERS.find((p) => p.id === id)!
);

function AllowBlockToggle({
  value,
  onChange,
  id,
}: {
  value: "allow" | "block";
  onChange: (v: "allow" | "block") => void;
  id: string;
}) {
  return (
    <div className="mt-4" role="group" aria-labelledby={`${id}-label`}>
      <p id={`${id}-label`} className="font-mono text-xs tracking-wide text-white/50">
        POLICY PREVIEW · VISUAL ONLY
      </p>
      <div className="mt-2 flex gap-2">
        {(["allow", "block"] as const).map((m) => {
          const on = value === m;
          return (
            <button
              key={m}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(m)}
              className={`flex min-h-[44px] flex-1 items-center justify-center border px-3 py-1.5 font-mono text-sm transition-colors ${
                on
                  ? "border-transparent font-bold text-black"
                  : "border-white/25 text-white/70 hover:border-white/60 hover:text-white"
              }`}
              style={on ? { background: m === "allow" ? MINT : PINK } : undefined}
            >
              {m === "allow" ? "Allow" : "Block"}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- one connected architecture scene ---------- */

const INK = "#f5f4ea";
const SUB = "rgba(245,244,234,0.62)";
const LINE = "rgba(245,244,234,0.22)";
const FILL = "rgba(255,255,255,0.045)";

function Node({
  x,
  y,
  w,
  h,
  node,
  title,
  sub,
  mono = false,
  accent = false,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  node: string;
  title: string;
  sub?: string;
  mono?: boolean;
  accent?: boolean;
}) {
  return (
    <g className="arch-node" data-node={node}>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        fill={FILL}
        stroke={accent ? "var(--accent, #72ddb1)" : LINE}
        strokeWidth={accent ? 2 : 1.5}
      />
      <text
        x={x + w / 2}
        y={y + h / 2 - (sub ? 6 : 0)}
        textAnchor="middle"
        dominantBaseline="middle"
        fill={INK}
        fontSize={23}
        fontWeight={accent ? 700 : 600}
        fontFamily="var(--font-sans), sans-serif"
        letterSpacing="0.04em"
      >
        {title}
      </text>
      {sub && (
        <text
          x={x + w / 2}
          y={y + h / 2 + 20}
          textAnchor="middle"
          fill={accent ? "var(--accent, #72ddb1)" : SUB}
          fontSize={16}
          fontFamily={mono ? "var(--font-mono-code), monospace" : "var(--font-sans), sans-serif"}
        >
          {sub}
        </text>
      )}
    </g>
  );
}

function FlowPath({ name, d, dashed = false }: { name: string; d: string; dashed?: boolean }) {
  return (
    <path
      data-path={name}
      d={d}
      fill="none"
      stroke={LINE}
      strokeWidth={2}
      strokeDasharray={dashed ? "7 6" : undefined}
    />
  );
}

function Packets({ forPath, count, stages }: { forPath: string; count: number; stages: string }) {
  return (
    <g className="arch-pkts" data-pkts={forPath} data-stages={stages} opacity={0}>
      {Array.from({ length: count }, (_, i) => (
        <circle
          key={i}
          r={6}
          fill="#fff"
          stroke="var(--accent, #72ddb1)"
          strokeWidth={2}
          transform="translate(-100 -100)"
        />
      ))}
    </g>
  );
}

function ArchitectureSvg({ animated, allow }: { animated: boolean; allow: "allow" | "block" }) {
  return (
    <svg viewBox="0 0 1230 720" className="h-full w-full" aria-hidden="true" data-allow={allow}>
      {/* links (always visible, dimmed uniformly) */}
      <g className="arch-node" data-node="links" opacity={0.9}>
        <FlowPath name="f1" d="M240,182 C320,182 320,300 400,318" />
        <FlowPath name="f2" d="M240,350 C310,350 330,350 400,350" />
        <FlowPath name="f3" d="M240,518 C320,518 320,382 400,382" />
        <FlowPath name="g1" d="M620,310 C660,300 660,200 700,190" />
        <FlowPath name="g2" d="M620,350 C650,350 660,350 700,350" />
        <FlowPath name="g3" d="M620,390 C660,400 660,500 700,510" />
        <FlowPath name="s1" d="M900,190 C935,185 945,120 980,102" />
        <FlowPath name="s2" d="M900,330 C935,325 945,250 980,242" />
        <FlowPath name="s3" d="M900,380 C935,382 945,380 980,380" />
        <FlowPath name="s4" d="M900,520 C935,518 945,502 980,500" />
      </g>
      {/* responses back (Observe) */}
      <g className="arch-node" data-node="responses">
        <FlowPath name="r2" d="M400,350 C330,350 310,350 240,350" dashed />
      </g>
      {/* request / response packets (animated mode only; painted UNDER the
          govern labels so dots never cross lettering; parked off-screen until
          their first path sample so spawns never stack on the gateway) */}
      {animated && (
        <>
          <Packets forPath="f1" count={2} stages="intro route unify govern observe" />
          <Packets forPath="f2" count={2} stages="intro route unify govern observe" />
          <Packets forPath="f3" count={2} stages="intro route unify govern observe" />
          <Packets forPath="g1" count={1} stages="intro route" />
          <Packets forPath="g2" count={2} stages="intro govern" />
          <Packets forPath="g3" count={1} stages="intro route observe" />
          <Packets forPath="s1" count={1} stages="intro" />
          <Packets forPath="s2" count={1} stages="intro" />
          <Packets forPath="s3" count={1} stages="intro" />
          <Packets forPath="s4" count={1} stages="intro" />
          <Packets forPath="r2" count={2} stages="intro observe" />
        </>
      )}
      {/* Govern allow / block overlay paths (packets terminate at POLICIES —
          these legs run off-screen at Govern zoom, so no packet groups here) */}
      <g className="arch-node" data-node="govern">
        <path
          data-path="allowP"
          d="M900,350 C930,350 945,300 980,244"
          fill="none"
          stroke={MINT}
          strokeWidth={allow === "allow" ? 3 : 1.75}
          opacity={allow === "allow" ? 1 : 0.55}
        />
        <rect
          x={884}
          y={254}
          width={80}
          height={30}
          rx={4}
          fill="#10130f"
          fillOpacity={0.92}
          stroke={allow === "allow" ? MINT : SUB}
          strokeOpacity={0.45}
        />
        <text x={924} y={274} textAnchor="middle" fill={allow === "allow" ? MINT : SUB} fontSize={15} fontFamily="var(--font-mono-code), monospace">
          ALLOW
        </text>
        <path
          data-path="blockP"
          d="M770,392 C710,460 660,545 648,610"
          fill="none"
          stroke={PINK}
          strokeWidth={allow === "block" ? 3 : 1.75}
          strokeDasharray="7 6"
          opacity={allow === "block" ? 1 : 0.55}
        />
        <circle cx={648} cy={628} r={11} fill="none" stroke={PINK} strokeWidth={2} opacity={allow === "block" ? 1 : 0.55} />
        <text x={648} y={632} textAnchor="middle" fill={PINK} fontSize={14} opacity={allow === "block" ? 1 : 0.55}>
          ✕
        </text>
        <text x={648} y={656} textAnchor="middle" fill={allow === "block" ? PINK : SUB} fontSize={15} fontWeight={700} fontFamily="var(--font-mono-code), monospace" opacity={0.95}>
          BLOCKED
        </text>
      </g>
      {/* Observe sample-data chart */}
      <g className="arch-node" data-node="chart">
        <rect x={680} y={596} width={460} height={88} fill={FILL} stroke={LINE} strokeWidth={1.5} />
        <text x={696} y={618} fill={SUB} fontSize={14} fontFamily="var(--font-mono-code), monospace">
          SAMPLE: 12k req · $48 · 214 logs
        </text>
        <g data-bars>
          {[42, 68, 50, 86, 64].map((h, i) => (
            <rect
              key={i}
              className="arch-bar"
              data-bar={true}
              x={700 + i * 56}
              y={676 - h * 0.55}
              width={36}
              height={h * 0.55}
              fill="rgba(245,230,163,0.75)"
              style={animated ? { transform: "scaleY(0)" } : undefined}
            />
          ))}
        </g>
      </g>
      {/* nodes */}
      <g data-node="apps">
        <Node x={60} y={140} w={180} h={84} node="apps" title="Web App" sub="chat · stream" mono />
        <Node x={60} y={308} w={180} h={84} node="apps" title="Agent" sub="agents · tools*" mono />
        <Node x={60} y={476} w={180} h={84} node="apps" title="Backend" sub="api · responses" mono />
      </g>
      <Node x={400} y={266} w={220} h={168} node="gateway" title="TOLLMA GATEWAY" sub="tollma/v1" mono accent />
      <g data-hl="gatewaypulse" opacity={0.3}>
        <rect x={400} y={266} width={220} height={168} fill="none" stroke="var(--accent, #72ddb1)" strokeWidth={2} />
      </g>
      <Node x={700} y={140} w={200} h={84} node="routing" title="ROUTING" sub="model map" mono />
      <Node x={700} y={308} w={200} h={84} node="policies" title="POLICIES" sub="guardrails · keys" mono />
      <Node x={700} y={476} w={200} h={84} node="tracking" title="TRACKING" sub="usage · cost · logs" mono />
      <g data-node="providers">
        {SCENE_PROVIDERS.map((p, i) => (
          <g key={p.id} className="arch-node" data-node="providers">
            <rect x={980} y={60 + i * 140} width={180} height={80} fill={FILL} stroke={LINE} strokeWidth={1.5} />
            <text
              x={1070}
              y={60 + i * 140 + 32}
              textAnchor="middle"
              fill={INK}
              fontSize={21}
              fontWeight={600}
              fontFamily="var(--font-sans), sans-serif"
            >
              {p.name.replace("Google ", "")}
            </text>
            <text
              x={1070}
              y={60 + i * 140 + 58}
              textAnchor="middle"
              fill={SUB}
              fontSize={15}
              fontFamily="var(--font-mono-code), monospace"
            >
              {p.tools ? "tools · stream" : "stream"}
            </text>
          </g>
        ))}
        <text
          x={1070}
          y={584}
          textAnchor="middle"
          fill={SUB}
          fontSize={14}
          fontFamily="var(--font-mono-code), monospace"
        >
          (subset shown)
        </text>
      </g>
      <text x={60} y={672} fill={SUB} fontSize={14} fontFamily="var(--font-mono-code), monospace">
        * tools &amp; streaming where supported
      </text>
    </svg>
  );
}

function StepCard({
  step,
  headingId,
  level = "h3",
  allow,
  onAllow,
}: {
  step: StepT;
  headingId: string;
  level?: "h2" | "h3";
  allow: "allow" | "block";
  onAllow: (v: "allow" | "block") => void;
}) {
  const Title = level;
  return (
    <div className="flex min-h-[340px] flex-col border border-white/15 bg-night p-6">
      <div className="flex items-start justify-between gap-3">
        <Title id={headingId} className="font-serif text-2xl font-medium text-white">
          {step.title}
        </Title>
        <span className="px-1.5 py-0.5 font-mono text-xs font-bold text-black" style={{ background: step.color }}>
          {step.n}
        </span>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-white/70">{step.desc}</p>
      <ul className="mt-4 flex flex-col gap-2 text-sm text-white/85">
        {step.bullets.map((b) => (
          <li key={b} className="flex items-start gap-2 border-t border-white/10 pt-2">
            <span aria-hidden="true" className="text-[0.7rem] leading-relaxed" style={{ color: step.color }}>
              →
            </span>
            {b}
          </li>
        ))}
      </ul>
      {step.stage === "govern" && (
        <AllowBlockToggle value={allow} onChange={onAllow} id={headingId} />
      )}
    </div>
  );
}

export default function Platform() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const vizRef = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState(0); // index into STAGE_NAMES
  const [allow, setAllow] = useState<"allow" | "block">("allow");
  const [mounted, setMounted] = useState(false);
  const [desktop, setDesktop] = useState(false);
  const reduced = useReducedMotion();
  const activeRef = useRef(0);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    setDesktop(mq.matches);
    const on = () => setDesktop(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  const motionOK = mounted && !reduced; // JS + motion allowed (pinned vs stacked picked by CSS)
  const pinned = motionOK && desktop; // camera/packets only when the stage is visible

  /* One coherent scroll-driven setup: camera timeline + packet loops +
     gateway pulse, created once. Scroll only seeks + sets transforms. */
  useEffect(() => {
    if (!pinned) return;
    const wrap = wrapRef.current;
    const viz = vizRef.current;
    if (!wrap || !viz) return;
    const scene = viz.querySelector("svg");
    if (!scene) return;

    // --- centralized camera: single paused timeline, seeked by progress ---
    const cam = { s: 1, fx: 0.5, fy: 0.5 };
    const camTl = createTimeline({ autoplay: false, defaults: { ease: "inOutSine" } });
    // Plateau keys hold zoom steady across boundaries; interpolation spans
    // ~55% of each gap (smooth, eased) and holds for the rest.
    camTl.add(cam, { s: CAM_KEYS[0].s, fx: CAM_KEYS[0].fx, fy: CAM_KEYS[0].fy, duration: 1 }, 0);
    for (let i = 1; i < CAM_KEYS.length; i++) {
      const k = CAM_KEYS[i];
      const gap = k.at - CAM_KEYS[i - 1].at;
      camTl.add(
        cam,
        { s: k.s, fx: k.fx, fy: k.fy, duration: Math.max(1, Math.round(gap * 0.55)) },
        k.at
      );
    }
    const DUR = camTl.duration || 1000;

    // --- packet loops, one per path, grouped by stage ---
    const flows: { flow: PacketFlow; stages: string[] }[] = [];
    if (!prefersReducedMotion()) {
      scene.querySelectorAll<SVGPathElement>("path[data-path]").forEach((path) => {
        const name = path.getAttribute("data-path");
        const group = name && scene.querySelector(`[data-pkts="${name}"]`);
        if (!group) return;
        const circles = Array.from(group.querySelectorAll("circle"));
        if (!circles.length) return;
        const flow = animatePackets(path, circles as unknown as SVGElement[], {
          duration: 2400,
          staggerMs: 800,
        });
        flows.push({
          flow,
          stages: (group.getAttribute("data-stages") ?? "").split(" ").filter(Boolean),
        });
      });
    }

    // --- gateway pulse (transform/opacity only) ---
    const pulseEl = scene.querySelector('[data-hl="gatewaypulse"]');
    const pulse = pulseEl && !prefersReducedMotion()
      ? animate(pulseEl as unknown as Element, {
          opacity: [0.15, 0.55],
          duration: 1600,
          loop: true,
          alternate: true,
          ease: "inOutSine",
        })
      : null;

    let barsAnim: ReturnType<typeof animate> | null = null;

    const applyStage = (idx: number) => {
      const name = STAGE_NAMES[idx] as StageName;
      const emp = EMPHASIS[name];
      scene.querySelectorAll<HTMLElement>("[data-node]").forEach((el) => {
        const n = el.getAttribute("data-node") ?? "";
        if (emp === "all" || emp.includes(n)) {
          el.style.opacity = n === "links" ? "0.9" : "1";
        } else {
          // Inactive floor: architecture stays legible, never near-zero.
          el.style.opacity = String(FLOOR[n] ?? 0.4);
        }
      });
      const dark = name === "exit";
      scene.querySelectorAll<HTMLElement>("[data-pkts]").forEach((el) => {
        const stages = (el.getAttribute("data-stages") ?? "").split(" ").filter(Boolean);
        el.style.opacity = !dark && stages.includes(name) ? "1" : "0";
      });
      flows.forEach(({ flow, stages }) => {
        if (dark || !stages.includes(name)) flow.pause();
        else flow.play();
      });
      const bars = scene.querySelectorAll("[data-bar]");
      if (name === "observe" && bars.length) {
        // Single live instance: revert the previous one before recreating
        // so re-entering Observe never stacks overlapping animations.
        barsAnim?.revert();
        barsAnim = animate(bars as unknown as Element[], {
          scaleY: [0, 1],
          duration: 700,
          delay: 150,
          ease: "outExpo",
        });
      } else if (bars.length) {
        barsAnim?.revert();
        barsAnim = null;
        utils.set(bars as unknown as Element[], { scaleY: 0 });
      }
    };

    let raf = 0;
    const update = () => {
      raf = 0;
      const total = wrap.offsetHeight - window.innerHeight;
      const rect = wrap.getBoundingClientRect();
      const p = total > 0 ? Math.min(1, Math.max(0, -rect.top / total)) : 0;
      // seek the one camera timeline (reversible by construction)
      camTl.seek(p * DUR);
      const tablet = window.innerWidth < 1024;
      const sc = tablet ? 1 + (cam.s - 1) * 0.55 : cam.s;
      // Tight clamp keeps boxes whole; constant leftward bias reserves the
      // right-docked panel so the provider column ends at its left edge.
      const m = 34 * (sc - 1);
      const tx = Math.max(-m, Math.min(m, sc * (0.5 - cam.fx) * 100 - 9 * (sc - 1)));
      const ty = Math.max(-m, Math.min(m, sc * (0.5 - cam.fy) * 100));
      viz.style.transform = `translate(${tx.toFixed(2)}%, ${ty.toFixed(2)}%) scale(${sc.toFixed(4)})`;
      const idx = stageOf(p);
      if (idx !== activeRef.current) {
        activeRef.current = idx;
        setActive(idx);
        applyStage(idx);
      }
    };
    const onScrollHandler = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    applyStage(activeRef.current);
    update();
    window.addEventListener("scroll", onScrollHandler, { passive: true });
    window.addEventListener("resize", onScrollHandler, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScrollHandler);
      window.removeEventListener("resize", onScrollHandler);
      if (raf) cancelAnimationFrame(raf);
      flows.forEach(({ flow }) => flow.revert());
      barsAnim?.revert();
      if (pulse) pulse.revert();
      camTl.revert();
    };
  }, [pinned]);

  const static_ = !motionOK;
  const activeName = STAGE_NAMES[active] as StageName;
  const step = active >= 1 && active <= 4 ? STEPS[active - 1] : null;
  const showExit = active === 5;
  const inStage = active >= 1 && active <= 4;
  const cur = inStage ? step : null;
  const liveKey = cur ? cur.stage : showExit ? "exit" : "intro";

  // Outgoing panel lingers one 400ms crossfade behind the incoming panel
  // (and behind the exit card), so stage changes never hard-cut.
  const [prevStep, setPrevStep] = useState<StepT | null>(null);
  const liveRef = useRef<{ key: string; step: StepT | null }>({ key: "intro", step: null });
  useEffect(() => {
    if (liveRef.current.key !== liveKey) {
      const outgoing = liveRef.current.step;
      liveRef.current = { key: liveKey, step: cur };
      setPrevStep(outgoing);
      const t = window.setTimeout(() => setPrevStep(null), 480);
      return () => window.clearTimeout(t);
    }
  }, [liveKey, cur]);
  const dotStep = cur ?? prevStep;

  return (
    <section id="platform" className="scroll-mt-16 overflow-clip bg-night text-white">
      {static_ && (
        <Container width="wide" className="py-20 md:py-28">
          <p className="text-center text-xs font-medium text-white/50">Platform</p>
          <h2 className="mx-auto mt-4 max-w-2xl text-center font-serif text-4xl font-medium tracking-tight md:text-5xl">
            How it works
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-center text-[1.05rem] leading-relaxed text-white/70">
            From provider sprawl to one gateway.
          </p>
          <div className="mx-auto mt-10 max-w-5xl" role="img" aria-label="ToLLma architecture overview">
            <ArchitectureSvg animated={false} allow={allow} />
          </div>
          <div className="mx-auto mt-12 grid max-w-4xl gap-5 md:grid-cols-2">
            {STEPS.map((s) => (
              <StepCard key={s.n} step={s} headingId={`hiw-static-${s.stage}`} level="h3" allow={allow} onAllow={setAllow} />
            ))}
          </div>
        </Container>
      )}

      {motionOK && (
        <div ref={wrapRef} className="relative hidden bg-night md:block" style={{ height: "600vh" }}>
          <div className="sticky top-0 flex h-screen flex-col overflow-hidden">
            {/* docked header: clear of the diagram, arrives whole, never overlays nodes */}
            <header className="pointer-events-none z-10 mx-auto w-full max-w-3xl shrink-0 px-6 pb-4 pt-20 text-center">
              <p className="text-xs font-medium text-white/50">Platform</p>
              <h2 id="hiw-scene-title" className="mt-3 font-serif text-4xl font-medium tracking-tight text-white md:text-5xl">
                How it works
              </h2>
              <p className="mx-auto mt-3 max-w-xl text-[1.05rem] leading-relaxed text-white/70">
                One gateway in front of every model. Follow a request through it.
              </p>
            </header>
            <div className="relative min-h-0 flex-1" data-stage={activeName}>
              {/* visualization layer: the ONLY zoomed layer (centralized camera) */}
              <div
                className="absolute inset-y-0 left-[2%] right-[360px] flex items-center justify-center"
                style={{ opacity: showExit ? 0.18 : 1, transition: "opacity 500ms ease" }}
              >
                <div
                  ref={vizRef}
                  className="h-full w-full will-change-transform"
                  style={{ "--accent": cur?.color ?? MINT } as CSSProperties}
                >
                  <ArchitectureSvg animated allow={allow} />
                </div>
              </div>

              {/* info panel overlay: never zoomed, opaque, fixed slot, crossfades */}
              {(cur || prevStep) && (
                <div className="absolute right-[3%] top-1/2 w-[320px] -translate-y-1/2">
                  <div className="grid">
                    {prevStep && prevStep.stage !== cur?.stage && (
                      <div key={prevStep.stage} aria-hidden="true" className="panel-exit pointer-events-none col-start-1 row-start-1">
                        <StepCard step={prevStep} headingId={`hiw-panel-${prevStep.stage}`} level="h2" allow={allow} onAllow={setAllow} />
                      </div>
                    )}
                    {cur && (
                      <div key={cur.stage} className="panel-enter col-start-1 row-start-1">
                        <StepCard step={cur} headingId={`hiw-panel-${cur.stage}`} level="h2" allow={allow} onAllow={setAllow} />
                      </div>
                    )}
                  </div>
                  {dotStep && (
                    <div className="mt-3 flex items-center justify-between" aria-hidden="true">
                      <div className="flex gap-1.5">
                        {STEPS.map((s) => (
                          <span
                            key={s.n}
                            className="h-1 w-6"
                            style={{ background: s.n === dotStep.n ? s.color : "rgba(255,255,255,0.2)" }}
                          />
                        ))}
                      </div>
                      <span className="font-mono text-xs text-white/40">
                        {dotStep.n} / 04
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* exit state: dedicated opaque end-card over the scrimmed diagram */}
              {showExit && (
                <div className="absolute inset-0 flex items-center justify-center px-8">
                  <div className="end-fade border border-white/15 bg-night px-10 py-9 text-center">
                    <h2 className="font-serif text-5xl font-medium tracking-tight text-white">The ToLLma Platform</h2>
                    <p className="mx-auto mt-4 max-w-md text-[1.05rem] leading-relaxed text-white/70">
                      Route, unify, govern, observe — every model behind one gateway.
                    </p>
                    <Link
                      href={GET_STARTED_URL}
                      className="mt-6 inline-flex items-center gap-2 border border-white/40 px-6 py-3 text-[0.95rem] font-medium text-white transition-colors hover:border-white hover:bg-white/10"
                    >
                      Explore <span aria-hidden="true">→</span>
                    </Link>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {motionOK && !desktop && (
        <Container width="wide" className="pb-20 md:hidden">
          <p className="pt-20 text-center text-xs font-medium text-white/50">Platform</p>
          <h2 className="mx-auto mt-4 max-w-2xl text-center font-serif text-4xl font-medium tracking-tight">
            How it works
          </h2>
          <div className="mx-auto mt-8 max-w-xl" role="img" aria-label="ToLLma architecture overview">
            <ArchitectureSvg animated={false} allow={allow} />
          </div>
          <ol className="relative mt-12 flex flex-col gap-8">
            {STEPS.map((s, i) => (
              <li key={s.n} className="relative">
                <StepCard step={s} headingId={`hiw-m-${s.stage}`} level="h3" allow={allow} onAllow={setAllow} />
                <span className="sr-only">Step {i + 1} of {STEPS.length}</span>
              </li>
            ))}
          </ol>
        </Container>
      )}

      <span className="sr-only" aria-live="polite">
        {step ? `Step ${step.n} of 04: ${step.title}.` : activeName === "intro" ? "Overview." : "The ToLLma Platform."}
      </span>
    </section>
  );
}
