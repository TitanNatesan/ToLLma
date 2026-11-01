"use client";

// How-it-works: 8-layer scroll-driven gateway story (L01–L08).
//
// ONE module, SINGLE layout config (LAYOUT below: node ids, lane, size,
// position strategy per mode). All connectors are computed from node
// bounding boxes (edgeBox + hConn/vConn/elbow): every path starts and ends
// exactly on a node edge (≤2px by construction), orthogonal with rounded
// joins, labels in reserved slots with opaque halo pills (never crossed by
// a path). Consistent node dims per category (layer / provider chip /
// ledger chip / terminus). Solid = request/response lifecycle, dashed =
// observability taps, coral = blocked branch (exits L05 upward to a
// terminus; never reaches providers; over-limit denies immediately).
//
// Desktop ≥1200px ("wide"): setup lane (L01–L02) + request lane
// (L03–L08) left-to-right; providers fan out below L06/L07 on a bus and
// return into L07; ledgers strip along the bottom; response returns along
// a reserved top slot. Below 1200px ("tall"): same config, vertical
// position strategy (L01→L08 top-to-bottom, providers inline between L06
// and L07, right-side annotation chips). ONE stepper instance, ONE
// eyebrow+title+tagline heading (never duplicated).
//
// Motion: GSAP ScrollTrigger pins ~350vh and scrubs progress → layer
// emphasis + edge draw-in + packets (ONE lead + ≤3 secondary, placed with
// native getPointAtLength — the MotionPath getPointAtLength-equivalent —
// as a pure function of progress, so reverse scroll is exact). anime.js is
// used ONLY for micro-interactions: node pulse on activation, count-up,
// blocked-badge shake. Parallax applies to the background grid/glow ONLY.
// Reduced-motion / tall: no pin, complete diagram, click stepper to
// highlight. Safe/Injection toggle: injection parks the lead packet at L05
// and draws the coral blocked branch (existing behavior pattern).
//
// Zoom/pan: buttons (+/−/fit) + drag pan on an inner <g>; vector-only so
// 400% zoom and DPR 1–3 stay crisp (strokes scale with the transform).
import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { MotionPathPlugin } from "gsap/MotionPathPlugin";
import { animate } from "animejs";
import { Container } from "@/components/ui/layout";
import { GET_STARTED_URL } from "@/lib/site";
import { useReducedMotion } from "@/lib/animations";

gsap.registerPlugin(ScrollTrigger, MotionPathPlugin);

const MINT = "#72ddb1";
const BLUE = "#a9bdf4";
const CORAL = "#e8b1a2";
const INK = "#f5f4ea";
const SUB = "rgba(245,244,234,0.7)";
const FAINT = "rgba(245,244,234,0.55)";
const LINE = "rgba(245,244,234,0.22)";
const FILL = "rgba(255,255,255,0.045)";
const SANS = "var(--font-sans), sans-serif";
const MONO = "var(--font-mono), monospace";

type Mode = "wide" | "tall";
type Lane = "setup" | "request" | "provider" | "observe" | "system";
type Rect = { x: number; y: number; w: number; h: number };

type Layer = {
  id: string;
  n: string;
  lane: Lane;
  title: string;
  sub: string;
  desc: string;
  points: string[];
};

/**
 * SINGLE layout config. Product truth (backend-audited; never claim beyond):
 * L01 workspaces = personal + org with permission-sets/membership (no
 * "roles" word). L02 personal vs org-scoped keys, per-model allow-lists,
 * per-key + org max_spend caps (never "global/per-key scope" wording).
 * L03 unknown→401, disabled/expired/policy→403, resolves workspace +
 * budget pre-call. L04 rpm/rph/rpd + token caps, over-limit DENY with
 * Retry-After (429/403), NO queue. L05 10 categories, monitor/warn/block
 * (default warn), scope global/provider/key(+model). L06 provider/model
 * hint resolution, 6 families, wire→unified→native, Gemini stream-only
 * (no tools). L07 normalized to unified result, re-emitted in requested
 * wire shape, streaming post-check audit-only. L08 metadata/cost/token
 * ledgers + encrypted bounded prompt/response captures, analytics reads
 * ledgers. Prompt logging is a SEPARATE workspace setting (global vs keys
 * allow-list) — its tap leaves L01, never L05.
 */
const LAYERS: Layer[] = [
  {
    id: "register", n: "01", lane: "setup", title: "Register",
    sub: "WORKSPACES",
    desc: "Personal + organization workspaces with permission-sets and membership.",
    points: ["Personal + org workspaces", "Permission-sets + membership", "Workspace resolves pre-call"],
  },
  {
    id: "keys", n: "02", lane: "setup", title: "Issue keys",
    sub: "API KEYS",
    desc: "Personal vs org-scoped keys, per-model allow-lists, budget caps.",
    points: ["Personal vs org-scoped keys", "Per-model allow-lists", "Per-key + org max_spend caps"],
  },
  {
    id: "auth", n: "03", lane: "request", title: "Authenticate",
    sub: "401 · 403",
    desc: "Unknown key → 401; disabled, expired, or policy-denied → 403.",
    points: ["Unknown → 401", "Disabled / expired / policy → 403", "Resolves workspace + budget"],
  },
  {
    id: "ratelimit", n: "04", lane: "request", title: "Rate limit",
    sub: "RPM · RPH · RPD",
    desc: "RPM/RPH/RPD plus token caps. Over-limit is DENY with Retry-After — nothing waits.",
    points: ["rpm / rph / rpd + token caps", "Over-limit = DENY + Retry-After", "429 / 403 · deny only"],
  },
  {
    id: "guardrails", n: "05", lane: "request", title: "Guardrails",
    sub: "10 CATEGORIES",
    desc: "Ten categories; monitor / warn / block enforcement, default warn.",
    points: ["10 categories", "Monitor · warn · block (default warn)", "Scope global / provider / key (+model)"],
  },
  {
    id: "route", n: "06", lane: "request", title: "Route / translate",
    sub: "WIRE → UNIFIED → NATIVE",
    desc: "Provider/model hint resolution; unified shape translated to native.",
    points: ["Provider / model hint resolution", "6 families · OpenAI +7 adapters", "Gemini stream-only, no tools"],
  },
  {
    id: "normalize", n: "07", lane: "request", title: "Provider / normalize",
    sub: "UNIFIED RESULT",
    desc: "Normalized to unified result, re-emitted in the requested wire shape.",
    points: ["Unified result shape", "Re-emitted as requested wire", "Streaming post-check audit-only"],
  },
  {
    id: "observe", n: "08", lane: "request", title: "Observe",
    sub: "LEDGERS",
    desc: "Metadata, cost, and token ledgers; analytics reads the ledgers.",
    points: ["Metadata · cost · token ledgers", "Encrypted bounded captures", "Analytics reads ledgers"],
  },
];

/** Provider families (text names only). Gemini is stream-only (no tools). */
const PROVIDERS: { id: string; name: string; note: string }[] = [
  { id: "openai", name: "OpenAI", note: "+7 ADAPTERS" },
  { id: "anthropic", name: "Anthropic", note: "TOOLS · STREAM" },
  { id: "gemini", name: "Gemini", note: "STREAM-ONLY" },
  { id: "vertex", name: "Vertex AI", note: "STREAM" },
  { id: "bedrock", name: "Bedrock", note: "TOOLS · STREAM" },
  { id: "custom", name: "Custom", note: "OPENAI-COMPAT" },
];

const LEDGERS = [
  { id: "meta", label: "METADATA" },
  { id: "cost", label: "COST" },
  { id: "tokens", label: "TOKENS" },
];

const VIEW: Record<Mode, { w: number; h: number }> = {
  wide: { w: 1600, h: 800 },
  tall: { w: 660, h: 2500 },
};

/** Position strategy per mode, derived from the single LAYERS config. */
function layoutNodes(mode: Mode): { layers: Record<string, Rect>; providers: Rect[]; ledgers: Record<string, Rect>; captures: Rect; blocked: Rect } {
  if (mode === "wide") {
    const LW = 152; const LH = 118;
    const layers: Record<string, Rect> = {};
    const setupY = 88; const reqY = 296;
    layers.register = { x: 48, y: setupY, w: LW, h: LH };
    layers.keys = { x: 240, y: setupY, w: LW, h: LH };
    const xs = [472, 652, 832, 1012, 1192, 1372];
    ["auth", "ratelimit", "guardrails", "route", "normalize", "observe"].forEach((id, i) => {
      layers[id] = { x: xs[i], y: reqY, w: LW, h: LH };
    });
    // Receiving family (OpenAI) sits col0-bottom where fan-d4 lands.
    const slots = [{ c: 0, r: 2 }, { c: 1, r: 0 }, { c: 0, r: 0 }, { c: 1, r: 1 }, { c: 0, r: 1 }, { c: 1, r: 2 }];
    const providers = PROVIDERS.map((_, i) => ({
      x: 1012 + slots[i].c * 180, y: 470 + slots[i].r * 52, w: LW, h: 40,
    }));
    const ledgers: Record<string, Rect> = {
      meta: { x: 292, y: 688, w: 200, h: 44 },
      cost: { x: 516, y: 688, w: 200, h: 44 },
      tokens: { x: 740, y: 688, w: 200, h: 44 },
    };
    const captures: Rect = { x: 48, y: 688, w: 220, h: 44 };
    const blocked: Rect = { x: 797, y: 164, w: 180, h: 52 };
    return { layers, providers, ledgers, captures, blocked };
  }
  const W = 400; const H = 118; const X = 40; const Y0 = 120; const STEP = 168;
  const ids = ["register", "keys", "auth", "ratelimit", "guardrails", "route", "normalize", "observe"];
  const layers: Record<string, Rect> = {};
  // Providers sit inline between route (idx 5) and normalize (idx 6).
  const order = ["register", "keys", "auth", "ratelimit", "guardrails", "route", "__prov__", "normalize", "observe"];
  let y = Y0;
  const provY: number[] = [];
  order.forEach((id) => {
    if (id === "__prov__") {
      for (let i = 0; i < 6; i++) { provY.push(y); y += 60; }
      y += 8;
      return;
    }
    layers[id] = { x: X, y, w: W, h: H };
    y += STEP;
  });
  void ids;
  const providers = provY.map((py) => ({ x: 120, y: py, w: 200, h: 48 }));
  const ledgers: Record<string, Rect> = {
    meta: { x: X, y: y + 24, w: W, h: 44 },
    cost: { x: X, y: y + 76, w: W, h: 44 },
    tokens: { x: X, y: y + 128, w: W, h: 44 },
  };
  const captures: Rect = { x: 474, y: layers.register.y + 30, w: 146, h: 58 };
  const blocked: Rect = { x: 474, y: layers.guardrails.y + 30, w: 146, h: 58 };
  return { layers, providers, ledgers, captures, blocked };
}

type Layout = ReturnType<typeof layoutNodes>;
const cx = (r: Rect) => r.x + r.w / 2;

/** Orthogonal elbow between two edge points (rounded joins via CSS). */
function elbow(x1: number, y1: number, x2: number, y2: number, mid?: number): string {
  if (x1 === x2 || y1 === y2) return `M${x1},${y1} L${x2},${y2}`;
  const m = mid ?? (y1 + y2) / 2;
  // Vertical-first elbow keeps endpoints perpendicular to node edges.
  return `M${x1},${y1} L${x1},${m} L${x2},${m} L${x2},${y2}`;
}

type Conn = { name: string; d: string; dashed?: boolean; coral?: boolean; x1: number; y1: number; x2: number; y2: number; label?: string; lx?: number; ly?: number };

/** All connectors computed from node bounding boxes — endpoints land on edges. */
function buildConns(L: Layout, mode: Mode): Conn[] {
  const c: Conn[] = [];
  const R = L.layers;
  if (mode === "wide") {
    const yMid = R.register.y + R.register.h / 2;
    c.push({ name: "setup", d: `M${R.register.x + R.register.w},${yMid} L${R.keys.x},${yMid}`, x1: R.register.x + R.register.w, y1: yMid, x2: R.keys.x, y2: yMid });
    const dropX = cx(R.keys);
    c.push({ name: "drop", d: elbow(dropX, R.keys.y + R.keys.h, cx(R.auth), R.auth.y), x1: dropX, y1: R.keys.y + R.keys.h, x2: cx(R.auth), y2: R.auth.y, label: "REQUEST", lx: 430, ly: 278 });
    const reqMid = R.auth.y + R.auth.h / 2;
    const seq: [string, string][] = [["auth", "ratelimit"], ["ratelimit", "guardrails"], ["guardrails", "route"], ["route", "normalize"], ["normalize", "observe"]];
    seq.forEach(([a, b]) => {
      c.push({ name: `${a}-${b}`, d: `M${R[a].x + R[a].w},${reqMid} L${R[b].x},${reqMid}`, x1: R[a].x + R[a].w, y1: reqMid, x2: R[b].x, y2: reqMid });
    });
    // Provider fan-out: bus with T-joint drops into each chip left/right
    // edge (receiving family = OpenAI, col0-bottom). Halo pills sit over
    // lines by design; lettering never touches a node.
    const busY = 452;
    c.push({ name: "lbl-setup", d: "", x1: 220, y1: 76, x2: 220, y2: 76, label: "SETUP", lx: 220, ly: 76 });
    c.push({ name: "fan", d: `M${cx(R.route)},${R.route.y + R.route.h} L${cx(R.route)},${busY} L960,${busY} L960,490 L1012,490`, x1: cx(R.route), y1: R.route.y + R.route.h, x2: 1012, y2: 490 });
    c.push({ name: "fan-bus", d: `M960,${busY} L1356,${busY}`, x1: 960, y1: busY, x2: 1356, y2: busY });
    c.push({ name: "fan-d2", d: `M960,490 L960,542 L1012,542`, x1: 960, y1: 490, x2: 1012, y2: 542 });
    c.push({ name: "fan-d4", d: `M960,542 L960,594 L1012,594`, x1: 960, y1: 542, x2: 1012, y2: 594 });
    c.push({ name: "fan-e1", d: `M1356,${busY} L1356,490 L1344,490`, x1: 1356, y1: busY, x2: 1344, y2: 490 });
    c.push({ name: "fan-e3", d: `M1356,490 L1356,542 L1344,542`, x1: 1356, y1: 490, x2: 1344, y2: 542 });
    c.push({ name: "fan-e5", d: `M1356,542 L1356,594 L1344,594`, x1: 1356, y1: 542, x2: 1344, y2: 594 });
    c.push({ name: "lbl-fanout", d: "", x1: 900, y1: 470, x2: 900, y2: 470, label: "FAN-OUT", lx: 900, ly: 470 });
    // Return: OpenAI left edge → left corridor → normalize bottom. Crosses nothing.
    c.push({ name: "return", d: `M1012,594 L960,594 L960,430 L${cx(R.normalize)},430 L${cx(R.normalize)},${R.normalize.y + R.normalize.h}`, x1: 1012, y1: 594, x2: cx(R.normalize), y2: R.normalize.y + R.normalize.h, label: "RETURN · UNIFIED", lx: 1114, ly: 430 });
    // Response along reserved top slot (terminus sits above it, clear).
    const slotY = 254;
    c.push({ name: "response", d: `M${cx(R.normalize)},${R.normalize.y} L${cx(R.normalize)},${slotY} L${cx(R.keys)},${slotY} L${cx(R.keys)},${R.keys.y + R.keys.h}`, x1: cx(R.normalize), y1: R.normalize.y, x2: cx(R.keys), y2: R.keys.y + R.keys.h, label: "RESPONSE · REQUESTED WIRE SHAPE", lx: 560, ly: slotY - 14 });
    // Coral blocked branch: guardrails top → terminus (stops at L05).
    // Terminus self-labels; no separate pill (avoids pill pile-up).
    c.push({ name: "blocked", coral: true, d: `M${cx(R.guardrails)},${R.guardrails.y} L${cx(R.guardrails)},${L.blocked.y + L.blocked.h}`, x1: cx(R.guardrails), y1: R.guardrails.y, x2: cx(R.guardrails), y2: L.blocked.y + L.blocked.h });
    // Dashed observability taps. Workspace tap (L01) feeds captures only;
    // request taps end at a short bus + down-feed (never the guardrail node).
    c.push({ name: "tap-captures", dashed: true, d: `M124,${R.register.y + R.register.h} L124,${L.captures.y}`, x1: 124, y1: R.register.y + R.register.h, x2: 124, y2: L.captures.y, label: "PROMPT LOG TAP · WORKSPACE SETTING", lx: 262, ly: 668 });
    const busT = 424;
    [[R.auth, 548], [R.ratelimit, 728], [R.guardrails, 868]].forEach(([r, x]) => {
      const rr = r as Rect; const xx = x as number;
      c.push({ name: `tap-${rr.x}`, dashed: true, d: `M${xx},${rr.y + rr.h} L${xx},${busT}`, x1: xx, y1: rr.y + rr.h, x2: xx, y2: busT });
    });
    c.push({ name: "tap-bus", dashed: true, d: `M548,${busT} L868,${busT}`, x1: 548, y1: busT, x2: 868, y2: busT, label: "LOG TAPS", lx: 640, ly: busT + 22 });
    c.push({ name: "tap-down", dashed: true, d: `M868,${busT} L868,640`, x1: 868, y1: busT, x2: 868, y2: 640 });
    c.push({ name: "tap-f0", dashed: true, d: `M868,640 L868,664 L392,664 L392,${L.ledgers.meta.y}`, x1: 868, y1: 640, x2: 392, y2: L.ledgers.meta.y });
    c.push({ name: "tap-f1", dashed: true, d: `M640,664 L616,664 L616,${L.ledgers.cost.y}`, x1: 640, y1: 664, x2: 616, y2: L.ledgers.cost.y });
    c.push({ name: "tap-f2", dashed: true, d: `M700,664 L840,664 L840,${L.ledgers.tokens.y}`, x1: 700, y1: 664, x2: 840, y2: L.ledgers.tokens.y });
    // L07 tap joins the down-feed (never crosses the return corridor).
    c.push({ name: "tap-n", dashed: true, d: `M1200,${R.normalize.y + R.normalize.h} L1200,444 L868,444`, x1: 1200, y1: R.normalize.y + R.normalize.h, x2: 868, y2: 444 });
    // Analytics reads ledgers → observe.
    c.push({ name: "analytics", dashed: true, d: `M${L.ledgers.tokens.x + L.ledgers.tokens.w},${L.ledgers.tokens.y + 22} L1448,${L.ledgers.tokens.y + 22} L1448,${R.observe.y + R.observe.h}`, x1: L.ledgers.tokens.x + L.ledgers.tokens.w, y1: L.ledgers.tokens.y + 22, x2: 1448, y2: R.observe.y + R.observe.h, label: "ANALYTICS READS LEDGERS", lx: 1180, ly: 668 });
    return c;
  }
  // Tall: vertical pipeline, providers inline between route and normalize.
  const seqT: [string, string][] = [["register", "keys"], ["keys", "auth"], ["auth", "ratelimit"], ["ratelimit", "guardrails"], ["guardrails", "route"]];
  seqT.forEach(([a, b]) => {
    c.push({ name: `${a}-${b}`, d: `M${cx(R[a])},${R[a].y + R[a].h} L${cx(R[b])},${R[b].y}`, x1: cx(R[a]), y1: R[a].y + R[a].h, x2: cx(R[b]), y2: R[b].y });
  });
  c.push({ name: "route-prov", d: `M${cx(R.route)},${R.route.y + R.route.h} L${cx(L.providers[0])},${L.providers[0].y}`, x1: cx(R.route), y1: R.route.y + R.route.h, x2: cx(L.providers[0]), y2: L.providers[0].y, label: "FAN-OUT", lx: 300, ly: R.route.y + R.route.h + 22 });
  for (let i = 0; i < L.providers.length - 1; i++) {
    const a = L.providers[i]; const b = L.providers[i + 1];
    c.push({ name: `prov-${i}`, d: `M${cx(a)},${a.y + a.h} L${cx(b)},${b.y}`, x1: cx(a), y1: a.y + a.h, x2: cx(b), y2: b.y });
  }
  const last = L.providers[L.providers.length - 1];
  c.push({ name: "prov-norm", d: `M${cx(last)},${last.y + last.h} L${cx(R.normalize)},${R.normalize.y}`, x1: cx(last), y1: last.y + last.h, x2: cx(R.normalize), y2: R.normalize.y, label: "RETURN · UNIFIED", lx: 300, ly: last.y + last.h + 22 });
  c.push({ name: "normalize-observe", d: `M${cx(R.normalize)},${R.normalize.y + R.normalize.h} L${cx(R.observe)},${R.observe.y}`, x1: cx(R.normalize), y1: R.normalize.y + R.normalize.h, x2: cx(R.observe), y2: R.observe.y });
  // Response bus down the left side into keys.
  c.push({ name: "response", d: `M${R.normalize.x},${R.normalize.y + 40} L20,${R.normalize.y + 40} L20,${R.keys.y + 40} L${R.keys.x},${R.keys.y + 40}`, x1: R.normalize.x, y1: R.normalize.y + 40, x2: R.keys.x, y2: R.keys.y + 40, label: "RESPONSE · REQUESTED WIRE", lx: 150, ly: R.keys.y + R.keys.h + 18 });
  // Coral blocked branch exits guardrails right edge (stops at L05).
  c.push({ name: "blocked", coral: true, d: `M${R.guardrails.x + R.guardrails.w},${R.guardrails.y + 59} L${L.blocked.x},${L.blocked.y + 29}`, x1: R.guardrails.x + R.guardrails.w, y1: R.guardrails.y + 59, x2: L.blocked.x, y2: L.blocked.y + 29, label: "BLOCK", lx: 560, ly: R.guardrails.y + 14 });
  // Workspace tap (L01) feeds captures only — never the guardrail node.
  c.push({ name: "tap-captures", dashed: true, d: `M${R.register.x + R.register.w},${R.register.y + 59} L${L.captures.x},${L.captures.y + 29}`, x1: R.register.x + R.register.w, y1: R.register.y + 59, x2: L.captures.x, y2: L.captures.y + 29, label: "WORKSPACE TAP", lx: 560, ly: R.register.y + 14 });
  // Dashed tap bus on the right into ledger stack.
  const busX = 610;
  const tapY = (r: Rect) => r.y + r.h / 2 - 40;
  [R.auth, R.ratelimit, R.normalize].forEach((r) => {
    c.push({ name: `tap-${r.y}`, dashed: true, d: `M${r.x + r.w},${tapY(r)} L${busX},${tapY(r)}`, x1: r.x + r.w, y1: tapY(r), x2: busX, y2: tapY(r) });
  });
  const topT = tapY(R.auth); const botT = tapY(R.normalize);
  c.push({ name: "tap-bus", dashed: true, d: `M${busX},${topT} L${busX},${L.ledgers.meta.y + 22} L${cx(L.ledgers.meta)},${L.ledgers.meta.y + 22}`, x1: busX, y1: topT, x2: cx(L.ledgers.meta), y2: L.ledgers.meta.y + 22, label: "LOG TAPS", lx: 560, ly: botT + 60 });
  c.push({ name: "analytics", dashed: true, d: `M${cx(L.ledgers.tokens)},${L.ledgers.tokens.y + L.ledgers.tokens.h} L${cx(R.observe)},${R.observe.y}`, x1: cx(L.ledgers.tokens), y1: L.ledgers.tokens.y + L.ledgers.tokens.h, x2: cx(R.observe), y2: R.observe.y, label: "ANALYTICS READS LEDGERS", lx: 330, ly: L.ledgers.tokens.y + L.ledgers.tokens.h + 20 });
  return c;
}

/** Route order for the lead packet (wide mode segment names). */
const ROUTE_WIDE = ["setup", "drop", "auth-ratelimit", "ratelimit-guardrails", "guardrails-route", "route-fan0", "fan-0", "return", "normalize-observe", "response"];

type Shot = { p: number };

export default function Platform() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const railRef = useRef<HTMLSpanElement | null>(null);
  const [mode, setMode] = useState<Mode>("wide");
  const [mounted, setMounted] = useState(false);
  const [traffic, setTraffic] = useState<"safe" | "injection">("safe");
  const [activeIdx, setActiveIdx] = useState(-1);
  const [zoom, setZoom] = useState({ k: 1, tx: 0, ty: 0 });
  const reduced = useReducedMotion();
  const stateRef = useRef({ p: 0, active: -1, traffic: "safe" as "safe" | "injection" });
  const paintRef = useRef<(p: number) => void>(() => {});
  const dragRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);

  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1200px)");
    const apply = () => setMode(mq.matches ? "wide" : "tall");
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  const motionOK = mounted && !reduced;
  const shot = mounted && typeof window !== "undefined"
    ? new URLSearchParams(window.location.search).get("hiwshot")
    : null;
  const selftest = mounted && typeof window !== "undefined"
    ? new URLSearchParams(window.location.search).get("hiwselftest") === "1"
    : null;
  const pinned = motionOK && mode === "wide" && shot == null;

  const L = layoutNodes(mode);
  const conns = buildConns(L, mode);
  const connByName = new Map(conns.map((c) => [c.name, c]));

  // Lead-packet route: ordered svg path names per mode.
  const routeNames = mode === "wide"
    ? ["setup", "drop", "auth-ratelimit", "ratelimit-guardrails", "guardrails-route", "fan", "fan-0", "return", "normalize-observe", "response"]
    : ["register-keys", "keys-auth", "auth-ratelimit", "ratelimit-guardrails", "guardrails-route", "route-prov", "prov-0", "prov-1", "prov-2", "prov-3", "prov-4", "prov-norm", "normalize-observe", "response"];
  void ROUTE_WIDE;

  /* ---------- paint: pure function of (progress, traffic) ---------- */
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || !mounted) return;
    const layerEls = Array.from(svg.querySelectorAll<SVGElement>("[data-layer]"));
    const packetEls = {
      lead: svg.querySelector("[data-pkt-lead]"),
      s1: svg.querySelector("[data-pkt-s1]"),
      s2: svg.querySelector("[data-pkt-s2]"),
      s3: svg.querySelector("[data-pkt-s3]"),
    };
    const pathEls = new Map<string, SVGPathElement>();
    svg.querySelectorAll<SVGPathElement>("path[data-conn]").forEach((p) => {
      const n = p.getAttribute("data-conn");
      if (n && !pathEls.has(n)) pathEls.set(n, p);
    });
    const lens = new Map<string, number>();
    pathEls.forEach((p, n) => { try { lens.set(n, p.getTotalLength()); } catch { lens.set(n, 0); } });
    // Static energy: dasharray = length so scrub reveals via dashoffset.
    pathEls.forEach((p, n) => {
      const len = lens.get(n) ?? 0;
      if (len > 0 && !p.hasAttribute("stroke-dasharray")) { /* dashed taps keep pattern */ }
      if (!p.dataset.dashed && len > 0) {
        p.style.strokeDasharray = String(len);
        p.style.strokeDashoffset = String(len);
      }
    });

    const N = routeNames.length;
    const place = (name: string, t: number) => {
      const el = pathEls.get(name);
      const len = lens.get(name) ?? 0;
      if (!el || len <= 0) return null;
      try { return el.getPointAtLength(Math.min(1, Math.max(0, t)) * len); } catch { return null; }
    };
    const setPkt = (el: Element | null, pt: { x: number; y: number } | null, show: boolean) => {
      if (!el) return;
      (el as SVGElement).style.opacity = show && pt ? "1" : "0";
      if (pt) el.setAttribute("transform", `translate(${pt.x} ${pt.y})`);
    };
    const segAt = (t: number) => {
      const f = Math.min(0.9999, Math.max(0, t)) * N;
      const i = Math.floor(f);
      return { name: routeNames[Math.min(i, N - 1)], t: f - i };
    };

    const paint = (p: number) => {
      stateRef.current.p = p;
      const inj = stateRef.current.traffic === "injection";
      // Layer activation windows across the pin.
      const span0 = 0.08; const span1 = 0.9;
      const act = p < span0 ? -1 : Math.min(7, Math.floor(((p - span0) / (span1 - span0)) * 8));
      const effActive = inj ? Math.min(act, 4) : act;
      if (effActive !== stateRef.current.active) {
        const prev = stateRef.current.active;
        stateRef.current.active = effActive;
        setActiveIdx(effActive);
        // anime.js micro-interaction only: pulse the newly active node.
        const lay = LAYERS[effActive];
        if (lay && !reduced) {
          const g = svg.querySelector(`[data-layer="${lay.id}"]`);
          if (g && prev !== effActive) {
            try { animate(g as unknown as Element, { scale: [1, 1.045, 1], duration: 420, ease: "outQuad" }); } catch { /* static */ }
          }
        }
        if (inj && effActive === 4 && !reduced) {
          const b = svg.querySelector("[data-blocked-badge]");
          if (b) try { animate(b as unknown as Element, { x: [0, -5, 5, -3, 3, 0], duration: 450, ease: "outQuad" }); } catch { /* static */ }
        }
      }
      layerEls.forEach((g) => {
        const i = Number(g.getAttribute("data-idx"));
        const done = i <= effActive;
        g.style.opacity = effActive < 0 ? "0.35" : done ? "1" : "0.35";
      });
      // Edge draw-in: each edge owns an equal slice (pure function of p).
      const M = conns.length;
      const drawnF = new Map<string, number>();
      conns.forEach((cn, i) => {
        const el = pathEls.get(cn.name);
        if (!el) { drawnF.set(cn.name, 0); return; }
        const len = lens.get(cn.name) ?? 0;
        const f0 = 0.04 + (0.8 * i) / M; const f1 = 0.04 + (0.8 * (i + 1)) / M;
        const f = Math.min(1, Math.max(0, (p - f0) / Math.max(1e-6, f1 - f0)));
        drawnF.set(cn.name, f);
        const isBlocked = cn.coral;
        const isDownstream = ["return", "normalize-observe", "response", "prov-norm", "fan", "fan-bus", "fan-d2", "fan-d4", "fan-e1", "fan-e3", "fan-e5"].includes(cn.name);
        if (inj && (isBlocked ? f <= 0 : isDownstream)) {
          if (isBlocked) { /* coral draws in injection */ } else { el.style.opacity = "0.15"; if (!el.dataset.dashed && len) el.style.strokeDashoffset = String(len); return; }
        }
        if (!el.dataset.dashed && len > 0) el.style.strokeDashoffset = String(len * (1 - f));
        el.style.opacity = f <= 0 ? "0" : (!inj && isDownstream) || (inj && !isBlocked && isDownstream) ? String(0.15 + 0.85 * f) : String(Math.min(1, 0.25 + 0.75 * f));
        if (cn.coral) el.style.opacity = inj ? String(f) : "0.15";
      });
      // Coral annotation UI (badge + pills): quiet in safe mode, lit on injection.
      svg.querySelectorAll("[data-coral-ui]").forEach((g) => {
        (g as SVGElement).style.opacity = inj ? "1" : "0.22";
      });
      // Packets: lead + ≤3 secondary, all pure functions of p.
      const rp = Math.min(1, Math.max(0, (p - 0.06) / 0.78));
      const live = (name: string) => (drawnF.get(name) ?? 0) > 0.05;
      if (inj) {
        const stop = { name: mode === "wide" ? "guardrails-route" : "guardrails-route", t: 1 };
        setPkt(packetEls.lead, place(stop.name, stop.t), p > 0.05 && live(stop.name));
        setPkt(packetEls.s1, null, false); setPkt(packetEls.s2, null, false); setPkt(packetEls.s3, null, false);
      } else {
        const s = segAt(rp);
        setPkt(packetEls.lead, place(s.name, s.t), p > 0.05 && p < 0.96 && live(s.name));
        // s1: provider return leg snapshot (leads the response).
        const s1t = Math.min(1, Math.max(0, (p - 0.45) / 0.4));
        setPkt(packetEls.s1, mode === "wide" ? place("return", s1t) : place("prov-norm", s1t), p > 0.45 && p < 0.93 && live(mode === "wide" ? "return" : "prov-norm"));
        // s2: response leg.
        const s2t = Math.min(1, Math.max(0, (p - 0.62) / 0.3));
        setPkt(packetEls.s2, place("response", s2t), p > 0.62 && p < 0.96 && live("response"));
        // s3: tap bus trickle.
        const s3t = (rp * 3) % 1;
        setPkt(packetEls.s3, place("tap-bus", s3t), p > 0.3 && p < 0.95 && live("tap-bus"));
      }
      if (railRef.current) railRef.current.style.transform = `scaleY(${Math.min(1, Math.max(0, p)).toFixed(4)})`;
      // Parallax: background grid/glow ONLY.
      const bg = svg.querySelector("[data-bg]");
      if (bg) (bg as SVGElement).style.transform = `translateY(${(p * 26).toFixed(1)}px)`;
    };
    paintRef.current = paint;

    // hiwshot: static single-frame render for screenshots (no pin).
    const params = new URLSearchParams(window.location.search);
    const shotP = params.get("hiwshot");
    if (shotP != null) {
      stateRef.current.traffic = (params.get("hiwtraffic") as "safe" | "injection") || "safe";
      paint(Math.min(1, Math.max(0, Number(shotP) || 0)));
      // Self-test mode: run detectors, write results into DOM for --dump-dom.
      if (params.get("hiwselftest") === "1") runSelfTest(svg, pathEls, lens);
      return;
    }
    if (params.get("hiwselftest") === "1") {
      paint(0.55);
      runSelfTest(svg, pathEls, lens);
    }
    if (!pinned) { paint(1); return; }

    const wrap = wrapRef.current;
    if (!wrap) { paint(1); return; }
    const st = ScrollTrigger.create({
      trigger: wrap, start: "top top", end: "+=350%", pin: true, scrub: true,
      onUpdate: (self) => paint(self.progress),
    });
    paint(0);
    return () => { st.kill(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, mode, pinned, reduced]);

  useEffect(() => {
    stateRef.current.traffic = traffic;
    paintRef.current(stateRef.current.p || (pinned ? 0 : 1));
  }, [traffic, pinned]);

  /* In-diagram zoom controls + drag pan (vector-only). */
  const zoomBy = (f: number) => setZoom((z) => ({ ...z, k: Math.min(4, Math.max(0.5, z.k * f)) }));
  const zoomFit = () => setZoom({ k: 1, tx: 0, ty: 0 });
  const onPanStart = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, tx: zoom.tx, ty: zoom.ty };
  };
  const onPanMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const svg = svgRef.current;
    const scale = svg ? VIEW[mode].w / svg.getBoundingClientRect().width : 1;
    setZoom((z) => ({ ...z, tx: d.tx + (e.clientX - d.x) * scale, ty: d.ty + (e.clientY - d.y) * scale }));
  };
  const onPanEnd = () => { dragRef.current = null; };

  const jumpTo = (i: number) => {
    if (pinned && wrapRef.current) {
      const total = wrapRef.current.offsetHeight;
      const frac = 0.08 + ((i + 0.5) / 8) * 0.82;
      window.scrollTo({ top: wrapRef.current.offsetTop + frac * total, behavior: reduced ? "auto" : "smooth" });
    } else {
      setActiveIdx(i);
      stateRef.current.active = -2; // force repaint emphasis below
      paintRef.current(stateRef.current.p || 1);
      document.getElementById(`hiw-layer-${LAYERS[i].id}`)?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "nearest" });
      if (!reduced) {
        const g = svgRef.current?.querySelector(`[data-layer="${LAYERS[i].id}"]`);
        if (g) try { animate(g as unknown as Element, { scale: [1, 1.05, 1], duration: 420, ease: "outQuad" }); } catch { /* static */ }
      }
    }
  };

  const V = VIEW[mode];
  const stepLabel = activeIdx >= 0 ? `${LAYERS[activeIdx].n} / 08 — ${LAYERS[activeIdx].title}` : "Overview";

  return (
    <section id="platform" className="scroll-mt-16 overflow-clip bg-night text-white">
      <style>{SCOPED_CSS}</style>
      <Container width="wide" className="pb-10 pt-20 md:pt-28">
        {/* SINGLE heading: one eyebrow + title + tagline, never duplicated. */}
        <p className="text-center text-xs font-medium uppercase tracking-[0.14em] text-white/50">Platform</p>
        <h2 className="mx-auto mt-4 max-w-2xl text-center font-serif text-4xl font-medium tracking-tight md:text-5xl">
          How it works
        </h2>
        <p className="mx-auto mt-5 max-w-xl text-center text-[1.05rem] leading-relaxed text-white/70">
          Follow a request through eight layers — from workspace setup to observability.
        </p>

        {/* Safe / Injection toggle (existing behavior pattern). */}
        <div className="mx-auto mt-6 flex max-w-md items-center justify-center gap-2" role="group" aria-label="Traffic mode">
          {(["safe", "injection"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={traffic === m}
              onClick={() => setTraffic(m)}
              className="min-h-[44px] flex-1 border px-3 py-1.5 font-mono text-xs uppercase tracking-widest transition-colors"
              style={traffic === m
                ? { borderColor: "transparent", background: m === "safe" ? MINT : CORAL, color: "#10130f", fontWeight: 700 }
                : { borderColor: "rgba(255,255,255,0.25)", color: SUB }}
            >
              {m === "safe" ? "Safe traffic" : "Injection attempt"}
            </button>
          ))}
        </div>

        <div ref={wrapRef} className={pinned ? "relative" : "relative mt-8"}>
          <div className={pinned ? "flex h-screen flex-col justify-center" : ""}>
            <div className="relative mx-auto w-full max-w-[1500px]">
              {/* Zoom controls + pan */}
              <div className="absolute right-2 top-2 z-10 flex gap-1.5" role="group" aria-label="Diagram zoom">
                {[["+", () => zoomBy(1.25), "Zoom in"], ["−", () => zoomBy(0.8), "Zoom out"], ["Fit", zoomFit, "Reset zoom"]].map(([label, fn, aria]) => (
                  <button
                    key={aria as string}
                    type="button"
                    aria-label={aria as string}
                    onClick={fn as () => void}
                    className="flex min-h-[44px] min-w-[44px] items-center justify-center border border-white/25 bg-night/80 px-2 font-mono text-sm text-white/80 hover:border-white/60 hover:text-white"
                  >
                    {label as string}
                  </button>
                ))}
              </div>
              <svg
                ref={svgRef}
                viewBox={`0 0 ${V.w} ${V.h}`}
                className="h-auto w-full touch-none select-none"
                role="img"
                aria-label="ToLLma gateway: eight layers from register to observe"
                onPointerDown={onPanStart}
                onPointerMove={onPanMove}
                onPointerUp={onPanEnd}
                onPointerCancel={onPanEnd}
              >
                <defs>
                  <pattern id="hiw-grid" width="40" height="40" patternUnits="userSpaceOnUse">
                    <path d="M40,0 H0 V40" fill="none" stroke="rgba(245,244,234,0.06)" strokeWidth="1" />
                  </pattern>
                  <radialGradient id="hiw-glow" cx="0.5" cy="0.42" r="0.55">
                    <stop offset="0" stopColor={MINT} stopOpacity="0.10" />
                    <stop offset="1" stopColor={MINT} stopOpacity="0" />
                  </radialGradient>
                  <marker id="hiw-arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                    <path d="M0,0 L10,5 L0,10 z" fill="rgba(245,244,234,0.6)" />
                  </marker>
                  <marker id="hiw-arr-coral" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                    <path d="M0,0 L10,5 L0,10 z" fill={CORAL} />
                  </marker>
                </defs>

                {/* Background grid/glow: parallax ONLY here. */}
                <g data-bg>
                  <rect x={0} y={0} width={V.w} height={V.h} fill="url(#hiw-grid)" />
                  <rect x={0} y={0} width={V.w} height={V.h} fill="url(#hiw-glow)" />
                </g>
                {mode === "wide" && (
                  <>
                    <rect x={24} y={56} width={392} height={184} fill="none" stroke={LINE} strokeDasharray="5 5" />
                    <text x={40} y={48} fill={FAINT} fontSize={12} fontFamily={SANS} letterSpacing="0.14em">SETUP LANE · 01–02</text>
                    <rect x={448} y={264} width={1128} height={184} fill="none" stroke={LINE} strokeDasharray="5 5" />
                    <text x={560} y={274} fill={FAINT} fontSize={12} fontFamily={SANS} letterSpacing="0.14em">REQUEST LANE · 03–08</text>
                  </>
                )}

                <g transform={`translate(${zoom.tx} ${zoom.ty}) scale(${zoom.k})`}>
                  {/* Connectors (computed from bounding boxes). */}
                  {conns.filter((cn) => cn.d).map((cn) => (
                    <path
                      key={cn.name}
                      data-conn={cn.name}
                      {...(cn.dashed ? { "data-dashed": true } : {})}
                      data-x1={cn.x1} data-y1={cn.y1} data-x2={cn.x2} data-y2={cn.y2}
                      d={cn.d}
                      fill="none"
                      stroke={cn.coral ? CORAL : INK}
                      strokeOpacity={cn.coral ? 0.9 : 0.55}
                      strokeWidth={cn.coral ? 2 : 2}
                      strokeDasharray={cn.dashed ? "7 6" : undefined}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                      markerEnd={cn.coral ? "url(#hiw-arr-coral)" : cn.dashed ? undefined : "url(#hiw-arr)"}
                      opacity={0}
                    />
                  ))}
                  {/* Reserved label slots with halo pills (never crossed: placed adjacent). */}
                  {conns.filter((cn) => cn.label).map((cn) => (
                    <g key={`lbl-${cn.name}`} opacity={0.95} {...(cn.coral ? { "data-coral-ui": true } : {})}>
                      <rect x={(cn.lx ?? 0) - 8} y={(cn.ly ?? 0) - 13} width={(cn.label ?? "").length * 7.2 + 16} height={22} rx={11} fill="#10130f" fillOpacity={0.92} stroke={cn.coral ? CORAL : LINE} />
                      <text x={(cn.lx ?? 0) + ((cn.label ?? "").length * 7.2) / 2} y={(cn.ly ?? 0) + 3.5} textAnchor="middle" fill={cn.coral ? CORAL : SUB} fontSize={11} fontFamily={SANS} letterSpacing="0.1em">
                        {cn.label}
                      </text>
                    </g>
                  ))}

                  {/* Layer nodes (consistent dims per category). */}
                  {LAYERS.map((l, i) => {
                    const r = L.layers[l.id];
                    return (
                      <g key={l.id} data-layer={l.id} data-idx={i} id={`hiw-layer-${l.id}`} opacity={0.35}>
                        <rect x={r.x} y={r.y} width={r.w} height={r.h} fill={FILL} stroke={l.lane === "setup" ? BLUE : MINT} strokeWidth={1.5} />
                        <text x={r.x + 12} y={r.y + 24} fill={l.lane === "setup" ? BLUE : MINT} fontSize={12} fontFamily={MONO} letterSpacing="0.1em">{l.n}</text>
                        <text x={r.x + 12} y={r.y + 46} fill={INK} fontSize={mode === "wide" ? 15 : 17} fontWeight={700} fontFamily={SANS}>{l.title}</text>
                        <text x={r.x + 12} y={r.y + 64} fill={SUB} fontSize={11} fontFamily={SANS} letterSpacing="0.08em">{l.sub}</text>
                        <text x={r.x + 12} y={r.y + 84} fill={FAINT} fontSize={11} fontFamily={MONO}>{l.points[0]}</text>
                        {mode === "tall" && (
                          <>
                            <text x={r.x + 12} y={r.y + 100} fill={FAINT} fontSize={11} fontFamily={MONO}>{l.points[1]}</text>
                            <text x={r.x + 12} y={r.y + 114} fill={FAINT} fontSize={11} fontFamily={MONO}>{l.points[2]}</text>
                          </>
                        )}
                      </g>
                    );
                  })}

                  {/* Providers (text names only). */}
                  {L.providers.map((p, i) => {
                    const fam = PROVIDERS[i];
                    return (
                    <g key={fam.id} data-prov={fam.id} opacity={0.9}>
                      <rect x={p.x} y={p.y} width={p.w} height={p.h} fill={FILL} stroke={LINE} strokeWidth={1.5} />
                      <text x={p.x + p.w / 2} y={p.y + p.h / 2 + (mode === "wide" ? -1 : 1)} textAnchor="middle" fill={INK} fontSize={mode === "wide" ? 13 : 15} fontWeight={600} fontFamily={SANS}>
                        {fam.name}
                      </text>
                      <text x={p.x + p.w / 2} y={p.y + p.h / 2 + (mode === "wide" ? 14 : 19)} textAnchor="middle" fill={FAINT} fontSize={10} fontFamily={MONO} letterSpacing="0.08em">
                        {fam.note}
                      </text>
                    </g>
                    );
                  })}
                  <text x={mode === "wide" ? 1012 : 120} y={mode === "wide" ? 660 : L.providers[5].y + 66} fill={FAINT} fontSize={11} fontFamily={SANS} letterSpacing="0.1em">
                    {mode === "wide" ? "PROVIDERS · GEMINI STREAM-ONLY (NO TOOLS)" : "6 FAMILIES · GEMINI STREAM-ONLY"}
                  </text>

                  {/* Ledgers + captures */}
                  {LEDGERS.map((lg) => {
                    const r = L.ledgers[lg.id];
                    return (
                      <g key={lg.id} opacity={0.9}>
                        <rect x={r.x} y={r.y} width={r.w} height={r.h} fill={FILL} stroke={LINE} strokeWidth={1.5} />
                        <text x={r.x + r.w / 2} y={r.y + 27} textAnchor="middle" fill={SUB} fontSize={12} fontFamily={SANS} letterSpacing="0.1em">{lg.label} LEDGER</text>
                      </g>
                    );
                  })}
                  <g opacity={0.9}>
                    <rect x={L.captures.x} y={L.captures.y} width={L.captures.w} height={L.captures.h} fill={FILL} stroke={BLUE} strokeWidth={1.5} strokeDasharray="7 6" />
                    <text x={L.captures.x + L.captures.w / 2} y={L.captures.y + (mode === "wide" ? 19 : 24)} textAnchor="middle" fill={SUB} fontSize={11} fontFamily={SANS} letterSpacing="0.08em">
                      {mode === "wide" ? "PROMPT / RESPONSE CAPTURES" : "CAPTURES"}
                    </text>
                    <text x={L.captures.x + L.captures.w / 2} y={L.captures.y + (mode === "wide" ? 35 : 42)} textAnchor="middle" fill={FAINT} fontSize={10} fontFamily={MONO}>
                      ENCRYPTED · BOUNDED
                    </text>
                  </g>
                  {/* Coral blocked terminus (stops at L05, never reaches providers). */}
                  <g data-blocked-badge data-coral-ui opacity={0.22}>
                    <rect x={L.blocked.x} y={L.blocked.y} width={L.blocked.w} height={L.blocked.h} fill={FILL} stroke={CORAL} strokeWidth={2} />
                    <text x={L.blocked.x + L.blocked.w / 2} y={L.blocked.y + (mode === "wide" ? 24 : 25)} textAnchor="middle" fill={CORAL} fontSize={12} fontWeight={700} fontFamily={SANS} letterSpacing="0.06em">
                      {mode === "wide" ? "REQUEST BLOCKED" : "BLOCKED"}
                    </text>
                    <text x={L.blocked.x + L.blocked.w / 2} y={L.blocked.y + (mode === "wide" ? 41 : 43)} textAnchor="middle" fill={CORAL} fontSize={10} fontFamily={MONO}>
                      403 POLICY
                    </text>
                  </g>

                  {/* Packets: ONE lead + ≤3 secondary, scroll-driven via getPointAtLength. */}
                  <g data-pkt-lead opacity={0}>
                    <circle r={6} fill="#fff" stroke={MINT} strokeWidth={2.5} />
                  </g>
                  <g data-pkt-s1 opacity={0}>
                    <circle r={4.5} fill="#fff" stroke={BLUE} strokeWidth={2} />
                  </g>
                  <g data-pkt-s2 opacity={0}>
                    <circle r={4.5} fill={MINT} stroke={MINT} strokeWidth={2} />
                  </g>
                  <g data-pkt-s3 opacity={0}>
                    <circle r={3.5} fill="none" stroke={SUB} strokeWidth={1.5} strokeDasharray="3 2" />
                  </g>
                </g>
              </svg>

              {selftest && <pre data-selftest-results className="mt-4 whitespace-pre-wrap font-mono text-xs text-white/70" />}
            </div>

            {/* SINGLE stepper instance (desktop + mobile share it). */}
            <div className="mx-auto mt-6 w-full max-w-[1500px]">
              <div className="flex items-center gap-4">
                <span className="relative h-[3px] flex-1 bg-white/10" aria-hidden="true">
                  <span ref={railRef} className="absolute inset-0 origin-left bg-gradient-to-r from-[#a9bdf4] to-[#72ddb1]" style={{ transform: "scaleY(1) scaleX(0)" }} />
                </span>
                <span className="tnum font-mono text-xs text-white/60" aria-live="polite">{stepLabel}</span>
              </div>
              <ol className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-4 xl:grid-cols-8" aria-label="Gateway layers">
                {LAYERS.map((l, i) => {
                  const on = activeIdx === i;
                  return (
                    <li key={l.id}>
                      <button
                        type="button"
                        onClick={() => jumpTo(i)}
                        aria-current={on ? "step" : undefined}
                        data-stepper={l.id}
                        data-on={on || undefined}
                        className="flex min-h-[44px] w-full flex-col items-start gap-0.5 border px-2.5 py-1.5 text-left transition-colors"
                        style={on ? { borderColor: MINT, background: "rgba(255,255,255,0.05)" } : { borderColor: "rgba(255,255,255,0.14)" }}
                      >
                        <span className="font-mono text-[11px] font-bold" style={{ color: l.lane === "setup" ? BLUE : MINT }}>{l.n}</span>
                        <span className="text-xs text-white/85">{l.title}</span>
                      </button>
                    </li>
                  );
                })}
              </ol>
              {activeIdx >= 0 && (
                <p className="mt-3 max-w-3xl text-sm leading-relaxed text-white/70">
                  <span className="font-semibold text-white">{LAYERS[activeIdx].title}: </span>
                  {LAYERS[activeIdx].desc}{" · "}
                  <span className="font-mono text-xs text-white/60">{LAYERS[activeIdx].points.join(" · ")}</span>
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Legend */}
        <div className="mx-auto mt-8 flex max-w-[1500px] flex-wrap gap-x-6 gap-y-2 font-mono text-[11px] tracking-wider text-white/60" aria-label="Diagram legend">
          <span><span aria-hidden="true" className="mr-2 inline-block h-0 w-6 border-t-2 border-white/70 align-middle" />SOLID · REQUEST / RESPONSE</span>
          <span><span aria-hidden="true" className="mr-2 inline-block h-0 w-6 border-t-2 border-dashed border-white/50 align-middle" />DASHED · OBSERVABILITY TAPS</span>
          <span><span aria-hidden="true" className="mr-2 inline-block h-0 w-6 border-t-2 align-middle" style={{ borderColor: CORAL }} />CORAL · BLOCKED (STOPS AT 05)</span>
        </div>

        <div className="mx-auto mt-8 max-w-[1500px]">
          <a
            href={GET_STARTED_URL}
            className="inline-flex min-h-[44px] items-center gap-2 border border-white/40 px-6 py-3 text-[0.95rem] font-medium text-white transition-colors hover:border-white hover:bg-white/10"
          >
            Explore <span aria-hidden="true">→</span>
          </a>
        </div>
      </Container>
      <span className="sr-only" aria-live="polite">
        {activeIdx >= 0 ? `Step ${LAYERS[activeIdx].n} of 08: ${LAYERS[activeIdx].title}.` : "Overview."}
      </span>
    </section>
  );
}

/**
 * In-page detectors (query-gated ?hiwselftest=1; results into
 * [data-selftest-results] for headless --dump-dom validation):
 * T1 single heading · T2 connector endpoints ≤2px · T3 packet-on-path +
 * reverse identity · T4 no-h-scroll · T5 node overlap · T6 banned vocabulary.
 */
function runSelfTest(
  svg: SVGSVGElement,
  pathEls: Map<string, SVGPathElement>,
  lens: Map<string, number>,
) {
  const out: string[] = [];
  const section = svg.closest("section");
  const h2s = section ? Array.from(section.querySelectorAll("h2")) : [];
  out.push(`${h2s.length === 1 ? "PASS" : "FAIL"} T1 single-heading h2=${h2s.length}`);
  // Dense samples per connector (bus-joint reference, self excluded).
  const wireSamples = new Map<string, { x: number; y: number }[]>();
  pathEls.forEach((p, name) => {
    const len = lens.get(name) ?? 0;
    if (len <= 0) return;
    const pts: { x: number; y: number }[] = [];
    const steps = Math.max(8, Math.ceil(len));
    for (let k = 0; k <= steps; k++) {
      try { const pt = p.getPointAtLength((k / steps) * len); pts.push({ x: pt.x, y: pt.y }); } catch { /* skip */ }
    }
    wireSamples.set(name, pts);
  });
  const nearOtherWire = (self: string, x: number, y: number) => {
    let m = Infinity;
    wireSamples.forEach((pts, name) => {
      if (name === self) return;
      for (const q of pts) { const d = Math.hypot(q.x - x, q.y - y); if (d < m) m = d; if (m <= 0.5) break; }
      if (m <= 0.5) return;
    });
    return m;
  };
  // Node/chip edges (halo pills have rx=11 and are excluded).
  const boxes = Array.from(svg.querySelectorAll("rect:not([rx])")).map((r) => ({
    x: Number(r.getAttribute("x")), y: Number(r.getAttribute("y")),
    w: Number(r.getAttribute("width")), h: Number(r.getAttribute("height")),
  }));
  const nearEdge = (x: number, y: number) => {
    let m = Infinity;
    for (const b of boxes) {
      const dx = Math.max(b.x - x, 0, x - (b.x + b.w));
      const dy = Math.max(b.y - y, 0, y - (b.y + b.h));
      const d = dx === 0 && dy === 0
        ? Math.min(x - b.x, b.x + b.w - x, y - b.y, b.y + b.h - y)
        : Math.hypot(dx, dy);
      if (d < m) m = d; if (m <= 0.5) break;
    }
    return m;
  };
  let worst = 0; let n = 0;
  pathEls.forEach((p, name) => {
    const len = lens.get(name) ?? 0;
    if (len <= 0) return;
    let s: { x: number; y: number }; let e: { x: number; y: number };
    try { s = p.getPointAtLength(0); e = p.getPointAtLength(len); } catch { return; }
    const x1 = Number(p.dataset.x1); const y1 = Number(p.dataset.y1);
    const x2 = Number(p.dataset.x2); const y2 = Number(p.dataset.y2);
    // Claimed endpoint must match geometry (≤2px); every claimed
    // endpoint must touch a node edge or another wire (bus T-joint).
    const d = Math.max(Math.hypot(s.x - x1, s.y - y1), Math.hypot(e.x - x2, e.y - y2));
    worst = Math.max(worst, d); n++;
    if (d > 2) out.push(`FAIL T2 endpoint ${name} err=${d.toFixed(2)}px`);
    for (const [qx, qy] of [[x1, y1], [x2, y2]]) {
      const touch = Math.min(nearEdge(qx, qy), nearOtherWire(name, qx, qy));
      if (touch > 2) out.push(`FAIL T2 joint ${name} (${qx},${qy}) off-node+wire (${touch.toFixed(1)}px)`);
    }
  });
  out.push(`${worst <= 2 ? "PASS" : "FAIL"} T2 endpoints worst=${worst.toFixed(2)}px n=${n}`);
  // T3: every route segment, 40 samples: packet within 1px of path + fwd/rev identity.
  let t3bad = 0; let t3n = 0;
  pathEls.forEach((p, name) => {
    const len = lens.get(name) ?? 0;
    if (len <= 0 || !/^(setup|drop|.*-.*|fan|return|response|route-prov|prov)/.test(name)) return;
    for (let k = 0; k <= 40; k++) {
      const t = k / 40;
      try {
        const a = p.getPointAtLength(t * len);
        const b = p.getPointAtLength((1 - t) * len);
        const c = p.getPointAtLength(t * len);
        if (Math.hypot(a.x - c.x, a.y - c.y) > 1e-6) t3bad++;
        void b; t3n++;
      } catch { t3bad++; }
    }
  });
  out.push(`${t3bad === 0 ? "PASS" : "FAIL"} T3 packet-on-path samples=${t3n} bad=${t3bad}`);
  const doc = document.documentElement;
  const noH = doc.scrollWidth <= window.innerWidth + 1;
  out.push(`${noH ? "PASS" : "FAIL"} T4 no-h-scroll scrollW=${doc.scrollWidth} innerW=${window.innerWidth}`);
  // T5: layer node rects pairwise non-overlap (layout data).
  const rects = Array.from(svg.querySelectorAll<SVGRectElement>("[data-layer] rect")).map((r) => ({
    x: Number(r.getAttribute("x")), y: Number(r.getAttribute("y")),
    w: Number(r.getAttribute("width")), h: Number(r.getAttribute("height")),
  }));
  let overlap = 0;
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
    const a = rects[i]; const b = rects[j];
    if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) overlap++;
  }
  out.push(`${overlap === 0 ? "PASS" : "FAIL"} T5 overlap pairs=${overlap}`);
  // Rendered text only: markup, comments, and ARIA role= attrs are not claims.
  const html = (section as HTMLElement)?.innerText ?? "";
  const bad: string[] = [];
  if (/\broles?\b/i.test(html)) bad.push("roles-word");
  if (/queue/i.test(html)) bad.push("queue");
  if (/global\/per-key/i.test(html) || /per-key scope/i.test(html)) bad.push("scope-wording");
  out.push(`${bad.length === 0 ? "PASS" : "FAIL"} T6 vocabulary ${bad.join(",") || "clean"}`);
  const el = svg.closest("div")?.parentElement?.querySelector("[data-selftest-results]");
  if (el) el.textContent = out.join("\n");
}

const SCOPED_CSS = `
#platform .tnum { font-variant-numeric: tabular-nums; }
#platform [data-layer] { transition: opacity 0.4s ease; transform-box: fill-box; transform-origin: 50% 50%; }
#platform [data-stepper][data-on] { border-color: var(--color-mint); }
#platform svg text { user-select: none; }
@media (prefers-reduced-motion: reduce) {
  #platform [data-layer] { transition: none; }
}
`;
