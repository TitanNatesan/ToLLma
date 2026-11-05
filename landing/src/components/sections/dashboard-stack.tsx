"use client";

// Six-window stacked dashboard. The stacking engine is the free React
// Bits ScrollStack (vendored, no deps) in useWindowScroll mode: each
// window pins in turn while covered windows shrink + dim, exactly like
// the previous hand-rolled scrub region but driven by native scroll.
// All six windows share one fixed size (w × h per breakpoint) with
// content condensed to fit — no scrollable content inside. The sidebar
// in each window highlights that window's page; an IntersectionObserver
// mirrors the topmost card into data-active-page + the aria-live line
// (refs only, zero re-renders on scroll). Reduced-motion / no-JS: all
// six windows render as a plain static list (complete final state,
// no transforms). Native page scroll is preserved (smoothScroll off —
// the upstream default would hijack the wheel and fight GSAP pins).
import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "@/lib/animations";
import ScrollStack, { ScrollStackItem } from "@/components/ui/scroll-stack";
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
      className={`dash-badge inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLE[status]}`}
      title={status === "Throttled" && retryAfterS != null ? `Retry-After ${retryAfterS}s` : undefined}
    >
      <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
      {STATUS_LABEL[status]}
    </span>
  );
}

function Sidebar({ page }: { page: PageId }) {
  return (
    <ul aria-label="Gateway sections" className="dash-glass-side hidden border-r border-cream-line/60 py-4 md:block">
      {SIDEBAR.map((s) => (
        <li
          key={s}
          className={`border-l-2 px-5 py-2 text-sm ${s === page ? "border-mint bg-white/50 font-semibold text-coal" : "border-transparent text-coal/55"}`}
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
      className="dash-window dash-glass-window relative flex h-[740px] w-[min(70rem,92vw)] flex-col overflow-hidden md:h-[600px] shadow-[0_80px_140px_-40px_rgba(23,25,20,0.5),0_36px_70px_-28px_rgba(23,25,20,0.28),0_2px_8px_rgba(23,25,20,0.12)]"
    >
      <div className="dash-glass-title relative flex shrink-0 items-center border-b border-cream-line/60 px-5 py-3">
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
        <p className="rounded-full border border-white/70 bg-white/60 px-2.5 py-0.5 text-xs font-medium text-coal/55">
          Sample data for illustration
        </p>
      </div>
      <div className="grid min-h-0 flex-1 md:grid-cols-[180px_minmax(0,1fr)]">
        <Sidebar page={page} />
        <div className="min-w-0 min-h-0 overflow-hidden">{children}</div>
      </div>
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
  const top = topProviders().slice(0, 4);
  const topMax = Math.max(1, ...top.map((t) => t.req24h));
  const blocked = recentBlocked(3);
  const kpis = [
    { label: "Requests today", value: String(KPIS.requestsToday) },
    { label: "Allowed rate", value: `${(KPIS.allowedRate * 100).toFixed(1)}%` },
    { label: "Blocked", value: String(KPIS.blockedCount) },
    { label: "Spend today", value: money(KPIS.spendToday) },
  ];
  return (
    <div className="px-5 py-4">
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.label} className="dash-glass-card px-3.5 py-2.5">
            <p className="font-mono text-xl font-semibold text-coal">{k.value}</p>
            <p className="mt-0.5 text-xs font-medium text-coal/55">{k.label}</p>
          </div>
        ))}
      </div>
      <p className="mt-4 text-sm font-semibold text-coal">Throughput · requests per hour</p>
      <div className="mt-1.5 flex h-16 items-end gap-[3px]" role="img" aria-label={`Hourly requests, peak ${max}`}>
        {hours.map((h, i) => (
          <span
            key={i}
            className="min-w-0 flex-1 rounded-sm bg-mint"
            style={{ height: `${Math.max(4, Math.round((h / max) * 100))}%`, opacity: h === 0 ? 0.25 : 1 }}
          />
        ))}
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div>
          <p className="text-sm font-semibold text-coal">Top providers by volume</p>
          <ul className="mt-1.5 space-y-1.5">
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
          <ul className="mt-1.5 space-y-1.5">
            {blocked.map((l) => (
              <li key={l.id} className="dash-glass-card flex items-center justify-between gap-2 px-3 py-1 text-xs">
                <span className="font-mono text-coal/55">{l.time}</span>
                <span className="min-w-0 flex-1 truncate font-medium text-coal">{l.model}</span>
                <span className="hidden shrink-0 text-coal/55 sm:inline">{l.category?.replace(/_/g, " ")}</span>
                <StatusPill status={l.status} />
              </li>
            ))}
          </ul>
        </div>
      </div>
      <p className="mt-3 border-t border-cream-line/70 pt-2 font-mono text-xs text-coal/45">
        {KPIS.requestsToday} requests today · {(KPIS.allowedRate * 100).toFixed(1)}% allowed · {money(KPIS.spendToday)} spend
      </p>
    </div>
  );
}

function ProvidersBody() {
  return (
    <div className="dash-glass-panel mx-3 mb-3 mt-1 overflow-x-auto px-2 py-1.5">
      <table className="w-full border-collapse text-left text-sm md:min-w-[600px]">
        <thead>
          <tr className="text-xs font-semibold uppercase tracking-wider text-coal/50">
            {[
              { l: "Provider", c: "" },
              { l: "API surface", c: "hidden md:table-cell" },
              { l: "Status", c: "" },
              { l: "p50 latency", c: "" },
              { l: "Req 24h", c: "hidden sm:table-cell" },
              { l: "Error rate", c: "hidden sm:table-cell" },
            ].map((h) => (
              <th key={h.l} scope="col" className={`px-2 py-2 font-semibold md:px-3 ${h.c}`}>{h.l}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {PROVIDER_ROWS.map((p) => {
            const s = providerStats(p.id);
            return (
              <tr key={p.id} className="dash-row border-t border-cream-line/70">
                <td className="px-2 py-1.5 font-medium text-coal md:px-3">{p.name}</td>
                <td className="hidden px-2 py-1.5 font-mono text-[0.8rem] text-coal/70 md:table-cell md:px-3">{p.api}<span className="block text-[0.7rem] text-coal/45">{p.note}</span></td>
                <td className="px-2 py-1.5 md:px-3">
                  <span className={`dash-badge inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${s.status === "Operational" ? "bg-mint/60 text-coal" : "bg-butter text-coal"}`}>
                    <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
                    {s.status}
                  </span>
                </td>
                <td className="px-2 py-1.5 font-mono text-[0.8rem] text-coal md:px-3">{s.p50Ms} ms</td>
                <td className="hidden px-2 py-1.5 font-mono text-[0.8rem] text-coal sm:table-cell md:px-3">{s.req24h}</td>
                <td className="hidden px-2 py-1.5 font-mono text-[0.8rem] text-coal sm:table-cell md:px-3">{(s.errorRate * 100).toFixed(1)}%</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="px-4 pb-3 pt-1 font-mono text-xs text-coal/45">6 adapters · one OpenAI-compatible endpoint</p>
    </div>
  );
}

function KeysBody() {
  return (
    <div className="dash-glass-panel mx-3 mb-3 mt-1 overflow-x-auto px-2 py-1.5">
      <table className="w-full min-w-[540px] border-collapse text-left text-sm">
        <thead>
          <tr className="text-xs font-semibold uppercase tracking-wider text-coal/50">
            {["Key", "Scope", "Budget", "Last used", "Status"].map((h) => (
              <th key={h} scope="col" className="px-4 py-2 font-semibold">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {API_KEYS.map((k) => {
            const u = keyUsage(k.id);
            const pct = Math.min(100, Math.round((u.used / u.limit) * 100));
            return (
              <tr key={k.id} className="dash-row border-t border-cream-line/70">
                <td className="px-4 py-2">
                  <span className="block font-medium text-coal">{k.id}</span>
                  <span className="block font-mono text-[0.75rem] text-coal/55">{k.masked}</span>
                </td>
                <td className="px-4 py-2 text-xs font-semibold text-coal/60">{k.scope}</td>
                <td className="px-4 py-2">
                  <span className="font-mono text-[0.8rem] text-coal">{money(u.used)} / {money(u.limit)}</span>
                  <span className="mt-1 block h-1.5 w-32 overflow-hidden rounded-full bg-coal/10">
                    <span className="block h-full rounded-full bg-mint" style={{ width: `${pct}%` }} />
                  </span>
                </td>
                <td className="px-4 py-2 font-mono text-[0.8rem] text-coal/70">{u.lastUsed}</td>
                <td className="px-4 py-2">
                  <span className={`dash-badge inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${k.status === "active" ? "bg-mint/60 text-coal" : "bg-coal/10 text-coal/60"}`}>
                    <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
                    {k.status}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="px-4 pb-3 pt-1 font-mono text-xs text-coal/45">3 keys · budgets capped per key</p>
    </div>
  );
}

function GuardrailsBody() {
  const rows = guardrailRows();
  return (
    <div className="dash-glass-panel mx-3 mb-3 mt-1 overflow-x-auto px-2 py-1.5">
      <table className="w-full min-w-[500px] border-collapse text-left text-sm">
        <thead>
          <tr className="text-xs font-semibold uppercase tracking-wider text-coal/50">
            {["Category", "Mode", "Scope", "Hits 24h"].map((h) => (
              <th key={h} scope="col" className="px-4 py-2 font-semibold">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((g) => (
            <tr key={g.category} className="dash-row border-t border-cream-line/70">
              <td className="px-4 py-[5px] font-mono text-[0.8rem] text-coal">{g.category}</td>
              <td className="px-4 py-[5px] text-xs font-semibold text-coal/60">{g.mode}</td>
              <td className="px-4 py-[5px] text-xs font-semibold text-coal/60">{g.scope}</td>
              <td className="px-4 py-[5px] font-mono text-[0.8rem] text-coal">{g.hits24h}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-4 pb-3 pt-1 font-mono text-xs text-coal/45">10 categories · monitor / warn / block enforcement</p>
    </div>
  );
}

function LogsBody() {
  // Fixed-height window: show the 9 most recent requests; the full 28-row
  // dataset still lives in dashboard.ts and feeds every KPI + the
  // reconcile script — this view is a window onto it, not the store.
  const rows = [...REQUEST_LOGS].reverse().slice(0, 9).reverse();
  return (
    <div className="dash-glass-panel mx-2 mb-2 mt-1 overflow-hidden px-1 py-1.5 md:mx-3 md:mb-3 md:px-2">
      <table className="w-full border-collapse text-left text-xs md:text-sm">
        <thead>
          <tr className="text-xs font-semibold uppercase tracking-wider text-coal/50">
            {[
              { l: "Time", c: "" },
              { l: "Key", c: "" },
              { l: "Model", c: "" },
              { l: "Provider", c: "hidden md:table-cell" },
              { l: "Status", c: "" },
              { l: "Latency", c: "hidden sm:table-cell" },
              { l: "Tokens", c: "hidden sm:table-cell" },
            ].map((h) => (
              <th key={h.l} scope="col" className={`px-2 py-2 font-semibold md:px-3 ${h.c}`}>{h.l}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((l) => (
            <tr key={l.id} className="dash-row border-t border-cream-line/70">
              <td className="px-2 py-1 font-mono text-[0.8rem] text-coal/70 md:px-3 md:py-[7px]">{l.time}</td>
              <td className="max-w-[92px] truncate px-2 py-1 font-mono text-[0.8rem] text-coal md:max-w-none md:px-3 md:py-[7px]">{l.keyId}</td>
              <td className="max-w-[110px] truncate px-2 py-1 font-mono text-[0.8rem] text-coal md:max-w-none md:px-3 md:py-[7px]">{l.model}</td>
              <td className="hidden truncate px-2 py-[7px] text-[0.8rem] font-medium text-coal/70 md:table-cell md:px-3">{PROVIDER_ROWS.find((p) => p.id === l.provider)?.name}</td>
              <td className="px-2 py-1 md:px-3 md:py-[7px]"><StatusPill status={l.status} retryAfterS={l.retryAfterS} /></td>
              <td className="hidden px-2 py-[7px] font-mono text-[0.8rem] text-coal/70 sm:table-cell md:px-3">{l.latencyMs === 0 ? "—" : `${l.latencyMs} ms`}</td>
              <td className="hidden px-2 py-[7px] font-mono text-[0.8rem] text-coal/70 sm:table-cell md:px-3">{l.tokens === 0 ? "—" : l.tokens.toLocaleString("en-US")}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-4 pb-2 pt-1 font-mono text-xs text-coal/45">Latest 9 of {REQUEST_LOGS.length} requests today · full log in the app</p>
    </div>
  );
}

function AnalyticsBody() {
  const spend = spendByProvider();
  const spendMax = Math.max(0.0001, ...spend.map((s) => s.spend));
  const tokens = tokensByModel().slice(0, 5);
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
    <div className="grid gap-4 px-5 py-4 lg:grid-cols-2">
      <div className="dash-glass-panel px-3.5 py-3">
        <p className="text-sm font-semibold text-coal">Spend by provider</p>
        <ul className="mt-1.5 space-y-1.5">
          {spend.map((s) => (
            <li key={s.id} className="flex items-center gap-2 text-sm">
              <span className="w-28 shrink-0 text-[0.8rem] font-medium leading-tight text-coal" title={s.name}>{s.name}</span>
              <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-coal/10">
                <span className="block h-full rounded-full bg-warm" style={{ width: `${Math.max(2, Math.round((s.spend / spendMax) * 100))}%` }} />
              </span>
              <span className="w-14 shrink-0 text-right font-mono text-xs text-coal/55">{money(s.spend)}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="dash-glass-panel px-3.5 py-3">
        <p className="text-sm font-semibold text-coal">Tokens by model · top 5</p>
        <ul className="mt-1.5 space-y-1.5">
          {tokens.map((t) => (
            <li key={t.model} className="flex items-center gap-2 text-sm">
              <span className="w-36 shrink-0 truncate font-mono text-[0.8rem] leading-tight text-coal">{t.model}</span>
              <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-coal/10">
                <span className="block h-full rounded-full bg-peri" style={{ width: `${Math.max(2, Math.round((t.tokens / tokensMax) * 100))}%` }} />
              </span>
              <span className="w-14 shrink-0 text-right font-mono text-xs text-coal/55">{t.tokens >= 1000 ? `${(t.tokens / 1000).toFixed(1)}k` : t.tokens}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="dash-glass-panel px-3.5 py-3 lg:col-span-2">
        <p className="text-sm font-semibold text-coal">Daily cost</p>
        <svg viewBox={`0 0 ${W} ${H}`} className="mt-1 h-20 w-full" role="img" aria-label={`Daily cost line, total ${money(KPIS.spendToday)}`}>
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
  const liveRef = useRef<HTMLSpanElement | null>(null);
  const livePage = useRef<string>(PAGES[0]);
  const [jsReady, setJsReady] = useState(false);
  const reduced = useReducedMotion();

  useEffect(() => {
    setJsReady(true);
  }, []);

  // No-JS gets the complete static list. Reduced-motion with JS gets
  // the same list (ScrollStack below always animates, so it stays out
  // of that path) — identical final content, zero transforms.
  const static_ = !jsReady || reduced;

  /* Active-card mirror: which window sits on top. Slots pin at
     stackTop + i * itemStackDistance (must match the ScrollStack
     props below: 15% / 24px). One rAF-throttled scroll/resize
     listener, refs only — zero re-renders on scroll. Feeds
     data-active-page + the aria-live line. */
  useEffect(() => {
    if (static_) return;
    const region = regionRef.current;
    if (!region) return;
    let raf = 0;
    const read = () => {
      raf = 0;
      const slots = region.querySelectorAll<HTMLElement>("[data-stack-slot]");
      if (!slots.length) return;
      const stackTop = window.innerHeight * 0.15;
      let top = 0;
      slots.forEach((el, i) => {
        if (el.getBoundingClientRect().top <= stackTop + i * 24 + 4) top = i;
      });
      const page = PAGES[Math.min(top, PAGES.length - 1)];
      if (livePage.current !== page) {
        livePage.current = page;
        if (liveRef.current) liveRef.current.textContent = `${page} window on top.`;
      }
      if (region.dataset.activePage !== page) region.dataset.activePage = page;
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(read);
    };
    read();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
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
      data-active-page="Overview"
      className="relative mt-12 scroll-mt-24 md:mt-16"
    >
      {/* Free React Bits ScrollStack drives the stacking (native page
          scroll; smoothScroll stays off so the wheel is never hijacked).
          Tune here: stackPosition pins the pile, itemScale/baseScale +
          dimAmount mirror the old cover tiers (0.975/0.95, veil ~0.1). */}
      <ScrollStack
        useWindowScroll
        stackPosition="15%"
        itemScale={0.025}
        baseScale={0.95}
        dimAmount={0.1}
        holdDistance={400}
        smoothScroll={false}
      >
        {PAGES.map((p) => {
          const Body = BODIES[p];
          return (
            <ScrollStackItem key={p} itemClassName="dash-stack-card">
              <Window page={p} heading={HEADINGS[p]}>
                <Body />
              </Window>
            </ScrollStackItem>
          );
        })}
      </ScrollStack>
      <span ref={liveRef} className="sr-only" aria-live="polite">
        Overview window on top.
      </span>
    </div>
  );
}
