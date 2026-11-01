"use client";

// R5 — six-window stacked dashboard (replaces the single Request
// Activity window). One tall region (~620vh) pins a centered sticky
// viewport; scroll progress v in [0,1] is the ONLY driver (pure
// function — scroll-up reverses exactly). Overview (i=0) sits at
// vertical center; each following window slides up from below
// (translateY 110vh → 0, transform-only) and lands opaque on top of
// the previous ones, which shrink to 0.96 + dim (scale via transform,
// dim via an overlay's opacity — cards themselves stay fully opaque,
// no bleed). The last window holds for v in [0.86, 1]. The sidebar in
// the top window highlights that window's page; the region mirrors it
// in data-active-page. Reduced-motion / no-JS: all six windows render
// as a plain static list (complete final state, no transforms).
import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "@/lib/animations";
import { prefersReducedMotion } from "@/lib/animations/motion-preference";
import {
  API_KEYS,
  KPIS,
  PAGES,
  PROVIDER_ROWS,
  REQUEST_LOGS,
  dailyCost,
  guardrailRows,
  keyUsage,
  providerStats,
  recentBlocked,
  spendByProvider,
  tokensByModel,
  topProviders,
  throughputByHour,
  type LogStatus,
  type PageId,
} from "@/data/dashboard";

const REGION_VH = 620;
/** Transitions occupy v in [0, TRANS_END]; the rest holds Analytics. */
const TRANS_END = 0.86;
const SEG = TRANS_END / (PAGES.length - 1);
const OFFSCREEN_VH = 110;
const COVERED_SCALE = 0.96;
const DIM_OPACITY = "0.22";

const SIDEBAR: PageId[] = [...PAGES];

const STATUS_STYLE: Record<LogStatus, string> = {
  Allowed: "bg-mint/60 text-coal",
  Warned: "bg-butter/70 text-coal",
  Blocked: "bg-warm text-coal",
  Pending: "bg-coal/10 text-coal/60",
  Throttled: "bg-peri/60 text-coal",
  "401": "bg-warm text-coal",
  "403": "bg-warm text-coal",
};

const STATUS_LABEL: Record<LogStatus, string> = {
  Allowed: "Allowed",
  Warned: "Warned",
  Blocked: "Blocked",
  Pending: "Pending",
  Throttled: "Throttled · 429",
  "401": "401 Unauthorized",
  "403": "403 Forbidden",
};

function StatusPill({ status, retryAfterS }: { status: LogStatus; retryAfterS?: number }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLE[status]}`}
      title={status === "Throttled" && retryAfterS != null ? `Retry-After ${retryAfterS}s` : undefined}
    >
      <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
      {STATUS_LABEL[status]}
    </span>
  );
}

function Sidebar({ page }: { page: PageId }) {
  return (
    <ul aria-label="Gateway sections" className="hidden border-r border-cream-line py-4 md:block">
      {SIDEBAR.map((s) => (
        <li
          key={s}
          className={`border-l-2 px-5 py-2 text-sm ${s === page ? "border-coal font-semibold text-coal" : "border-transparent text-coal/55"}`}
          aria-current={s === page ? "page" : undefined}
        >
          {s}
        </li>
      ))}
    </ul>
  );
}

/* One macOS-chrome window. data-allow-overlap marks the intentional
   stacking so overlap detectors skip these windows. */
function Window({
  page,
  heading,
  children,
}: {
  page: PageId;
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <div
      data-page={page}
      data-allow-overlap=""
      className="dash-window flex max-h-[82vh] w-[min(72rem,94vw)] flex-col overflow-hidden rounded-2xl border border-cream-line bg-white shadow-[0_40px_90px_-28px_rgba(23,25,20,0.35),0_12px_28px_-16px_rgba(23,25,20,0.22)]"
    >
      <div className="relative flex shrink-0 items-center border-b border-cream-line/80 px-5 py-3">
        <div className="flex items-center gap-2" aria-hidden="true">
          <span className="size-3 rounded-full" style={{ backgroundColor: "#FF5F57" }} />
          <span className="size-3 rounded-full" style={{ backgroundColor: "#FEBC2E" }} />
          <span className="size-3 rounded-full" style={{ backgroundColor: "#28C840" }} />
        </div>
        <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-[0.83rem] font-medium text-coal/70">
          ToLLma &mdash; {page}
        </p>
      </div>
      <div className="flex shrink-0 items-center justify-between gap-4 border-b border-cream-line px-6 py-4">
        <p className="font-serif text-lg text-coal">{heading}</p>
        <p className="rounded-full bg-cream px-2.5 py-0.5 text-xs font-medium text-coal/55">
          Sample data for illustration
        </p>
      </div>
      <div className="grid min-h-0 md:grid-cols-[180px_minmax(0,1fr)]">
        <Sidebar page={page} />
        <div className="min-w-0 min-h-0 overflow-y-auto">{children}</div>
      </div>
      {/* Dim veil for covered windows (opacity-only; card stays opaque). */}
      <div
        data-dim=""
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-2xl bg-night"
        style={{ opacity: 0 }}
      />
    </div>
  );
}

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

/* ---------------- window bodies (all derived from dashboard.ts) ---------------- */

function OverviewBody() {
  const hours = throughputByHour();
  const max = Math.max(1, ...hours);
  const top = topProviders().slice(0, 5);
  const topMax = Math.max(1, ...top.map((t) => t.req24h));
  const blocked = recentBlocked(4);
  const kpis = [
    { label: "Requests today", value: String(KPIS.requestsToday) },
    { label: "Allowed rate", value: `${(KPIS.allowedRate * 100).toFixed(1)}%` },
    { label: "Blocked", value: String(KPIS.blockedCount) },
    { label: "Spend today", value: money(KPIS.spendToday) },
  ];
  return (
    <div className="px-6 py-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-xl border border-cream-line bg-cream/60 px-4 py-3">
            <p className="font-mono text-2xl font-semibold text-coal">{k.value}</p>
            <p className="mt-1 text-xs font-medium text-coal/55">{k.label}</p>
          </div>
        ))}
      </div>
      <p className="mt-5 text-sm font-semibold text-coal">Throughput · requests per hour</p>
      <div className="mt-2 flex h-20 items-end gap-[3px]" role="img" aria-label={`Hourly requests, peak ${max}`}>
        {hours.map((h, i) => (
          <span
            key={i}
            className="min-w-0 flex-1 rounded-sm bg-mint"
            style={{ height: `${Math.max(4, Math.round((h / max) * 100))}%`, opacity: h === 0 ? 0.25 : 1 }}
          />
        ))}
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <div>
          <p className="text-sm font-semibold text-coal">Top providers by volume</p>
          <ul className="mt-2 space-y-2">
            {top.map((t) => (
              <li key={t.id} className="flex items-center gap-2 text-sm">
                <span className="w-28 shrink-0 truncate font-medium text-coal">{t.name}</span>
                <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-coal/10">
                  <span className="block h-full rounded-full bg-peri" style={{ width: `${Math.round((t.req24h / topMax) * 100)}%` }} />
                </span>
                <span className="w-8 shrink-0 text-right font-mono text-xs text-coal/55">{t.req24h}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-sm font-semibold text-coal">Recent blocked events</p>
          <ul className="mt-2 space-y-2">
            {blocked.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-2 rounded-lg border border-cream-line/70 px-3 py-1.5 text-xs">
                <span className="font-mono text-coal/55">{l.time}</span>
                <span className="min-w-0 flex-1 truncate font-medium text-coal">{l.model}</span>
                <span className="hidden shrink-0 text-coal/55 sm:inline">{l.category?.replace(/_/g, " ")}</span>
                <StatusPill status={l.status} />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function ProvidersBody() {
  return (
    <div className="overflow-x-auto px-2 py-2">
      <table className="w-full min-w-[640px] border-collapse text-left text-sm">
        <thead>
          <tr className="text-xs font-semibold uppercase tracking-wider text-coal/50">
            {["Provider", "API surface", "Status", "p50 latency", "Req 24h", "Error rate"].map((h) => (
              <th key={h} scope="col" className="px-4 py-2.5 font-semibold">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {PROVIDER_ROWS.map((p) => {
            const s = providerStats(p.id);
            return (
              <tr key={p.id} className="dash-row border-t border-cream-line/70">
                <td className="px-4 py-2.5 font-medium text-coal">{p.name}</td>
                <td className="px-4 py-2.5 font-mono text-[0.8rem] text-coal/70">{p.api}<span className="block text-[0.7rem] text-coal/45">{p.note}</span></td>
                <td className="px-4 py-2.5">
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${s.status === "Operational" ? "bg-mint/60 text-coal" : "bg-warm text-coal"}`}>
                    <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
                    {s.status}
                  </span>
                </td>
                <td className="px-4 py-2.5 font-mono text-[0.8rem] text-coal">{s.p50Ms} ms</td>
                <td className="px-4 py-2.5 font-mono text-[0.8rem] text-coal">{s.req24h}</td>
                <td className="px-4 py-2.5 font-mono text-[0.8rem] text-coal">{(s.errorRate * 100).toFixed(1)}%</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function KeysBody() {
  return (
    <div className="overflow-x-auto px-2 py-2">
      <table className="w-full min-w-[560px] border-collapse text-left text-sm">
        <thead>
          <tr className="text-xs font-semibold uppercase tracking-wider text-coal/50">
            {["Key", "Scope", "Budget", "Last used", "Status"].map((h) => (
              <th key={h} scope="col" className="px-4 py-2.5 font-semibold">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {API_KEYS.map((k) => {
            const u = keyUsage(k.id);
            const pct = Math.min(100, Math.round((u.used / u.limit) * 100));
            return (
              <tr key={k.id} className="dash-row border-t border-cream-line/70">
                <td className="px-4 py-2.5">
                  <span className="block font-medium text-coal">{k.id}</span>
                  <span className="block font-mono text-[0.75rem] text-coal/55">{k.masked}</span>
                </td>
                <td className="px-4 py-2.5 text-xs font-semibold text-coal/60">{k.scope}</td>
                <td className="px-4 py-2.5">
                  <span className="font-mono text-[0.8rem] text-coal">{money(u.used)} / {money(u.limit)}</span>
                  <span className="mt-1 block h-1.5 w-32 overflow-hidden rounded-full bg-coal/10">
                    <span className="block h-full rounded-full bg-mint" style={{ width: `${pct}%` }} />
                  </span>
                </td>
                <td className="px-4 py-2.5 font-mono text-[0.8rem] text-coal/70">{u.lastUsed}</td>
                <td className="px-4 py-2.5">
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${k.status === "active" ? "bg-mint/60 text-coal" : "bg-coal/10 text-coal/60"}`}>
                    <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
                    {k.status}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function GuardrailsBody() {
  const rows = guardrailRows();
  return (
    <div className="overflow-x-auto px-2 py-2">
      <table className="w-full min-w-[520px] border-collapse text-left text-sm">
        <thead>
          <tr className="text-xs font-semibold uppercase tracking-wider text-coal/50">
            {["Category", "Mode", "Scope", "Hits 24h"].map((h) => (
              <th key={h} scope="col" className="px-4 py-2.5 font-semibold">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((g) => (
            <tr key={g.category} className="dash-row border-t border-cream-line/70">
              <td className="px-4 py-2 font-mono text-[0.8rem] text-coal">{g.category}</td>
              <td className="px-4 py-2 text-xs font-semibold text-coal/60">{g.mode}</td>
              <td className="px-4 py-2 text-xs font-semibold text-coal/60">{g.scope}</td>
              <td className="px-4 py-2 font-mono text-[0.8rem] text-coal">{g.hits24h}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LogsBody() {
  return (
    <div className="overflow-x-auto px-2 py-2">
      <table className="w-full min-w-[720px] border-collapse text-left text-sm">
        <thead>
          <tr className="text-xs font-semibold uppercase tracking-wider text-coal/50">
            {["Time", "Key", "Model", "Provider", "Status", "Latency", "Tokens"].map((h) => (
              <th key={h} scope="col" className="px-4 py-2.5 font-semibold">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {REQUEST_LOGS.map((l) => (
            <tr key={l.id} className="dash-row border-t border-cream-line/70">
              <td className="px-4 py-2 font-mono text-[0.8rem] text-coal/70">{l.time}</td>
              <td className="px-4 py-2 font-mono text-[0.8rem] text-coal">{l.keyId}</td>
              <td className="px-4 py-2 font-mono text-[0.8rem] text-coal">{l.model}</td>
              <td className="px-4 py-2 text-[0.8rem] font-medium text-coal/70">{PROVIDER_ROWS.find((p) => p.id === l.provider)?.name}</td>
              <td className="px-4 py-2"><StatusPill status={l.status} retryAfterS={l.retryAfterS} /></td>
              <td className="px-4 py-2 font-mono text-[0.8rem] text-coal/70">{l.latencyMs === 0 ? "—" : `${l.latencyMs} ms`}</td>
              <td className="px-4 py-2 font-mono text-[0.8rem] text-coal/70">{l.tokens === 0 ? "—" : l.tokens.toLocaleString("en-US")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AnalyticsBody() {
  const spend = spendByProvider();
  const spendMax = Math.max(0.0001, ...spend.map((s) => s.spend));
  const tokens = tokensByModel();
  const tokensMax = Math.max(1, ...tokens.map((t) => t.tokens));
  const daily = dailyCost();
  const dailyMax = Math.max(0.0001, ...daily.map((b) => b.cost));
  // Static SVG cost line (6 buckets → 6 points).
  const W = 560, H = 120, PAD = 12;
  const pts = daily.map((b, i) => {
    const x = PAD + (i / Math.max(1, daily.length - 1)) * (W - PAD * 2);
    const y = H - PAD - (b.cost / dailyMax) * (H - PAD * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <div className="grid gap-5 px-6 py-5 lg:grid-cols-2">
      <div>
        <p className="text-sm font-semibold text-coal">Spend by provider</p>
        <ul className="mt-2 space-y-2">
          {spend.map((s) => (
            <li key={s.id} className="flex items-center gap-2 text-sm">
              <span className="w-28 shrink-0 text-[0.8rem] font-medium leading-tight text-coal">{s.name}</span>
              <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-coal/10">
                <span className="block h-full rounded-full bg-warm" style={{ width: `${Math.max(2, Math.round((s.spend / spendMax) * 100))}%` }} />
              </span>
              <span className="w-14 shrink-0 text-right font-mono text-xs text-coal/55">{money(s.spend)}</span>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <p className="text-sm font-semibold text-coal">Tokens by model</p>
        <ul className="mt-2 space-y-2">
          {tokens.map((t) => (
            <li key={t.model} className="flex items-center gap-2 text-sm">
              <span className="w-36 shrink-0 font-mono text-[0.8rem] leading-tight text-coal">{t.model}</span>
              <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-coal/10">
                <span className="block h-full rounded-full bg-peri" style={{ width: `${Math.max(2, Math.round((t.tokens / tokensMax) * 100))}%` }} />
              </span>
              <span className="w-14 shrink-0 text-right font-mono text-xs text-coal/55">{t.tokens >= 1000 ? `${(t.tokens / 1000).toFixed(1)}k` : t.tokens}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="lg:col-span-2">
        <p className="text-sm font-semibold text-coal">Daily cost</p>
        <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 h-28 w-full" role="img" aria-label={`Daily cost line, total ${money(KPIS.spendToday)}`}>
          <polyline points={pts.join(" ")} fill="none" stroke="var(--color-mint)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
          {pts.map((pt, i) => {
            const [x, y] = pt.split(",").map(Number);
            return <circle key={daily[i].label} cx={x} cy={y} r={3.5} fill="var(--color-coal)" />;
          })}
        </svg>
        <div className="mt-1 flex justify-between font-mono text-[0.7rem] text-coal/45">
          {daily.map((b) => <span key={b.label}>{b.label} · {money(b.cost)}</span>)}
        </div>
      </div>
    </div>
  );
}

const BODIES: Record<PageId, () => React.JSX.Element> = {
  Overview: OverviewBody,
  Providers: ProvidersBody,
  "API Keys": KeysBody,
  Guardrails: GuardrailsBody,
  "Request Logs": LogsBody,
  Analytics: AnalyticsBody,
};

const HEADINGS: Record<PageId, string> = {
  Overview: "Request Activity",
  Providers: "Providers",
  "API Keys": "API Keys",
  Guardrails: "Guardrails",
  "Request Logs": "Request Logs",
  Analytics: "Analytics",
};

export default function DashboardStack() {
  const regionRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [active, setActive] = useState(0);
  const [jsReady, setJsReady] = useState(false);
  const reduced = useReducedMotion();

  useEffect(() => {
    setJsReady(true);
  }, []);

  const static_ = !jsReady || reduced;

  /* Scroll driver: single rAF loop, passive listeners. Progress v is a
     pure function of the region rect, so every frame is exactly
     reversible; only the active index goes through state. */
  useEffect(() => {
    if (static_) return;
    let raf = 0;
    const paint = () => {
      raf = 0;
      const region = regionRef.current;
      if (!region) return;
      const vh = window.innerHeight || 1;
      const total = region.offsetHeight - vh;
      const rect = region.getBoundingClientRect();
      const v = total > 0 ? Math.min(1, Math.max(0, -rect.top / total)) : 0;
      const next = Math.min(PAGES.length - 1, Math.round(v / SEG));
      setActive((prev) => (prev === next ? prev : next));
      cardRefs.current.forEach((el, i) => {
        if (!el) return;
        const t = i === 0 ? 1 : Math.min(1, Math.max(0, (v - (i - 1) * SEG) / SEG));
        const y = ((1 - t) * OFFSCREEN_VH).toFixed(2);
        const covered = i < next;
        const scale = covered ? COVERED_SCALE : 1;
        el.style.transform = `translate(-50%, -50%) translate3d(0, ${y}vh, 0) scale(${scale})`;
        const dim = el.querySelector<HTMLElement>("[data-dim]");
        if (dim) dim.style.opacity = covered ? DIM_OPACITY : "0";
        el.style.pointerEvents = i === next ? "auto" : "none";
        el.style.visibility = t <= 0 ? "hidden" : "visible";
      });
      region.dataset.progress = v.toFixed(4);
      region.dataset.activePage = PAGES[next];
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(paint);
    };
    paint();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [static_]);

  if (static_) {
    // No-JS / reduced-motion: complete final state, plain vertical list.
    return (
      <div ref={regionRef} id="activity" data-active-page="Overview" className="mx-auto mt-14 flex max-w-6xl flex-col gap-8 scroll-mt-24">
        {PAGES.map((p) => {
          const Body = BODIES[p];
          return (
            <div key={p} className="relative">
              <Window page={p} heading={HEADINGS[p]}>
                <Body />
              </Window>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div
      ref={regionRef}
      id="activity"
      data-active-page={PAGES[active]}
      className="relative scroll-mt-24"
      style={{ height: `${REGION_VH}vh` }}
    >
      <div className="sticky top-0 flex h-screen items-center justify-center overflow-hidden">
        {PAGES.map((p, i) => {
          const Body = BODIES[p];
          return (
            <div
              key={p}
              ref={(el) => {
                cardRefs.current[i] = el;
              }}
              data-page-wrap={p}
              className="absolute left-1/2 top-1/2"
              style={{ zIndex: i, transform: "translate(-50%, -50%)", pointerEvents: i === 0 ? "auto" : "none" }}
            >
              <Window page={p} heading={HEADINGS[p]}>
                <Body />
              </Window>
            </div>
          );
        })}
        <span className="sr-only" aria-live="polite">
          {PAGES[active]} window on top.
        </span>
      </div>
    </div>
  );
}
