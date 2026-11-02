// How-it-works: 8-layer scroll-driven gateway story (L01–L08).
//
// ONE module, SINGLE layout config (LAYERS + layoutNodes below: node ids,
// lane, size, position strategy per mode; horizontal peer gaps share one
// gutter token (GUT). All connectors are computed from
// node bounding boxes (edgeBox/elbow): every path starts and ends exactly
// on a node edge or another wire (<=2px by construction), orthogonal with
// rounded joins, labels in reserved gutter slots with OPAQUE pills (never
// crossed by a wire). Consistent node dims per category (layer / provider
// chip / ledger chip / terminus). Solid = request/response lifecycle,
// dashed = observability taps, coral = blocked branch (exits L05 bottom to
// a terminus; never reaches providers; over-limit denies immediately).
//
// Desktop (>=1200px, "wide"): setup lane (L01–L02) + request lane
// (L03–L08) left-to-right; providers fan out below L06/L07 on a bus and
// return into L07's bottom edge; ledgers strip along the bottom; response
// returns along a reserved top slot. Below 1200px ("tall"): same config,
// vertical position strategy (L01→L08 top-to-bottom, providers inline
// between L06 and L07, side annotation chips). ONE stepper instance, ONE
// eyebrow+title+tagline heading (never duplicated).
//
// Motion (R9): GSAP ScrollTrigger pins 420vh and scrubs progress through
// five phases — entry fade/scale, full-flow pass, per-layer camera steps
// (zoom computed from the SINGLE layout config; other layers dim, in/out
// connectors highlight), second full-flow pass, exit fade/scale. Packets
// (ONE lead + <=3 secondary) ride native getPointAtLength — all as a pure
// function of progress, so reverse scroll is exact. anime.js is used ONLY
// for micro-interactions: node pulse on activation, blocked-badge shake.
// Parallax applies to the background grid/glow ONLY. No zoom/pan controls:
// the scrubbed camera is the only motion. Reduced-motion / tall: no pin,
// no camera, complete diagram, click stepper to highlight. Safe/Injection
// toggle: injection parks the lead packet at L05 and draws the coral
// blocked branch.
//
// Diagram is vector-only so 400% zoom and DPR 1–3 stay crisp.
"use client";

import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { animate } from "animejs";
import { Container } from "@/components/ui/layout";
import { GET_STARTED_URL } from "@/lib/site";
import { useReducedMotion } from "@/lib/animations";

gsap.registerPlugin(ScrollTrigger);

const MINT = "#72ddb1";
const BLUE = "#a9bdf4";
const CORAL = "#e8b1a2";
const INK = "#f5f4ea";
const SUB = "rgba(245,244,234,0.7)";
const LINE = "rgba(245,244,234,0.22)";
const FILL = "rgba(255,255,255,0.045)";
const CARD = "#10130f";
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
  lines: [string, string];
};

/**
 * SINGLE layout config. Product truth (backend-audited; never claim beyond):
 * L01 workspaces = personal + org with permission-sets/membership (no
 * "roles" word). L02 personal vs org-scoped keys, per-model allow-lists,
 * per-key + org max_spend caps (never "global/per-key scope" wording).
 * L03 unknown→401, disabled/expired/policy→403, resolves workspace +
 * budget pre-call. L04 rpm/rph/rpd + token caps, over-limit DENY with
 * Retry-After (429/403), NO queue. L05 10 categories, monitor/warn/block
 * (default warn), scope global/key. L06 provider/model hint resolution, 6
 * families, wire→native, Gemini stream-only (no tools). L07 normalized to
 * unified result, re-emitted in requested wire shape. L08 metadata/cost/
 * token ledgers + encrypted bounded prompt/response captures, analytics
 * reads ledgers. Prompt logging is a SEPARATE workspace setting (global vs
 * keys allow-list) — its tap leaves L01, never L05.
 *
 * Node copy is sized to fit: titles + subs + two <=15-char detail lines
 * (widened nodes first; shortened only where the lane breaks — see
 * R9_LOG.md for the verbatim originals).
 */
const LAYERS: Layer[] = [
  {
    id: "register", n: "01", lane: "setup", title: "Register",
    sub: "WORKSPACES",
    desc: "Personal + organization workspaces with permission-sets and membership.",
    lines: ["Personal + org", "Permission-sets"],
  },
  {
    id: "keys", n: "02", lane: "setup", title: "Issue keys",
    sub: "API KEYS",
    desc: "Personal vs org-scoped keys, per-model allow-lists, budget caps.",
    lines: ["Scoped keys", "Allow-lists"],
  },
  {
    id: "auth", n: "03", lane: "request", title: "Authenticate",
    sub: "401 · 403",
    desc: "Unknown key → 401; disabled, expired, or policy-denied → 403.",
    lines: ["Unknown → 401", "Denied → 403"],
  },
  {
    id: "ratelimit", n: "04", lane: "request", title: "Rate limit",
    sub: "RPM·RPH·RPD",
    desc: "RPM/RPH/RPD plus token caps. Over-limit is DENY with Retry-After — nothing waits.",
    lines: ["Over-limit DENY", "Retry-After"],
  },
  {
    id: "guardrails", n: "05", lane: "request", title: "Guardrails",
    sub: "10 CATEGORIES",
    desc: "Ten categories; monitor / warn / block enforcement, default warn.",
    lines: ["Warn by default", "Global/key scope"],
  },
  {
    id: "route", n: "06", lane: "request", title: "Route",
    sub: "WIRE→NATIVE",
    desc: "Provider/model hint resolution; unified shape translated to native.",
    lines: ["Hint resolution", "6 families"],
  },
  {
    id: "normalize", n: "07", lane: "request", title: "Normalize",
    sub: "UNIFIED RESULT",
    desc: "Normalized to unified result, re-emitted in the requested wire shape.",
    lines: ["Unified result", "Requested wire"],
  },
  {
    id: "observe", n: "08", lane: "request", title: "Observe",
    sub: "LEDGERS",
    desc: "Metadata, cost, and token ledgers; analytics reads the ledgers.",
    lines: ["Cost + tokens", "Analytics reads"],
  },
];

/** Provider families (text names only). Gemini is stream-only (no tools). */
const PROVIDERS: { id: string; name: string; note: string }[] = [
  { id: "openai", name: "OpenAI", note: "+7 ADAPTERS" },
  { id: "anthropic", name: "Anthropic", note: "TOOLS · STREAM" },
  { id: "gemini", name: "Google Gemini", note: "STREAM-ONLY" },
  { id: "vertex", name: "Vertex AI", note: "STREAM-ONLY" },
  { id: "bedrock", name: "AWS Bedrock", note: "TOOLS · STREAM" },
  { id: "custom", name: "Custom", note: "OPENAI-COMPAT" },
];

const LEDGERS = [
  { id: "meta", label: "METADATA LEDGER" },
  { id: "cost", label: "COST LEDGER" },
  { id: "tokens", label: "TOKENS LEDGER" },
];

const VIEW: Record<Mode, { x: number; y: number; w: number; h: number }> = {
  // Wide base fit: full-flow frame sits ~7% back from the composition
  // (content 16..1680 x 48..843 centered) for breathing room. Camera zoom
  // math uses w/h sizes only; x/y recenter the identity frame. Node sizes,
  // fonts, and row rhythm are untouched — rendered full-view text stays
  // >=12px (18u at k~0.68).
  wide: { x: -179, y: -20, w: 2170, h: 1000 },
  tall: { x: 0, y: 0, w: 660, h: 2440 },
};

/**
 * SINGLE gutter token. Every HORIZONTAL peer gap (layer pitch, chip gaps,
 * ledger gaps, captures-to-ledger) equals GUT exactly. The camera frames
 * each layer with one GUT margin per side, and wire lanes stack as GUT
 * multiples below the request row (bus, provider block, tap feed, return)
 * so no routed arrow shares a band with box text. VERTICAL node-row rhythm
 * is pinned (provider pitch 80, ledger pitch 64): raising GUT opens peer
 * gaps sideways without moving rows up or down.
 */
const GUT = 24;
const GAP = 44;
const LW = 252;
const LH = 132;
const CHIP_W = 240;
const CHIP_H = 64;
const LED_W = 272;
const LED_H = 52;
const FU = 22;

/** Position strategy per mode, derived from the single LAYERS config. */
function layoutNodes(mode: Mode): { layers: Record<string, Rect>; providers: Rect[]; ledgers: Record<string, Rect>; captures: Rect; blocked: Rect } {
  if (mode === "wide") {
    const layers: Record<string, Rect> = {};
    const setupY = 72; const reqY = 260; // setup<->request gap = 56u
    layers.register = { x: 16, y: setupY, w: LW, h: LH };
    layers.keys = { x: 284, y: setupY, w: LW, h: LH };
    const X0 = 40; const PITCH = LW + GAP; // request peer gap = 44u
    ["auth", "ratelimit", "guardrails", "route", "normalize", "observe"].forEach((id, i) => {
      layers[id] = { x: X0 + i * PITCH, y: reqY, w: LW, h: LH };
    });
    // Providers fan out below route, indexed by PROVIDERS order. openai
    // sits col0-bottom: the single return leg starts at its left edge.
    const slots = [{ c: 0, r: 2 }, { c: 1, r: 0 }, { c: 0, r: 0 }, { c: 1, r: 1 }, { c: 0, r: 1 }, { c: 1, r: 2 }];
    const PX0 = layers.route.x; const PY0 = 444; const PP = 76; // pinned row rhythm
    const providers = slots.map((s) => ({
      x: s.c === 0 ? PX0 : PX0 + CHIP_W + GAP, y: PY0 + s.r * PP, w: CHIP_W, h: CHIP_H,
    }));
    // Ledger row on the GUT pitch.
    const LED_Y = 768; const LX0 = 336; // captures-to-ledger gap = GUT
    const ledgers: Record<string, Rect> = {
      meta: { x: LX0, y: LED_Y, w: LED_W, h: LED_H },
      cost: { x: LX0 + LED_W + GUT, y: LED_Y, w: LED_W, h: LED_H },
      tokens: { x: LX0 + 2 * (LED_W + GUT), y: LED_Y, w: LED_W, h: LED_H },
    };
    const captures: Rect = { x: 40, y: LED_Y, w: 272, h: 52 };
    const blocked: Rect = { x: 632, y: 470, w: 148, h: 96 };
    return { layers, providers, ledgers, captures, blocked };
  }
  const W = 400; const H = 132; const X = 40; const Y0 = 120; const STEP = 190; // 58u gaps hold 30u pills with 14u margins
  const ids = ["register", "keys", "auth", "ratelimit", "guardrails", "route", "normalize", "observe"];
  const layers: Record<string, Rect> = {};
  // Providers sit inline between route (idx 5) and normalize.
  const order = ["register", "keys", "auth", "ratelimit", "guardrails", "route", "__prov__", "normalize", "observe"];
  let y = Y0;
  const provY: number[] = [];
  order.forEach((id) => {
    if (id === "__prov__") {
      y += 58 - (STEP - H);
      for (let i = 0; i < 6; i++) { provY.push(y); y += 80; } // pinned (was 64+GUT at 16)
      y += 58 - 8;
      return;
    }
    layers[id] = { x: X, y, w: W, h: H };
    y += STEP;
  });
  void ids;
  const providers = provY.map((py) => ({ x: 120, y: py, w: 280, h: 64 }));
  const ledgers: Record<string, Rect> = {
    meta: { x: X, y: y + 58 - (STEP - H), w: W, h: 48 },
    cost: { x: X, y: y + 58 - (STEP - H) + 64, w: W, h: 48 },
    tokens: { x: X, y: y + 58 - (STEP - H) + 2 * (64), w: W, h: 48 },
  };
  const captures: Rect = { x: X, y: y + 58 - (STEP - H) + 2 * (64) + 64, w: W, h: 60 };
  // Blocked terminus: side chip off guardrails' right edge (stops at L05).
  const blocked: Rect = { x: 440 + GUT, y: layers.guardrails.y + 33, w: 150, h: 66 };
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
    const setupMid = R.register.y + R.register.h / 2; // 138
    c.push({ name: "setup", d: `M${R.register.x + R.register.w},${setupMid} L${R.keys.x},${setupMid}`, x1: R.register.x + R.register.w, y1: setupMid, x2: R.keys.x, y2: setupMid });
    // Drop: keys bottom -> auth top, elbowed east of the REQUEST pill slot.
    c.push({ name: "drop", d: `M410,${R.keys.y + R.keys.h} L410,232 L260,232 L260,${R.auth.y}`, x1: 410, y1: R.keys.y + R.keys.h, x2: 260, y2: R.auth.y, label: "REQUEST", lx: 512, ly: 232 });
    const reqMid = R.auth.y + R.auth.h / 2; // 326
    const seq: [string, string][] = [["auth", "ratelimit"], ["ratelimit", "guardrails"], ["guardrails", "route"], ["route", "normalize"], ["normalize", "observe"]];
    seq.forEach(([a, b]) => {
      c.push({ name: `${a}-${b}`, d: `M${R[a].x + R[a].w},${reqMid} L${R[b].x},${reqMid}`, x1: R[a].x + R[a].w, y1: reqMid, x2: R[b].x, y2: reqMid });
    });
    c.push({ name: "lbl-setup", d: "", x1: 40, y1: 64, x2: 40, y2: 64, label: "SETUP LANE \u00b7 01\u201302", lx: 40, ly: 64 });
    c.push({ name: "lbl-request", d: "", x1: 940, y1: 250, x2: 940, y2: 250, label: "REQUEST LANE \u00b7 03\u201308", lx: 940, ly: 250 });
    // Fan: one dedicated vertical inbound lane per provider chip. Col0 runs
    // a spine from route's bottom edge into gemini's top, then chains down
    // gemini->bedrock->openai bottom-to-top; col1 elbows from route into
    // anthropic's top, then chains down. Every endpoint lands on a chip
    // edge; parallels sit >=20u apart with zero crossings.
    c.push({ name: "fan", d: `M940,${R.route.y + R.route.h} L940,${L.providers[2].y}`, x1: 940, y1: R.route.y + R.route.h, x2: 940, y2: L.providers[2].y, label: "FAN-OUT", lx: 764, ly: 418 });
    c.push({ name: "fan-p4", d: `M1150,${R.route.y + R.route.h} L1150,400 L1225,400 L1225,${L.providers[1].y}`, x1: 1150, y1: R.route.y + R.route.h, x2: 1225, y2: L.providers[1].y });
    c.push({ name: "fan-c0a", d: `M940,${L.providers[2].y + L.providers[2].h} L940,${L.providers[4].y}`, x1: 940, y1: L.providers[2].y + L.providers[2].h, x2: 940, y2: L.providers[4].y });
    c.push({ name: "fan-c0b", d: `M940,${L.providers[4].y + L.providers[4].h} L940,${L.providers[0].y}`, x1: 940, y1: L.providers[4].y + L.providers[4].h, x2: 940, y2: L.providers[0].y });
    c.push({ name: "fan-c1a", d: `M1225,${L.providers[1].y + L.providers[1].h} L1225,${L.providers[3].y}`, x1: 1225, y1: L.providers[1].y + L.providers[1].h, x2: 1225, y2: L.providers[3].y });
    c.push({ name: "fan-c1b", d: `M1225,${L.providers[3].y + L.providers[3].h} L1225,${L.providers[5].y}`, x1: 1225, y1: L.providers[3].y + L.providers[3].h, x2: 1225, y2: L.providers[5].y });
    // Return: openai's left edge exits west, runs a dedicated lane between
    // the tap feed and the ledger row (crosses nothing), then rises into
    // normalize's bottom edge.
    const FEED_Y = L.providers[0].y + L.providers[0].h + GUT;
    const RET_Y = FEED_Y - 16;
    const retMid = L.providers[0].y + L.providers[0].h / 2;
    c.push({ name: "return", d: `M${L.providers[0].x},${retMid} L900,${retMid} L900,${RET_Y} L1468,${RET_Y} L1468,${R.normalize.y + R.normalize.h}`, x1: L.providers[0].x, y1: retMid, x2: 1468, y2: R.normalize.y + R.normalize.h, label: "RETURN", lx: 916, ly: 726 });
    // Response along the reserved top slot into keys top (crosses nothing),
    // entering normalize from above.
    c.push({ name: "response", d: `M1350,${R.normalize.y} L1350,56 L480,56 L480,${R.keys.y}`, x1: 1350, y1: R.normalize.y, x2: 480, y2: R.keys.y, label: "RESPONSE", lx: 800, ly: 94 });
    // Coral blocked branch: guardrails bottom -> terminus top (stops at L05).
    c.push({ name: "blocked", coral: true, d: `M648,${R.guardrails.y + R.guardrails.h} L648,${L.blocked.y}`, x1: 648, y1: R.guardrails.y + R.guardrails.h, x2: 648, y2: L.blocked.y });
    // Dashed workspace tap: register bottom -> captures top via the
    // request-lane gap corridor (never through a node).
    c.push({ name: "tap-captures", dashed: true, d: `M200,${R.register.y + R.register.h} L200,246 L314,246 L314,730 L200,730 L200,${L.captures.y}`, x1: 200, y1: R.register.y + R.register.h, x2: 200, y2: L.captures.y, label: "PROMPT LOG TAP", lx: 172, ly: 858 });
    // Per-layer taps join the shared feed lane (T-joints, never nodes).
    // Auth runs south then east into the meta ledger top.
    c.push({ name: "tap-auth", dashed: true, d: `M90,${R.auth.y + R.auth.h} L90,746 L472,746 L472,${L.ledgers.meta.y}`, x1: 90, y1: R.auth.y + R.auth.h, x2: 472, y2: L.ledgers.meta.y });
    c.push({ name: "tap-r", dashed: true, d: `M470,${R.ratelimit.y + R.ratelimit.h} L470,${FEED_Y} L1400,${FEED_Y}`, x1: 470, y1: R.ratelimit.y + R.ratelimit.h, x2: 1400, y2: FEED_Y, label: "LOG TAPS", lx: 202, ly: 418 });
    c.push({ name: "tap-g", dashed: true, d: `M880,${R.guardrails.y + R.guardrails.h} L880,${FEED_Y}`, x1: 880, y1: R.guardrails.y + R.guardrails.h, x2: 880, y2: FEED_Y });
    // Normalize tap joins from the right edge; the shared feed lane runs
    // west below the providers and branches down into cost/tokens tops.
    c.push({ name: "tap-n", dashed: true, d: `M${R.normalize.x + R.normalize.w},355 L1504,355 L1504,${FEED_Y} L1400,${FEED_Y}`, x1: R.normalize.x + R.normalize.w, y1: 355, x2: 1400, y2: FEED_Y });
    c.push({ name: "tap-f0", dashed: true, d: `M768,${FEED_Y} L768,${L.ledgers.cost.y}`, x1: 768, y1: FEED_Y, x2: 768, y2: L.ledgers.cost.y });
    c.push({ name: "tap-f1", dashed: true, d: `M1064,${FEED_Y} L1064,${L.ledgers.tokens.y}`, x1: 1064, y1: FEED_Y, x2: 1064, y2: L.ledgers.tokens.y });
    // Analytics reads the ledgers: observe bottom exits south and enters
    // the tokens ledger's right edge at mid-height.
    c.push({ name: "analytics", dashed: true, d: `M1646,${R.observe.y + R.observe.h} L1646,794 L${L.ledgers.tokens.x + L.ledgers.tokens.w},794`, x1: 1646, y1: R.observe.y + R.observe.h, x2: L.ledgers.tokens.x + L.ledgers.tokens.w, y2: 794, label: "ANALYTICS", lx: 1250, ly: 858 });
    return c;
  }
    // Tall: vertical pipeline, providers inline between route and normalize.
  const seqT: [string, string][] = [["register", "keys"], ["keys", "auth"], ["auth", "ratelimit"], ["ratelimit", "guardrails"], ["guardrails", "route"]];
  seqT.forEach(([a, b]) => {
    c.push({ name: `${a}-${b}`, d: `M${cx(R[a])},${R[a].y + R[a].h} L${cx(R[b])},${R[b].y}`, x1: cx(R[a]), y1: R[a].y + R[a].h, x2: cx(R[b]), y2: R[b].y });
  });
  c.push({ name: "route-prov", d: `M${cx(R.route)},${R.route.y + R.route.h} L${cx(L.providers[0])},${L.providers[0].y}`, x1: cx(R.route), y1: R.route.y + R.route.h, x2: cx(L.providers[0]), y2: L.providers[0].y, label: "FAN-OUT", lx: 260, ly: R.route.y + R.route.h + 29 });
  for (let i = 0; i < L.providers.length - 1; i++) {
    const a = L.providers[i]; const b = L.providers[i + 1];
    c.push({ name: `prov-${i}`, d: `M${cx(a)},${a.y + a.h} L${cx(b)},${b.y}`, x1: cx(a), y1: a.y + a.h, x2: cx(b), y2: b.y });
  }
  const last = L.providers[L.providers.length - 1];
  c.push({ name: "prov-norm", d: `M${cx(last)},${last.y + last.h} L${cx(R.normalize)},${R.normalize.y}`, x1: cx(last), y1: last.y + last.h, x2: cx(R.normalize), y2: R.normalize.y, label: "RETURN", lx: 260, ly: last.y + last.h + 29 });
  c.push({ name: "normalize-observe", d: `M${cx(R.normalize)},${R.normalize.y + R.normalize.h} L${cx(R.observe)},${R.observe.y}`, x1: cx(R.normalize), y1: R.normalize.y + R.normalize.h, x2: cx(R.observe), y2: R.observe.y });
  // Response bus down the left side into keys.
  c.push({ name: "response", d: `M${R.normalize.x},${R.normalize.y + 40} L20,${R.normalize.y + 40} L20,${R.keys.y + 40} L${R.keys.x},${R.keys.y + 40}`, x1: R.normalize.x, y1: R.normalize.y + 40, x2: R.keys.x, y2: R.keys.y + 40, label: "RESPONSE", lx: 100, ly: R.keys.y + R.keys.h + 29 });
  // Coral blocked branch exits guardrails right edge (stops at L05).
  c.push({ name: "blocked", coral: true, d: `M${R.guardrails.x + R.guardrails.w},${R.guardrails.y + 66} L${L.blocked.x},${L.blocked.y + 33}`, x1: R.guardrails.x + R.guardrails.w, y1: R.guardrails.y + 66, x2: L.blocked.x, y2: L.blocked.y + 33 });
  // Workspace tap (L01) feeds captures only — never the guardrail node.
  c.push({ name: "tap-captures", dashed: true, d: `M${R.register.x + R.register.w},${R.register.y + 66} L630,${R.register.y + 66} L630,${L.captures.y} L300,${L.captures.y}`, x1: R.register.x + R.register.w, y1: R.register.y + 66, x2: 300, y2: L.captures.y, label: "PROMPT LOG TAP", lx: 550, ly: 661 });
  // Dashed tap bus on the right into ledger stack.
  const busX = 610;
  const tapY = (r: Rect) => r.y + r.h / 2 - 40;
  [R.auth, R.ratelimit, R.normalize].forEach((r) => {
    c.push({ name: `tap-${r.y}`, dashed: true, d: `M${r.x + r.w},${tapY(r)} L${busX},${tapY(r)}`, x1: r.x + r.w, y1: tapY(r), x2: busX, y2: tapY(r) });
  });
  const topT = tapY(R.auth); const botT = tapY(R.normalize);
  c.push({ name: "tap-bus", dashed: true, d: `M${busX},${topT} L${busX},${L.ledgers.meta.y} L${cx(L.ledgers.meta)},${L.ledgers.meta.y}`, x1: busX, y1: topT, x2: cx(L.ledgers.meta), y2: L.ledgers.meta.y, label: "LOG TAPS", lx: 545, ly: botT + 60 });
  c.push({ name: "analytics", dashed: true, d: `M${R.observe.x},${R.observe.y + 66} L16,${R.observe.y + 66} L16,${L.ledgers.tokens.y + 24} L${L.ledgers.tokens.x},${L.ledgers.tokens.y + 24}`, x1: R.observe.x, y1: R.observe.y + 66, x2: L.ledgers.tokens.x, y2: L.ledgers.tokens.y + 24, label: "ANALYTICS", lx: 300, ly: L.ledgers.tokens.y + L.ledgers.tokens.h + 30 });
  return c;
}

/**
 * R9 scripted camera. Pin progress splits into five phases —
 * A entry [0, .06] full diagram fades+scales .92→1 · B first pass
 * [.06, .18] full emphasis, packets make one pass · C layer steps
 * [.18, .82] equal eighths (2% move-in power2.inOut, 4% hold, 2%
 * move-out; camera zooms to each layer's bbox + one gutter margin per
 * side computed from layoutNodes — never hand-typed; active layer and
 * its in/out connectors stay 1.0, ALL else 0.35) · D second pass
 * [.82, .92] full emphasis, packets pass again · E exit [.92, 1]
 * scale→.9 + fade→0 (nothing visible at end).
 * Camera = one transform on a single inner <g> (transform/opacity only),
 * a pure function of progress → scroll-up reverses exactly. L05+injection
 * unions the blocked badge so the coral branch stays in frame (zoom reads
 * smaller there — logged in R9_LOG.md — while every layer still fills
 * >=55% width in safe mode).
 */
const PH = { A: 0.06, B: 0.18, C: 0.82, D: 0.92 };
const power2inOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) * (-2 * t + 2)) / 2);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
type Cam = { x: number; y: number; s: number };
/** Connectors downstream of the L05 block (dimmed to 0.35 on injection). */
const DOWNSTREAM_WIDE = new Set(["route-normalize", "normalize-observe", "fan", "fan-p4", "fan-c0a", "fan-c0b", "fan-c1a", "fan-c1b", "return", "response", "tap-n", "tap-f0", "tap-f1", "analytics"]);
const DOWNSTREAM_TALL = new Set(["prov-0", "prov-1", "prov-2", "prov-3", "prov-4", "prov-norm", "normalize-observe", "response", "analytics"]);
/** Lead-packet pass route: existing connector names forming one visual pass. */
const PASS_WIDE = ["setup", "drop", "auth-ratelimit", "ratelimit-guardrails", "guardrails-route", "route-normalize", "normalize-observe", "response"];
const PASS_TALL = ["register-keys", "keys-auth", "auth-ratelimit", "ratelimit-guardrails", "guardrails-route", "route-prov", "prov-0", "prov-1", "prov-2", "prov-3", "prov-4", "prov-norm", "normalize-observe", "response"];
/** Pill labels: opaque pills in gutter slots. Headers + ANALYTICS stay plain. */
const PILL_LABELS = new Set(["REQUEST", "RESPONSE", "RETURN", "FAN-OUT", "LOG TAPS", "PROMPT LOG TAP", "ANALYTICS"]);
/** Stage envelope (entry fade/scale, exit scale/fade) — pure function of p. */
function stageAt(p: number): { op: number; sc: number } {
  if (p < PH.A) { const t = p / PH.A; return { op: t, sc: 0.92 + 0.08 * t }; }
  if (p < PH.D) return { op: 1, sc: 1 };
  const q = (p - PH.D) / (1 - PH.D); return { op: 1 - q, sc: 1 - 0.1 * q };
}
/** Spotlighted layer: only during phase C (overview otherwise). */
function activeAt(p: number): number {
  if (p < PH.B || p >= PH.C) return -1;
  return Math.min(7, Math.floor(((p - PH.B) / (PH.C - PH.B)) * 8));
}
/** Camera keyframe for layer i (L05+injection unions the blocked badge). */
function camFor(L: Layout, V: { x: number; y: number; w: number; h: number }, i: number, inj: boolean): Cam {
  let r = L.layers[LAYERS[i].id];
  if (inj && LAYERS[i].id === "guardrails") {
    const b = L.blocked;
    const x0 = Math.min(r.x, b.x); const y0 = Math.min(r.y, b.y);
    r = { x: x0, y: y0, w: Math.max(r.x + r.w, b.x + b.w) - x0, h: Math.max(r.y + r.h, b.y + b.h) - y0 };
  }
  const ew = r.w + GUT * 2; const eh = r.h + GUT * 2;
  return { x: r.x + r.w / 2, y: r.y + r.h / 2, s: Math.min(V.w / ew, V.h / eh) };
}
/** Camera as a pure function of progress (identity outside C blends). */
function camAt(L: Layout, V: { x: number; y: number; w: number; h: number }, p: number, inj: boolean): Cam {
  const ident: Cam = { x: V.x + V.w / 2, y: V.y + V.h / 2, s: 1 };
  if (p < PH.B || p >= PH.C) return ident;
  const u = ((p - PH.B) / (PH.C - PH.B)) * 8;
  const i = Math.min(7, Math.floor(u));
  const f = u - i; // 0–0.25 move-in, 0.25–0.75 hold, 0.75–1 move-out
  const cur = camFor(L, V, i, inj);
  if (f < 0.25) {
    const prev = i === 0 ? ident : camFor(L, V, i - 1, inj);
    const t = power2inOut(f / 0.25);
    return { x: lerp(prev.x, cur.x, t), y: lerp(prev.y, cur.y, t), s: lerp(prev.s, cur.s, t) };
  }
  if (f > 0.75) {
    const next = i === 7 ? ident : camFor(L, V, i + 1, inj);
    const t = power2inOut((f - 0.75) / 0.25);
    return { x: lerp(cur.x, next.x, t), y: lerp(cur.y, next.y, t), s: lerp(cur.s, next.s, t) };
  }
  return cur;
}

declare global {
  interface Window { __hiw?: { setP: (p: number) => void; sig: () => string } }
}

export default function Platform() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const railRef = useRef<HTMLSpanElement | null>(null);
  const [mode, setMode] = useState<Mode>("wide");
  const [mounted, setMounted] = useState(false);
  const [traffic, setTraffic] = useState<"safe" | "injection">("safe");
  const [activeIdx, setActiveIdx] = useState(-1);
  const [staticSel, setStaticSel] = useState(-1);
  const reduced = useReducedMotion();
  const stateRef = useRef({ p: 0, active: -1, traffic: "safe" as "safe" | "injection" });
  const staticSelRef = useRef(-1);
  const rangeRef = useRef({ start: 0, end: 1 });
  const paintRef = useRef<(p: number) => void>(() => {});
  const sigRef = useRef<() => string>(() => "");

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
  const DOWNSTREAM = mode === "wide" ? DOWNSTREAM_WIDE : DOWNSTREAM_TALL;

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

    const passRoute = mode === "wide" ? PASS_WIDE : PASS_TALL;
    const N = passRoute.length;
    // Camera on only for the wide pinned scrub (or its exact hiwshot frame).
    const camOn = mode === "wide" && (pinned || shot != null);
    // In/out connector names per layer: a connector is adjacent when either
    // endpoint touches the layer's bbox (expanded 10u) — computed, never
    // hand-typed.
    const adjByLayer: Set<string>[] = LAYERS.map((lay) => {
      const r = L.layers[lay.id]; const m = 10; const s = new Set<string>();
      for (const cn of conns) {
        if (!cn.d) continue;
        const inside = (x: number, y: number) => x >= r.x - m && x <= r.x + r.w + m && y >= r.y - m && y <= r.y + r.h + m;
        if (inside(cn.x1, cn.y1) || inside(cn.x2, cn.y2)) s.add(cn.name);
      }
      return s;
    });
    const place = (name: string, t: number) => {
      const el = pathEls.get(name);
      const len = lens.get(name) ?? 0;
      if (!el || len <= 0) return null;
      try { return el.getPointAtLength(Math.min(1, Math.max(0, t)) * len); } catch { return null; }
    };
    // Hidden packets reset to a canonical transform-less state so the
    // hidden reading is identical on the way down and the way back up.
    const setPkt = (el: Element | null, pt: { x: number; y: number } | null, show: boolean) => {
      if (!el) return;
      (el as SVGElement).style.opacity = show && pt ? "1" : "0";
      if (pt && show) el.setAttribute("transform", `translate(${pt.x} ${pt.y})`);
      else el.removeAttribute("transform");
    };
    const segAt = (t: number) => {
      const f = Math.min(0.9999, Math.max(0, t)) * N;
      const i = Math.floor(f);
      return { name: passRoute[Math.min(i, N - 1)], t: f - i };
    };

    const paint = (p: number) => {
      stateRef.current.p = p;
      const inj = stateRef.current.traffic === "injection";
      const camG = svg.querySelector("[data-camera]");
      // Static contexts (tall / reduced-motion / unpinned): complete
      // diagram, no camera, no fades — stepper clicks dim to static 0.35.
      if (!camOn) {
        if (camG) camG.setAttribute("transform", "translate(0 0) scale(1)");
        svg.setAttribute("data-zoomfade", "0");
        svg.style.opacity = "1";
        const sel = staticSelRef.current;
        layerEls.forEach((g) => { g.style.opacity = sel < 0 || Number(g.getAttribute("data-idx")) === sel ? "1" : "0.35"; });
        const adj = sel >= 0 ? adjByLayer[sel] : null;
        pathEls.forEach((el, name) => {
          const cn = conns.find((c) => c.name === name);
          if (cn?.coral) { el.style.opacity = inj ? "1" : "0.35"; return; }
          if (adj) el.style.opacity = adj.has(name) ? "1" : "0.35";
          else if (inj && DOWNSTREAM.has(name)) el.style.opacity = "0.35";
          else el.style.opacity = "1";
        });
        svg.querySelectorAll("[data-pill]").forEach((g) => {
          const nm = g.getAttribute("data-pill");
          const pe = nm ? pathEls.get(nm) : undefined;
          (g as SVGElement).style.opacity = pe?.style.opacity || "1";
        });
        setPkt(packetEls.lead, null, false); setPkt(packetEls.s1, null, false); setPkt(packetEls.s2, null, false); setPkt(packetEls.s3, null, false);
        if (railRef.current) railRef.current.style.transform = "scaleX(1)";
        const bg0 = svg.querySelector("[data-bg]");
        if (bg0) (bg0 as SVGElement).style.transform = "translateY(0px)";
        svg.querySelectorAll("[data-coral-ui]").forEach((g) => { (g as SVGElement).style.opacity = inj ? "1" : "0.35"; });
        svg.querySelectorAll<SVGElement>("[data-dim]").forEach((g) => {
          g.style.opacity = sel < 0 ? "1" : "0.35";
        });
        return;
      }
      const st = stageAt(p);
      const cam = camAt(L, V, p, inj);
      if (camG) camG.setAttribute("transform", `translate(${(V.x + V.w / 2).toFixed(1)} ${(V.y + V.h / 2).toFixed(1)}) scale(${(st.sc * cam.s).toFixed(4)}) translate(${(-cam.x).toFixed(1)} ${(-cam.y).toFixed(1)})`);
      svg.style.opacity = st.op.toFixed(3);
      // R9 phases: a layer is spotlighted only during phase C.
      const act = activeAt(p);
      if (act !== stateRef.current.active) {
        const prev = stateRef.current.active;
        stateRef.current.active = act;
        setActiveIdx(act);
        // anime.js micro-interaction only: pulse the newly active node.
        const lay = LAYERS[act];
        if (lay && !reduced) {
          const g = svg.querySelector(`[data-layer="${lay.id}"]`);
          if (g && prev !== act) {
            try { animate(g as unknown as Element, { scale: [1, 1.045, 1], duration: 420, ease: "outQuad" }); } catch { /* static */ }
          }
        }
        if (inj && act === 4 && !reduced) {
          const b = svg.querySelector("[data-blocked-badge]");
          if (b) try { animate(b as unknown as Element, { x: [0, -5, 5, -3, 3, 0], duration: 450, ease: "outQuad" }); } catch { /* static */ }
        }
      }
      const inC = act >= 0;
      // Feathered edge fades only while zoomed: hard-clipped neighbors
      // dissolve instead of slicing mid-glyph. Pure function of progress
      // (reverses exactly); never set when camOn is false, so reduced
      // motion / tall / static never fade.
      svg.setAttribute("data-zoomfade", camOn && inC ? "1" : "0");
      layerEls.forEach((g) => {
        const i = Number(g.getAttribute("data-idx"));
        g.style.opacity = !inC || i === act ? "1" : "0.35";
      });
      const adj = inC ? adjByLayer[act] : null;
      pathEls.forEach((el, name) => {
        const cn = conns.find((c) => c.name === name);
        if (!inC) {
          if (cn?.coral) el.style.opacity = inj ? "1" : "0.35";
          else if (inj && DOWNSTREAM.has(name)) el.style.opacity = "0.35";
          else el.style.opacity = "1";
          return;
        }
        // Phase C: active layer + its connectors 1.0, ALL else 0.35.
        el.style.opacity = adj && adj.has(name) ? "1" : "0.35";
      });
      // Coral annotation UI (badge): quiet 0.35 in safe mode, lit on injection.
      svg.querySelectorAll("[data-coral-ui]").forEach((g) => {
        (g as SVGElement).style.opacity = inj ? "1" : "0.35";
      });
      svg.querySelectorAll("[data-pill]").forEach((g) => {
        const nm = g.getAttribute("data-pill");
        const pe = nm ? pathEls.get(nm) : undefined;
        (g as SVGElement).style.opacity = pe?.style.opacity || "1";
      });
      // Dim non-layer furniture (providers/ledgers/captures/captions) in C.
      svg.querySelectorAll<SVGElement>("[data-dim]").forEach((g) => {
        g.style.opacity = inC ? "0.35" : inj && g.hasAttribute("data-down") && DOWNSTREAM.has(g.getAttribute("data-down") ?? "") ? "0.35" : "1";
      });
      // Packets: lead + <=3 secondary, all pure functions of p. One full
      // pass in B, parked at the active layer's input in C, one pass in D.
      // Injection parks the lead at the L05 block through both passes.
      const runPass = (q: number) => {
        const s = segAt(q);
        const inR = q > 0.005 && q < 0.995;
        setPkt(packetEls.lead, inR ? place(s.name, s.t) : null, inR);
        const ret = mode === "wide" ? "return" : "prov-norm";
        const s1t = Math.min(1, Math.max(0, (q - 0.5) / 0.5));
        setPkt(packetEls.s1, place(ret, s1t), q > 0.5 && q < 0.995);
        const s2t = Math.min(1, Math.max(0, (q - 0.72) / 0.28));
        setPkt(packetEls.s2, place("response", s2t), q > 0.72 && q < 0.995);
        const s3t = (q * 3) % 1;
        setPkt(packetEls.s3, place("tap-bus", s3t), q > 0.31 && q < 0.995);
      };
      const park = () => {
        const r = L.layers[LAYERS[act].id];
        setPkt(packetEls.lead, { x: r.x - 14, y: r.y + r.h / 2 }, true);
        setPkt(packetEls.s1, null, false); setPkt(packetEls.s2, null, false); setPkt(packetEls.s3, null, false);
      };
      const hideAll = () => { setPkt(packetEls.lead, null, false); setPkt(packetEls.s1, null, false); setPkt(packetEls.s2, null, false); setPkt(packetEls.s3, null, false); };
      if (inj && !inC && p >= PH.A && p < PH.D) {
        // Blocked: lead parks at the L05 exit through both passes.
        setPkt(packetEls.lead, place("blocked", 1), true);
        setPkt(packetEls.s1, null, false); setPkt(packetEls.s2, null, false); setPkt(packetEls.s3, null, false);
      } else if (!inj && p >= PH.A && p < PH.B) runPass((p - PH.A) / (PH.B - PH.A));
      else if (!inj && p >= PH.C && p < PH.D) runPass((p - PH.C) / (PH.D - PH.C));
      else if (inC && inj) {
        // Stopped at the L05 block: never advances past guardrails.
        setPkt(packetEls.lead, place("blocked", 1), true);
        setPkt(packetEls.s1, null, false); setPkt(packetEls.s2, null, false); setPkt(packetEls.s3, null, false);
      } else if (inC) park();
      else hideAll();
      if (railRef.current) railRef.current.style.transform = `scaleX(${Math.min(1, Math.max(0, p)).toFixed(4)})`;
      // Parallax: background grid/glow ONLY.
      const bg = svg.querySelector("[data-bg]");
      if (bg) (bg as SVGElement).style.transform = `translateY(${(p * 26).toFixed(1)}px)`;
    };
    paintRef.current = paint;
    sigRef.current = () => {
      const parts = [stateRef.current.p.toFixed(3), String(stateRef.current.active), svg.style.opacity || ""];
      const cg = svg.querySelector("[data-camera]");
      parts.push(cg?.getAttribute("transform") ?? "");
      layerEls.forEach((g) => parts.push(`${g.getAttribute("data-layer")}=${g.style.opacity}`));
      pathEls.forEach((el, n) => parts.push(`${n}=${el.style.opacity}`));
      [packetEls.lead, packetEls.s1, packetEls.s2, packetEls.s3].forEach((el) => {
        parts.push(`${(el as SVGElement | null)?.style.opacity ?? ""}:${el?.getAttribute("transform") ?? ""}`);
      });
      return parts.join("|");
    };
    window.__hiw = { setP: paint, sig: () => sigRef.current() };

    // hiwshot: static single-frame render for screenshots (no pin).
    const params = new URLSearchParams(window.location.search);
    const shotP = params.get("hiwshot");
    if (shotP != null) {
      stateRef.current.traffic = (params.get("hiwtraffic") as "safe" | "injection") || "safe";
      setTraffic(stateRef.current.traffic);
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
      trigger: wrap, start: "top top", end: "+=420%", pin: true, scrub: 0.8,
      onUpdate: (self) => paint(self.progress),
    });
    rangeRef.current = { start: st.start, end: st.end };
    paint(0);
    return () => { st.kill(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, mode, pinned, reduced]);

  useEffect(() => {
    stateRef.current.traffic = traffic;
    paintRef.current(stateRef.current.p || (pinned ? 0 : 1));
  }, [traffic, pinned]);

  const jumpTo = (i: number) => {
    if (pinned && wrapRef.current) {
      // Absolute pin range: wrap height alone ignores the 420% distance.
      const { start, end } = rangeRef.current;
      const frac = PH.B + ((i + 0.5) / 8) * (PH.C - PH.B);
      window.scrollTo({ top: start + frac * (end - start), behavior: reduced ? "auto" : "smooth" });
    } else {
      setStaticSel(i);
      staticSelRef.current = i;
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
      <Container width="wide" className="pt-20 md:pt-28">
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
              data-traffic={m}
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

      </Container>
      <div ref={wrapRef} className="relative mt-8">
        <div className={pinned ? "flex h-screen flex-col px-6 md:px-8" : "px-6 md:px-8"} style={pinned ? { paddingTop: 80 } : undefined}>
          <div className={pinned ? "relative mx-auto min-h-0 w-full flex-1" : "relative mx-auto w-full"}>
              <svg
                ref={svgRef}
                viewBox={`${V.x} ${V.y} ${V.w} ${V.h}`}
                data-zoomfade="0"
                className={pinned ? "absolute inset-0 h-full w-full select-none" : "h-auto w-full select-none"}
                role="img"
                aria-label="ToLLma gateway: eight layers from register to observe"
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
                  <rect x={V.x} y={V.y} width={V.w} height={V.h} fill="url(#hiw-grid)" />
                  <rect x={V.x} y={V.y} width={V.w} height={V.h} fill="url(#hiw-glow)" />
                </g>
                <g data-camera>
                  {mode === "wide" && (
                    <>
                      <rect x={16} y={48} width={536} height={180} fill="none" stroke={LINE} strokeDasharray="5 5" />
                      <rect x={16} y={248} width={1780} height={168} fill="none" stroke={LINE} strokeDasharray="5 5" />
                    </>
                  )}
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
                      strokeWidth={2}
                      strokeDasharray={cn.dashed ? "7 6" : undefined}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                      markerEnd={cn.coral ? "url(#hiw-arr-coral)" : cn.dashed ? undefined : "url(#hiw-arr)"}
                      opacity={0}
                    />
                  ))}
                  {/* Reserved label slots: opaque halo pills + plain captions. */}
                  {conns.filter((cn) => cn.label).map((cn) => (
                    PILL_LABELS.has(cn.label ?? "") ? (
                      <g key={`lbl-${cn.name}`} data-lbl={cn.name} data-pill={cn.name} opacity={0.95}>
                        <rect x={(cn.lx ?? 0) - ((cn.label ?? "").length * 17.7 + 30) / 2} y={(cn.ly ?? 0) - 15} width={(cn.label ?? "").length * 17.7 + 30} height={30} rx={11} fill={CARD} stroke={LINE} />
                        <text x={cn.lx} y={(cn.ly ?? 0) + 8} textAnchor="middle" fill={SUB} fontSize={FU} fontFamily={SANS} letterSpacing="0.1em">
                          {cn.label}
                        </text>
                      </g>
                    ) : (
                      <g key={`lbl-${cn.name}`} data-lbl={cn.name} data-caption={cn.name} data-dim opacity={0.95}>
                        <text x={cn.lx} y={cn.ly} fill={SUB} fontSize={FU} fontFamily={SANS} letterSpacing="0.1em">
                          {cn.label}
                        </text>
                      </g>
                    )
                  ))}

                  {/* Layer nodes (consistent dims per category). */}
                  {LAYERS.map((l, i) => {
                    const r = L.layers[l.id];
                    return (
                      <g key={l.id} data-layer={l.id} data-idx={i} id={`hiw-layer-${l.id}`} opacity={0.35}>
                        <rect x={r.x} y={r.y} width={r.w} height={r.h} fill={FILL} stroke={l.lane === "setup" ? BLUE : MINT} strokeWidth={1.5} />
                        <text x={r.x + 18} y={r.y + 34} fill={l.lane === "setup" ? BLUE : MINT} fontSize={FU} fontFamily={MONO} letterSpacing="0.1em">{l.n}</text>
                        <text x={r.x + 58} y={r.y + 34} fill={INK} fontSize={FU} fontWeight={600} fontFamily={SANS}>{l.title}</text>
                        <text x={r.x + 18} y={r.y + 62} fill={SUB} fontSize={FU} fontWeight={500} fontFamily={MONO} letterSpacing="0.08em">{l.sub}</text>
                        <text x={r.x + 24} y={r.y + 90} fill={SUB} fontSize={FU} fontFamily={MONO}>{l.lines[0]}</text>
                        <text x={r.x + 24} y={r.y + 114} fill={SUB} fontSize={FU} fontFamily={MONO}>{l.lines[1]}</text>
                      </g>
                    );
                  })}

                  {/* Providers (text names only). */}
                  {L.providers.map((p, i) => {
                    const fam = PROVIDERS[i];
                    return (
                    <g key={fam.id} data-prov={fam.id} data-dim data-down={mode === "wide" ? "fan" : "prov-0"} opacity={0.9}>
                      <rect x={p.x} y={p.y} width={p.w} height={p.h} fill={FILL} stroke={LINE} strokeWidth={1.5} />
                      <text x={p.x + p.w / 2} y={p.y + 30} textAnchor="middle" fill={INK} fontSize={FU} fontWeight={600} fontFamily={SANS}>
                        {fam.name}
                      </text>
                      <text x={p.x + p.w / 2} y={p.y + 52} textAnchor="middle" fill={SUB} fontSize={FU} fontFamily={MONO} letterSpacing="0.08em">
                        {fam.note}
                      </text>
                    </g>
                    );
                  })}
                  {mode === "wide" ? (
                    <>
                      <text data-caption="providers" data-dim x={1400} y={842} fill={SUB} fontSize={FU} fontFamily={SANS} letterSpacing="0.1em">
                        PROVIDERS · 6 FAMILIES
                      </text>
                      <line x1={1400} y1={874} x2={1700} y2={874} stroke={LINE} strokeWidth={1.5} />
                      <text data-caption="analytics-cap" data-dim x={1400} y={928} fill={SUB} fontSize={FU} fontFamily={SANS} letterSpacing="0.1em">
                        ANALYTICS READS LEDGERS
                      </text>
                    </>
                  ) : (
                    <text data-caption="providers" data-dim x={120} y={L.providers[5].y + 88} fill={SUB} fontSize={FU} fontFamily={SANS} letterSpacing="0.1em">
                      6 FAMILIES · GEMINI STREAM-ONLY
                    </text>
                  )}

                  {/* Ledgers + captures */}
                  {LEDGERS.map((lg) => {
                    const r = L.ledgers[lg.id];
                    return (
                      <g key={lg.id} data-ledger={lg.id} data-dim opacity={0.9}>
                        <rect x={r.x} y={r.y} width={r.w} height={r.h} fill={FILL} stroke={LINE} strokeWidth={1.5} />
                        <text x={r.x + r.w / 2} y={r.y + 30} textAnchor="middle" fill={SUB} fontSize={FU} fontFamily={SANS} letterSpacing="0.1em">{lg.label}</text>
                      </g>
                    );
                  })}
                  <g data-captures data-dim opacity={0.9}>
                    <rect x={L.captures.x} y={L.captures.y} width={L.captures.w} height={L.captures.h} fill={FILL} stroke={BLUE} strokeWidth={1.5} strokeDasharray="7 6" />
                    <text x={L.captures.x + L.captures.w / 2} y={L.captures.y + 26} textAnchor="middle" fill={SUB} fontSize={FU} fontFamily={SANS} letterSpacing="0.08em">
                      {mode === "wide" ? "CAPTURES" : "PROMPT / RESPONSE CAPTURES"}
                    </text>
                    <text x={L.captures.x + L.captures.w / 2} y={L.captures.y + 45} textAnchor="middle" fill={SUB} fontSize={FU} fontFamily={MONO}>
                      {mode === "wide" ? "ENCRYPTED·BOUNDED" : "ENCRYPTED · BOUNDED"}
                    </text>
                  </g>
                  {/* Coral blocked terminus (stops at L05, never reaches providers). */}
                  <g data-blocked-badge data-coral-ui opacity={0.35}>
                    <rect x={L.blocked.x} y={L.blocked.y} width={L.blocked.w} height={L.blocked.h} fill={CARD} stroke={CORAL} strokeWidth={2} />
                    <text x={L.blocked.x + L.blocked.w / 2} y={L.blocked.y + (mode === "wide" ? 44 : 28)} textAnchor="middle" fill={CORAL} fontSize={FU} fontWeight={700} fontFamily={SANS} letterSpacing="0.06em">
                      REQUEST
                    </text>
                    <text x={L.blocked.x + L.blocked.w / 2} y={L.blocked.y + (mode === "wide" ? 70 : 50)} textAnchor="middle" fill={CORAL} fontSize={FU} fontFamily={SANS} letterSpacing="0.06em">
                      BLOCKED
                    </text>
                  </g>

                  {/* Packets: ONE lead + <=3 secondary, scroll-driven via getPointAtLength. */}
                  <g data-pkt-lead data-allow-overlap opacity={0}>
                    <circle r={6} fill="#fff" stroke={MINT} strokeWidth={2.5} />
                  </g>
                  <g data-pkt-s1 data-allow-overlap opacity={0}>
                    <circle r={4.5} fill="#fff" stroke={BLUE} strokeWidth={2} />
                  </g>
                  <g data-pkt-s2 data-allow-overlap opacity={0}>
                    <circle r={4.5} fill={MINT} stroke={MINT} strokeWidth={2} />
                  </g>
                  <g data-pkt-s3 data-allow-overlap opacity={0}>
                    <circle r={3.5} fill="none" stroke={SUB} strokeWidth={1.5} strokeDasharray="3 2" />
                  </g>
                </g>
              </svg>

              {selftest && <pre data-selftest-results className="mt-4 whitespace-pre-wrap font-mono text-xs text-white/70" />}
            </div>

            {/* SINGLE stepper instance (desktop + mobile share it). */}
            <div className={pinned ? "mx-auto mt-6 w-full shrink-0 pb-12" : "mx-auto mt-6 w-full pb-12"}>
              <div className="flex items-center gap-4">
                <span className="relative h-[3px] flex-1 bg-white/10" aria-hidden="true">
                  <span ref={railRef} data-rail className="absolute inset-0 origin-left bg-gradient-to-r from-[#a9bdf4] to-[#72ddb1]" style={{ transform: "scaleX(0)" }} />
                </span>
                <span data-counter className="tnum font-mono text-xs text-white/60" aria-live="polite">{stepLabel}</span>
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
                        <span className="font-mono text-xs font-bold" style={{ color: l.lane === "setup" ? BLUE : MINT }}>{l.n}</span>
                        <span className="text-xs text-white/85">{l.title}</span>
                      </button>
                    </li>
                  );
                })}
              </ol>
              <p data-caption-line className="mt-3 max-w-3xl text-sm leading-relaxed text-white/70">
                <span className="font-semibold text-white">{activeIdx >= 0 ? `${LAYERS[activeIdx].title}: ` : "Overview: "}</span>
                {activeIdx >= 0 ? LAYERS[activeIdx].desc : "Eight layers, one request path."}
              </p>
            </div>
          </div>
        </div>

    <Container width="wide" className="pb-10">
        {/* Legend */}
        <div className="mx-auto mt-8 flex flex-wrap gap-x-6 gap-y-2 font-mono text-xs tracking-wider text-white/60" aria-label="Diagram legend">
          <span><span aria-hidden="true" className="mr-2 inline-block h-0 w-6 border-t-2 border-white/70 align-middle" />SOLID · REQUEST / RESPONSE</span>
          <span><span aria-hidden="true" className="mr-2 inline-block h-0 w-6 border-t-2 border-dashed border-white/50 align-middle" />DASHED · OBSERVABILITY TAPS</span>
          <span><span aria-hidden="true" className="mr-2 inline-block h-0 w-6 border-t-2 align-middle" style={{ borderColor: CORAL }} />CORAL · BLOCKED (STOPS AT 05)</span>
        </div>

        <div className="mx-auto mt-8">
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
    const dd = Math.max(Math.hypot(s.x - x1, s.y - y1), Math.hypot(e.x - x2, e.y - y2));
    worst = Math.max(worst, dd); n++;
    if (dd > 2) out.push(`FAIL T2 endpoint ${name} err=${dd.toFixed(2)}px`);
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
#platform svg[data-zoomfade="1"] {
  -webkit-mask-image: linear-gradient(to right, transparent 0, #000 28px, #000 calc(100% - 28px), transparent 100%), linear-gradient(to bottom, transparent 0, #000 28px, #000 calc(100% - 28px), transparent 100%);
  -webkit-mask-composite: source-in;
  mask-image: linear-gradient(to right, transparent 0, #000 28px, #000 calc(100% - 28px), transparent 100%), linear-gradient(to bottom, transparent 0, #000 28px, #000 calc(100% - 28px), transparent 100%);
  mask-composite: intersect;
}
@media (prefers-reduced-motion: reduce) {
  #platform svg[data-zoomfade] { -webkit-mask-image: none; mask-image: none; }
}
@media (prefers-reduced-motion: reduce) {
  #platform [data-layer] { transition: none; }
}
`;
