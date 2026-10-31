"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { Container, Section, SectionHeading } from "@/components/ui/layout";
import { Badge } from "@/components/ui/primitives";
import {
  IconChart,
  IconKey,
  IconLayers,
  IconLock,
  IconOrg,
  IconShield,
  IconTerminal,
} from "@/components/ui/icons";
import {
  animate,
  createTimeline,
  fadeUp,
  scaleReveal,
  staggerReveal,
  useInViewOnce,
  useParallax,
  useReducedMotion,
  useRevealOnScroll,
  utils,
} from "@/lib/animations";
import { PROVIDERS } from "@/lib/site";

// Product preview — honest, faithful mockups of the real ToLLma app UI.
// Built from real product facts in site.ts (providers, guardrail categories,
// enforcement modes); no invented capabilities or fabricated metrics.

const TABS = [
  { id: "providers", label: "Providers", Icon: IconLayers },
  { id: "keys", label: "API keys", Icon: IconKey },
  { id: "usage", label: "Usage", Icon: IconChart },
  { id: "guardrails", label: "Guardrails", Icon: IconShield },
  { id: "logs", label: "Prompt logs", Icon: IconTerminal },
  { id: "orgs", label: "Organizations", Icon: IconOrg },
] as const;

type TabId = (typeof TABS)[number]["id"];

// ---------- shared mockup primitives ----------

function FrameDot({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`size-2.5 rounded-full transition-transform duration-[var(--dur-fast)] ease-[var(--ease-out-expo)] hover:scale-125 motion-reduce:transition-none motion-reduce:hover:scale-100 ${className}`}
    />
  );
}

function StatusPill({ tone, children }: { tone: "ok" | "warn" | "danger"; children: string }) {
  const tones = {
    ok: "bg-ok-soft text-ok-ink",
    warn: "bg-warn/10 text-warn-ink",
    danger: "bg-danger-soft text-danger-ink",
  } as const;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${tones[tone]}`}
    >
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}

function Avatar({ initials }: { initials: string }) {
  return (
    <span
      aria-hidden
      className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-soft text-[0.65rem] font-semibold text-brand-strong"
    >
      {initials}
    </span>
  );
}

// Row wrapper used for the staggered panel-in animation.
function Row({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      data-row
      className={`flex items-center gap-3 px-4 py-3 transition-colors duration-[var(--dur-fast)] hover:bg-surface-cool motion-reduce:transition-none sm:px-5 ${className}`}
    >
      {children}
    </div>
  );
}

function PanelShell({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-surface-cool/60 px-4 py-3 sm:px-5">
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        {hint && <p className="text-xs text-muted">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

// ---------- 1. providers ----------

function ProvidersPanel() {
  const shown = PROVIDERS.filter((p) =>
    ["openai", "anthropic", "gemini", "bedrock", "custom"].includes(p.id)
  );
  return (
    <PanelShell title="Providers" hint="Connected adapters">
      <div className="flex flex-col divide-y divide-line">
        {shown.map((p) => (
          <Row key={p.id} className="flex-wrap">
            <span
              aria-hidden
              className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-line bg-surface-cool text-muted"
            >
              <IconLayers size={16} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-ink">{p.name}</p>
              <p className="truncate font-mono text-xs text-muted">{p.api}</p>
            </div>
            <span className="hidden max-w-full truncate font-mono text-xs text-faint md:block">{p.endpoints[0]}</span>
            <div className="flex items-center gap-2">
              {p.tools && <Badge tone="brand">tools</Badge>}
              <StatusPill tone="ok">Active</StatusPill>
            </div>
          </Row>
        ))}
      </div>
    </PanelShell>
  );
}

// ---------- 2. api keys ----------

const MOCK_KEYS = [
  { label: "production", masked: "sk-tollma-••••1a2b", used: 62, scope: "global" },
  { label: "staging", masked: "sk-tollma-••••9f4e", used: 24, scope: "api_key" },
  { label: "ci-pipeline", masked: "sk-tollma-••••c7d1", used: 81, scope: "api_key" },
] as const;

function KeysPanel() {
  return (
    <PanelShell title="API keys" hint="Keys are shown masked">
      <div className="flex flex-col divide-y divide-line">
        {MOCK_KEYS.map((k) => (
          <Row key={k.label} className="flex-wrap">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-ink">{k.label}</p>
              <p className="truncate font-mono text-xs text-muted">{k.masked}</p>
            </div>
            <Badge tone="neutral">{k.scope}</Badge>
            <div className="flex w-full items-center gap-3 sm:w-auto sm:min-w-[10rem]">
              <div
                role="progressbar"
                aria-label={`Budget usage for ${k.label}`}
                aria-valuenow={k.used}
                aria-valuemin={0}
                aria-valuemax={100}
                className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-tint"
              >
                <span
                  className={`block h-full rounded-full ${k.used > 80 ? "bg-warn" : "bg-brand"}`}
                  style={{ width: `${k.used}%` }}
                />
              </div>
              <span className="w-16 shrink-0 text-right text-xs text-muted">{k.used}% limit</span>
            </div>
          </Row>
        ))}
      </div>
    </PanelShell>
  );
}

// ---------- 3. usage analytics ----------

// Generic, dimensionless bars — illustrative shape only, no real figures.
const USAGE_BARS = [42, 58, 36, 74, 61, 88, 52, 69, 45, 80, 63, 95] as const;
const USAGE_W = 6;
const USAGE_GAP = 10;
const USAGE_CHART_W = USAGE_BARS.length * (USAGE_W + USAGE_GAP);
const USAGE_CHART_H = 120;

function UsagePanel() {
  return (
    <PanelShell title="Usage analytics" hint="Illustrative — not live data">
      <div className="flex flex-col gap-4 p-4 sm:p-5">
        <div className="flex flex-wrap gap-5">
          <div>
            <p className="text-xs text-muted">Tokens</p>
            <p className="text-sm font-semibold text-ink">input + output</p>
          </div>
          <div>
            <p className="text-xs text-muted">Cost</p>
            <p className="text-sm font-semibold text-ink">per provider</p>
          </div>
          <div>
            <p className="text-xs text-muted">Window</p>
            <p className="text-sm font-semibold text-ink">over time</p>
          </div>
        </div>
        <div className="overflow-hidden rounded-xl border border-line bg-surface-cool/40 p-4">
          <svg
            viewBox={`0 0 ${USAGE_CHART_W} ${USAGE_CHART_H + 22}`}
            preserveAspectRatio="xMidYMid meet"
            className="h-40 w-full"
            role="img"
            aria-label="Illustrative bar chart of token usage and cost over time"
          >
            <line x1="0" y1={USAGE_CHART_H} x2={USAGE_CHART_W} y2={USAGE_CHART_H} stroke="currentColor" className="text-line-strong" strokeWidth="1" />
            {[0.25, 0.5, 0.75].map((f) => (
              <line
                key={f}
                x1="0"
                y1={USAGE_CHART_H * (1 - f)}
                x2={USAGE_CHART_W}
                y2={USAGE_CHART_H * (1 - f)}
                stroke="currentColor"
                className="text-line"
                strokeWidth="1"
                strokeDasharray="2 4"
              />
            ))}
            {USAGE_BARS.map((h, i) => (
              <g key={i}>
                <rect
                  x={i * (USAGE_W + USAGE_GAP)}
                  y={USAGE_CHART_H - (h / 100) * USAGE_CHART_H}
                  width={USAGE_W}
                  height={(h / 100) * USAGE_CHART_H}
                  rx="2"
                  className="fill-brand"
                  opacity={0.85}
                />
                <rect
                  x={i * (USAGE_W + USAGE_GAP)}
                  y={USAGE_CHART_H - (h / 100) * USAGE_CHART_H * 0.55}
                  width={USAGE_W}
                  height={(h / 100) * USAGE_CHART_H * 0.55}
                  rx="2"
                  className="fill-teal"
                  opacity={0.9}
                />
              </g>
            ))}
            <text x="0" y={USAGE_CHART_H + 16} className="fill-muted text-[9px]">earlier</text>
            <text x={USAGE_CHART_W} y={USAGE_CHART_H + 16} textAnchor="end" className="fill-muted text-[9px]">recent</text>
          </svg>
        </div>
        <p className="text-xs text-faint">Axes are relative. Exact figures are available in the app.</p>
      </div>
    </PanelShell>
  );
}

// ---------- 4. guardrails ----------

const MOCK_POLICIES = [
  { cat: "harmful_content", mode: "block", evaluator: "internal" },
  { cat: "prompt_injection", mode: "block", evaluator: "laya" },
  { cat: "secret_leakage", mode: "block", evaluator: "internal" },
  { cat: "pii", mode: "monitor", evaluator: "jev" },
  { cat: "unsafe_output", mode: "monitor", evaluator: "openai_moderation" },
] as const;

function GuardrailsPanel() {
  return (
    <PanelShell title="Guardrails" hint="Policies + enforcement mode">
      <div className="flex flex-col divide-y divide-line">
        {MOCK_POLICIES.map((p) => {
          return (
            <Row key={p.cat} className="flex-wrap">
              <span
                aria-hidden
                className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-line bg-surface-cool text-muted"
              >
                <IconShield size={16} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-sm text-ink">{p.cat}</p>
                <p className="truncate text-xs text-muted">evaluator: {p.evaluator}</p>
              </div>
              <StatusPill tone={p.mode === "block" ? "danger" : "warn"}>
                {p.mode === "block" ? "Block" : "Monitor"}
              </StatusPill>
            </Row>
          );
        })}
      </div>
    </PanelShell>
  );
}

// ---------- 5. prompt logs ----------

const MOCK_LOGS = [
  { endpoint: "/v1/chat/completions", model: "gpt-4o-mini", status: "200", ts: "14:02:31" },
  { endpoint: "/v1/messages", model: "claude-sonnet", status: "200", ts: "14:02:29" },
  { endpoint: "/v1/chat/completions", model: "gemini-flash", status: "429", ts: "14:02:11" },
  { endpoint: "/v1/responses", model: "gpt-4o", status: "200", ts: "14:01:58" },
  { endpoint: "/v1/chat/completions", model: "bedrock-converse", status: "500", ts: "14:01:42" },
] as const;

function statusTone(code: string): "ok" | "warn" | "danger" {
  if (code === "200") return "ok";
  if (code === "429") return "warn";
  return "danger";
}

function LogsPanel() {
  return (
    <PanelShell title="Prompt logs" hint="Recent gateway requests">
      <div className="overflow-x-auto focus-visible:outline-2 focus-visible:outline-brand focus-visible:-outline-offset-2" role="region" aria-label="Prompt log entries" tabIndex={0}>
        <table className="w-full min-w-[34rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-line bg-surface-cool/60 text-left text-xs text-muted">
              <th scope="col" className="px-4 py-2.5 font-medium sm:px-5">Endpoint</th>
              <th scope="col" className="px-4 py-2.5 font-medium sm:px-5">Model</th>
              <th scope="col" className="px-4 py-2.5 font-medium sm:px-5">Status</th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium sm:px-5">Time</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {MOCK_LOGS.map((l, i) => (
              <tr key={i} data-row className="transition-colors duration-[var(--dur-fast)] hover:bg-surface-cool motion-reduce:transition-none">
                <td className="px-4 py-3 font-mono text-xs text-ink sm:px-5">{l.endpoint}</td>
                <td className="px-4 py-3 text-xs text-muted sm:px-5">{l.model}</td>
                <td className="px-4 py-3 sm:px-5">
                  <StatusPill tone={statusTone(l.status)}>{l.status}</StatusPill>
                </td>
                <td className="px-4 py-3 text-right font-mono text-xs text-faint sm:px-5">{l.ts}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </PanelShell>
  );
}

// ---------- 6. organizations ----------

const MOCK_ORG = {
  name: "Acme Inc.",
  teams: [
    { name: "Platform", members: [{ n: "Ava Chen", r: "owner" }, { n: "Ravi Patel", r: "admin" }] },
    { name: "Research", members: [{ n: "Mia Lopez", r: "member" }, { n: "Jon Park", r: "member" }] },
  ],
};

function OrgsPanel() {
  return (
    <PanelShell title="Organizations" hint="Org → teams → members">
      <div className="flex flex-col gap-3 p-4 sm:p-5">
        <div className="flex items-center gap-3 rounded-xl border border-line bg-surface-cool/40 px-4 py-3">
          <span aria-hidden className="flex size-8 items-center justify-center rounded-lg bg-brand-soft text-brand-strong">
            <IconOrg size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-ink">{MOCK_ORG.name}</p>
            <p className="text-xs text-muted">organization</p>
          </div>
          <Badge tone="brand">{MOCK_ORG.teams.length} teams</Badge>
        </div>
        {MOCK_ORG.teams.map((t) => (
          <div key={t.name} className="ml-3 flex flex-col gap-2 border-l border-line pl-4 sm:ml-6">
            <div className="flex items-center justify-between gap-2 pt-1">
              <p className="text-sm font-medium text-ink">{t.name}</p>
              <span className="text-xs text-muted">{t.members.length} members</span>
            </div>
            {t.members.map((m) => (
              <div key={m.n} data-row className="flex items-center gap-3 rounded-lg border border-line px-3 py-2">
                <Avatar initials={m.n.split(" ").map((w) => w[0]).join("")} />
                <p className="min-w-0 flex-1 truncate text-sm text-ink-soft">{m.n}</p>
                <Badge tone={m.r === "owner" ? "brand" : "neutral"}>{m.r}</Badge>
              </div>
            ))}
          </div>
        ))}
      </div>
    </PanelShell>
  );
}

// ---------- main ----------

export default function Product() {
  const [active, setActive] = useState<TabId>(TABS[0].id);
  // The visible panel trails `active` by one short exit beat (slide + fade out).
  const [displayed, setDisplayed] = useState<TabId>(TABS[0].id);
  const reduced = useReducedMotion();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const panelRef = useRef<HTMLDivElement>(null);
  const revealRef = useRevealOnScroll();
  const [viewRef, seen] = useInViewOnce<HTMLDivElement>(0.2);
  const bgRef = useParallax<HTMLDivElement>(0.05);
  const indicatorRef = useRef<HTMLSpanElement | null>(null);
  // The first panel reveal belongs to the layered boot sequence, not the tab switch.
  const isFirstEnter = useRef(true);
  const activeIndex = TABS.findIndex((t) => t.id === active);

  // Roving keyboard nav across the tablist (arrows + Home/End).
  function onTabKeyDown(e: KeyboardEvent<HTMLButtonElement>, i: number) {
    let next: number | null = null;
    if (e.key === "ArrowRight") next = (i + 1) % TABS.length;
    else if (e.key === "ArrowLeft") next = (i - 1 + TABS.length) % TABS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = TABS.length - 1;
    if (next === null) return;
    e.preventDefault();
    setActive(TABS[next].id);
    tabRefs.current[next]?.focus();
  }

  // Accent indicator: track the active tab's box (pre-paint, resize-safe).
  useLayoutEffect(() => {
    const ind = indicatorRef.current;
    const update = () => {
      const tab = tabRefs.current[activeIndex];
      if (!ind || !tab) return;
      const first = !ind.dataset.ready;
      // Suppress the transition for the initial measurement only.
      if (first) ind.style.transition = "none";
      ind.style.width = `${tab.offsetWidth}px`;
      ind.style.height = `${tab.offsetHeight}px`;
      ind.style.transform = `translateX(${tab.offsetLeft}px)`;
      if (first) {
        void ind.offsetWidth; // flush so the first slide starts from here
        ind.style.transition = "";
        ind.dataset.ready = "1";
      }
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [activeIndex]);

  // Hide the boot layers only when JS is alive and motion is allowed, so
  // reduced-motion / no-JS users see the finished interface immediately.
  useLayoutEffect(() => {
    const root = viewRef.current;
    if (!root || reduced) return;
    const layers = () => root.querySelectorAll("[data-boot], [data-row]");
    utils.set(layers(), { opacity: 0 });
    return () => {
      utils.set(layers(), { clear: "all" });
    };
  }, [reduced, viewRef]);

  // Layered entrance ("interface boots up"), once the frame enters view:
  // frame fades/scales in, title bar slides down, rail items stagger —
  // total ~1.2s, non-blocking. Panel content is the last layer (effect below).
  useEffect(() => {
    const root = viewRef.current;
    if (!root || !seen || reduced) return;
    const frame = root.querySelector<HTMLElement>('[data-boot="frame"]');
    const titlebar = root.querySelector<HTMLElement>('[data-boot="titlebar"]');
    const rails = Array.from(root.querySelectorAll<HTMLElement>('[data-boot="rail"]'));
    const tl = createTimeline({ defaults: { ease: "outExpo" } });
    if (frame) tl.add(frame, { ...scaleReveal(0.97, 550) }, 0);
    if (titlebar) tl.add(titlebar, { ...fadeUp(-14, 450) }, 300);
    if (rails.length) tl.add(rails, { ...scaleReveal(0.85, 380), delay: staggerReveal(60) }, 420);
    return () => {
      tl.revert();
      utils.set(root.querySelectorAll("[data-boot]"), { clear: "all" });
    };
  }, [seen, reduced, viewRef]);

  // Outgoing panel: slides slightly left + fades before the swap (snappy).
  useEffect(() => {
    if (displayed === active) return;
    const panel = panelRef.current;
    if (reduced || !panel) {
      setDisplayed(active);
      return;
    }
    const out = animate(panel, { opacity: [1, 0], x: [0, -8], duration: 160, ease: "inQuad" });
    const t = window.setTimeout(() => setDisplayed(active), 110);
    return () => {
      window.clearTimeout(t);
      out.revert();
    };
  }, [active, displayed, reduced]);

  // Incoming panel: enters from the right + fades in while rows stagger
  // behind it. First time around it waits for the boot sequence and joins
  // as the final layer (~1.2s total); tab switches finish the shell in 350ms.
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const initial = isFirstEnter.current;
    if (initial && !seen) return; // boot sequence owns the first reveal
    isFirstEnter.current = false;
    if (reduced) return;
    const boot = initial ? 600 : 0;
    const enter = animate(panel, {
      opacity: [0, 1],
      x: [8, 0],
      duration: initial ? 480 : 240,
      delay: boot,
      ease: "outExpo",
    });
    const rows = panel.querySelectorAll("[data-row]");
    const rowAnim = rows.length
      ? animate(rows, {
          opacity: [0, 1],
          y: [10, 0],
          duration: 300,
          delay: staggerReveal(45, { start: boot + (initial ? 60 : 40) }),
          ease: "outExpo",
        })
      : null;
    return () => {
      enter.revert();
      rowAnim?.revert();
      // revert() restores the pre-animation values (rows were hidden) — clear
      // them so a reduced-motion toggle mid-session never leaves content hidden.
      utils.set([panel, ...rows], { clear: "all" });
    };
  }, [displayed, reduced, seen]);

  // App frame — perspective tilt that levels out as it scrolls in.
  const frameRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (!window.matchMedia("(min-width: 768px)").matches) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight || 1;
      const p = Math.min(1, Math.max(0, (vh - r.top) / (vh * 0.85)));
      const rx = (1 - p) * 6;
      el.style.transform = `perspective(1600px) rotateX(${rx.toFixed(2)}deg)`;
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
      el.style.transform = "";
    };
  }, []);

  return (
    <Section id="product" tone="surface">
      <Container width="wide">
        <div ref={revealRef as RefObject<HTMLDivElement | null>}>
          <SectionHeading
            eyebrow="Product preview"
            title="Your AI stack, in one control plane"
            lead="Browse providers, keys, guardrails, logs, and teams — a faithful, interactive preview of the ToLLma dashboard."
          />

          {/* Tablist — horizontal scroller on small screens */}
          <div
            role="tablist"
            aria-label="Product views"
            aria-orientation="horizontal"
            className="relative mt-10 flex scroll-px-4 justify-start gap-1.5 overflow-x-auto px-1 pb-1 motion-safe:scroll-smooth [-ms-overflow-style:none] [scrollbar-width:none] lg:justify-center"
          >
            {/* Sliding accent indicator — synced to the active tab via transform */}
            <span
              ref={indicatorRef}
              aria-hidden
              className="pointer-events-none absolute left-0 top-0 rounded-full bg-brand-soft transition-[width,height,transform] duration-[var(--dur-base)] ease-[var(--ease-out-expo)] motion-reduce:transition-none"
              style={{ width: 0, height: 0 }}
            />
            {TABS.map((t, i) => {
              const isActive = i === activeIndex;
              return (
                <button
                  key={t.id}
                  ref={(el) => {
                    tabRefs.current[i] = el;
                  }}
                  role="tab"
                  id={`product-tab-${t.id}`}
                  aria-selected={isActive}
                  aria-controls="product-panel"
                  tabIndex={isActive ? 0 : -1}
                  onClick={() => setActive(t.id)}
                  onKeyDown={(e) => onTabKeyDown(e, i)}
                  className={`relative inline-flex shrink-0 items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors duration-200 motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2 ${
                    isActive
                      ? "border-transparent font-semibold text-brand-strong"
                      : "border-line bg-surface text-muted hover:border-brand hover:text-brand"
                  }`}
                >
                  <t.Icon size={16} />
                  {t.label}
                </button>
              );
            })}
          </div>

          {/* App frame — decorative parallax layer behind it */}
          <div ref={viewRef} className="relative mt-6">
            <div
              ref={bgRef}
              aria-hidden
              className="pointer-events-none absolute -inset-x-4 -top-12 h-40 bg-grid opacity-70"
            />
            <div
              ref={frameRef}
              data-boot="frame"
              className="relative origin-top overflow-hidden rounded-2xl border border-line bg-surface shadow-lg"
            >
              {/* Mock title bar */}
              <div
                data-boot="titlebar"
                className="flex items-center gap-3 border-b border-line bg-surface-cool px-4 py-3"
              >
                <span className="flex items-center gap-1.5" aria-hidden>
                  <FrameDot className="bg-danger/60" />
                  <FrameDot className="bg-warn/60" />
                  <FrameDot className="bg-ok/60" />
                </span>
                <span
                  aria-hidden
                  className="mx-auto flex min-w-0 max-w-[44vw] items-center gap-1.5 truncate rounded-md bg-surface px-3 py-1 font-mono text-xs text-muted sm:max-w-none"
                >
                  <IconLock size={12} />
                  app.tollma.dev
                </span>
              </div>

              <div className="flex">
                {/* Sidebar rail — hidden below lg */}
                <nav
                  aria-hidden
                  className="relative hidden w-14 shrink-0 flex-col items-center gap-2 border-r border-line bg-surface-cool/50 py-4 lg:flex"
                >
                  {/* Sliding active indicator (44px pitch: h-9 + gap-2) */}
                  <span
                    aria-hidden
                    className="absolute left-1/2 top-4 size-9 rounded-lg bg-brand-soft transition-transform duration-[var(--dur-base)] ease-[var(--ease-out-expo)] motion-reduce:transition-none"
                    style={{ transform: `translate(-50%, ${activeIndex * 44}px)` }}
                  />
                  {TABS.map((t, i) => (
                    <span
                      key={t.id}
                      data-boot="rail"
                      className={`relative flex size-9 items-center justify-center rounded-lg ${
                        i === activeIndex ? "text-brand-strong" : "text-faint"
                      }`}
                    >
                      <t.Icon size={18} />
                    </span>
                  ))}
                </nav>

                {/* Active panel */}
                <div
                  key={displayed}
                  id="product-panel"
                  ref={panelRef}
                  role="tabpanel"
                  aria-labelledby={`product-tab-${displayed}`}
                  tabIndex={0}
                  className="min-w-0 flex-1 focus-visible:outline-2 focus-visible:outline-brand focus-visible:-outline-offset-2 min-h-[18rem] sm:min-h-[20rem]"
                >
                  {displayed === "providers" && <ProvidersPanel />}
                  {displayed === "keys" && <KeysPanel />}
                  {displayed === "usage" && <UsagePanel />}
                  {displayed === "guardrails" && <GuardrailsPanel />}
                  {displayed === "logs" && <LogsPanel />}
                {displayed === "orgs" && <OrgsPanel />}
              </div>
            </div>
            </div>
          </div>

          <p className="mt-4 text-center text-xs text-faint">
            Interactive product preview. Layout and capabilities reflect the real ToLLma app; figures shown are illustrative.
          </p>
        </div>
      </Container>
    </Section>
  );
}
