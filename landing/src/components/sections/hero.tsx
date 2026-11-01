"use client";

// Centered Nominal-style hero: license pill, solid-ink serif headline,
// exact product sub-copy, black primary CTA. Six sharp pastel pills float
// absolutely around the copy with blurred ghost pills behind (same hues,
// out of focus). Single scrolling unit — NO parallax: everything moves 1:1
// with the page. Below: Request Activity dashboard card (provider rows from
// site.ts). SSR/no-JS renders the terminal states (Allowed rows, full bars);
// JS re-arms the scroll-linked enhancement (bars fill on scroll-into-view,
// status pills flip row-by-row from Pending to terminal) on mount.
import { useEffect, useRef, useState } from "react";
import { Container } from "@/components/ui/layout";
import { BlackButton } from "@/components/ui/primitives";
import { BRAND, GET_STARTED_URL, PROVIDERS } from "@/lib/site";
import { useInViewOnce, useReducedMotion } from "@/lib/animations";

type Pill = { label: string; bg: string; pos: string; glyph: string; dur: string; delay: string };

const PILLS: Pill[] = [
  { label: "Multi-provider", bg: "#72ddb1", pos: "left-[4%] top-[4%]", glyph: "\u25C8", dur: "6.5s", delay: "0s" },
  { label: "Usage & cost", bg: "#e8b1a2", pos: "right-[4%] top-[8%]", glyph: "\u25CF", dur: "7.5s", delay: "-2s" },
  { label: "Guardrails", bg: "#f5e6a3", pos: "left-[7%] top-[32%]", glyph: "\u25C6", dur: "6s", delay: "-1s" },
  { label: "API keys", bg: "#a9bdf4", pos: "right-[7%] top-[30%]", glyph: "\u25A0", dur: "8s", delay: "-3.5s" },
  { label: "Request logs", bg: "#dde8d0", pos: "left-[5%] top-[52%]", glyph: "\u2261", dur: "7s", delay: "-4s" },
  { label: "Streaming", bg: "#72ddb1", pos: "right-[10%] bottom-[16%]", glyph: "\u25B2", dur: "6.8s", delay: "-1.8s" },
];

/* Blurred ghosts: same hues, out of focus, offset from the sharp pills. */
const GHOSTS: { label: string; bg: string; pos: string }[] = [
  { label: "", bg: "#72ddb1", pos: "left-[16%] top-[14%]" },
  { label: "", bg: "#e8b1a2", pos: "right-[15%] top-[22%]" },
  { label: "", bg: "#f5e6a3", pos: "left-[2%] top-[44%]" },
  { label: "", bg: "#a9bdf4", pos: "right-[2%] top-[44%]" },
  { label: "", bg: "#dde8d0", pos: "left-[20%] bottom-[10%]" },
  { label: "", bg: "#72ddb1", pos: "right-[22%] bottom-[6%]" },
];

function HeroPills() {
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true">
      {GHOSTS.map((g, i) => (
        <span
          key={`g-${i}`}
          className={`absolute hidden h-9 w-36 rounded-full opacity-50 blur-md min-[900px]:block ${g.pos}`}
          style={{ backgroundColor: g.bg }}
        />
      ))}
      {PILLS.map((p) => (
        <div key={p.label} className={`absolute hidden min-[900px]:block ${p.pos}`}>
          <span
            className="pill-float flex items-center gap-2 rounded-full border border-coal/10 py-1.5 pl-1.5 pr-4 text-[0.8rem] font-semibold text-coal shadow-[0_10px_28px_-10px_rgba(23,25,20,0.35)]"
            style={{ backgroundColor: p.bg, animationDuration: p.dur, animationDelay: p.delay }}
          >
            <span
              className="flex size-6 items-center justify-center rounded-[7px] border border-coal/10 bg-white/55 text-[11px] leading-none text-coal"
              aria-hidden="true"
            >
              {p.glyph}
            </span>
            {p.label}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ---------- dashboard ---------- */

const TERMINAL: { status: string; cls: string; policy: string }[] = [
  { status: "Allowed", cls: "bg-mint/60 text-coal", policy: "monitor" },
  { status: "Allowed", cls: "bg-mint/60 text-coal", policy: "monitor" },
  { status: "Allowed", cls: "bg-mint/60 text-coal", policy: "monitor" },
  { status: "Allowed", cls: "bg-mint/60 text-coal", policy: "monitor" },
  { status: "Blocked", cls: "bg-warm text-coal", policy: "block" },
  { status: "Allowed", cls: "bg-mint/60 text-coal", policy: "monitor" },
];

function StatusFlip({ index, progress, terminal }: { index: number; progress: number; terminal: (typeof TERMINAL)[number] }) {
  // Each row flips inside its own scroll window: [start, start+0.08].
  const start = 0.12 + index * 0.11;
  const t = Math.min(1, Math.max(0, (progress - start) / 0.08));
  return (
    <span className="flip-pill inline-flex">
      <span className="flip-inner" style={{ transform: `rotateX(${(t * 180).toFixed(1)}deg)` }}>
        <span className="flip-face items-center gap-1.5 rounded-full bg-coal/10 px-2.5 py-0.5 text-xs font-semibold text-coal/60">
          <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
          Pending
        </span>
        <span className={`flip-face flip-back items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${terminal.cls}`}>
          <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
          {terminal.status}
        </span>
      </span>
    </span>
  );
}

const SIDEBAR = ["Overview", "Providers", "API Keys", "Guardrails", "Request Logs", "Analytics"];

function DashboardCard() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [progress, setProgress] = useState(1);
  const [barsRef, barsSeen] = useInViewOnce<HTMLDivElement>(0.4);
  const [jsReady, setJsReady] = useState(false);
  const reduced = useReducedMotion();

  useEffect(() => {
    setJsReady(true);
  }, []);

  useEffect(() => {
    if (reduced) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const el = wrapRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const vh = window.innerHeight || 1;
      const p = Math.min(1, Math.max(0, (vh * 0.85 - rect.top) / (vh * 0.9)));
      setProgress((prev) => (Math.abs(prev - p) < 0.002 ? prev : p));
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
  }, [reduced ]);

  const rows = PROVIDERS.map((p, i) => ({
    endpoint: p.endpoints[0],
    provider: p.id === "custom" ? "Custom" : p.name,
    terminal: TERMINAL[i % TERMINAL.length],
  }));

  return (
    <div ref={wrapRef} className="mx-auto mt-14 max-w-6xl">
      <div
        id="activity"
        className="scroll-mt-24 overflow-hidden rounded-2xl border border-cream-line bg-white shadow-[0_40px_90px_-28px_rgba(23,25,20,0.35),0_12px_28px_-16px_rgba(23,25,20,0.22)]"
      >
        {/* macOS window chrome: traffic lights + centered title, hairline divider below. */}
        <div className="relative flex items-center border-b border-cream-line/80 px-5 py-3">
          <div className="flex items-center gap-2" aria-hidden="true">
            <span className="size-3 rounded-full" style={{ backgroundColor: "#FF5F57" }} />
            <span className="size-3 rounded-full" style={{ backgroundColor: "#FEBC2E" }} />
            <span className="size-3 rounded-full" style={{ backgroundColor: "#28C840" }} />
          </div>
          <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-[0.83rem] font-medium text-coal/70">
            ToLLma &mdash; Request Activity
          </p>
        </div>
        <div className="flex items-center justify-between gap-4 border-b border-cream-line px-6 py-4">
          <p className="font-serif text-lg text-coal">Request Activity</p>
          <p className="rounded-full bg-cream px-2.5 py-0.5 text-xs font-medium text-coal/55">
            Sample data for illustration
          </p>
        </div>
        <div className="grid md:grid-cols-[180px_minmax(0,1fr)]">
          <ul aria-label="Gateway sections" className="hidden border-r border-cream-line py-4 md:block">
            {SIDEBAR.map((s, i) => (
              <li
                key={s}
                className={`border-l-2 px-5 py-2 text-sm ${i === 4 ? "border-coal font-semibold text-coal" : "border-transparent text-coal/55"}`}
                aria-current={i === 4 ? "page" : undefined}
              >
                {s}
              </li>
            ))}
          </ul>
          <div className="min-w-0">
            <div ref={barsRef} className="grid gap-6 border-b border-cream-line px-6 py-5 sm:grid-cols-2">
              <div>
                <p className="text-sm font-semibold text-coal">
                  100% <span className="font-normal text-coal/55">Routed</span>
                </p>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-coal/10" role="img" aria-label="Routed requests: full">
                  <div
                    className="h-full w-full origin-left rounded-full bg-mint transition-transform duration-1000 ease-out"
                    style={{ transform: `scaleX(${!jsReady || barsSeen || reduced ? 1 : 0})` }}
                  />
                </div>
                <p className="mt-2 font-mono text-xs text-coal/55">{PROVIDERS.length}/{PROVIDERS.length} adapters · monitor or block</p>
              </div>
              <div>
                <p className="text-sm font-semibold text-coal">
                  0% <span className="font-normal text-coal/55">Blocked</span>
                </p>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-coal/10" role="img" aria-label="Blocked requests: none in this sample">
                  <div
                    className="h-full w-full origin-left rounded-full bg-warm"
                    style={{ transform: "scaleX(0)" }}
                  />
                </div>
                <p className="mt-2 font-mono text-xs text-coal/55">policy checks pass before spend</p>
              </div>
            </div>
            <div className="overflow-x-auto px-2 py-2">
              <table className="w-full min-w-[640px] border-collapse text-left text-sm">
                <thead>
                  <tr className="text-xs font-semibold uppercase tracking-wider text-coal/50">
                    {["Status", "Request", "Provider", "Policy"].map((h) => (
                      <th key={h} scope="col" className="px-4 py-2.5 font-semibold">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={`${r.provider}-${r.endpoint}`} className="border-t border-cream-line/70">
                      <td className="px-4 py-2.5">
                        {reduced ? (
                          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${r.terminal.cls}`}>
                            <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
                            {r.terminal.status}
                          </span>
                        ) : (
                          <StatusFlip index={i} progress={progress} terminal={r.terminal} />
                        )}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-[0.8rem] text-coal">POST {r.endpoint}</td>
                      <td className="px-4 py-2.5 font-medium text-coal">{r.provider}</td>
                      <td className="px-4 py-2.5">
                        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-coal/60">
                          <span className={`size-1.5 rounded-full ${r.terminal.policy === "block" ? "bg-warm" : "bg-mint"}`} aria-hidden="true" />
                          {r.terminal.policy}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Hero() {
  return (
    <section className="relative overflow-hidden bg-cream">
      <HeroPills />
      <Container width="wide" className="relative pb-20 pt-16 text-center md:pt-24">
        <p className="inline-flex items-center gap-2.5 rounded-full border border-cream-line bg-white px-4 py-1.5 text-sm font-medium text-coal">
          <span className="font-bold" aria-hidden="true">
            ✳
          </span>
          <span>Open source · {BRAND.license}</span>
        </p>

        <h1
          className="mx-auto mt-7 max-w-4xl text-balance font-serif font-medium tracking-tight text-coal"
          style={{ fontSize: "clamp(2.6rem, 6vw, 4.75rem)", lineHeight: 1.05 }}
        >
          {BRAND.headline}.
        </h1>

        <p className="mx-auto mt-6 max-w-2xl text-pretty text-[1.1rem] leading-relaxed text-coal/70">
          Connect your applications to multiple AI providers through one unified gateway. Manage credentials, models, usage, and policies from a single control plane.
        </p>

        <div className="mt-9 flex flex-wrap items-center justify-center gap-4">
          <BlackButton href={GET_STARTED_URL} ariaLabel="Get started with ToLLma">
            Get Started <span aria-hidden="true">→</span>
          </BlackButton>
        </div>

        <DashboardCard />
      </Container>
    </section>
  );
}
