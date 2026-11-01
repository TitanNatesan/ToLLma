"use client";

// Centered Nominal-style hero: license pill, solid-ink serif headline,
// exact product sub-copy, black primary CTA. Six glass pills float around
// the copy (parallax layers + idle float), each with a one-line site.ts-
// derived context tooltip. Below: Request Activity dashboard card —
// pointer-tilt (max 6°, fine pointers) + cursor glare + scroll flatten
// (rotateX 14°→0 at viewport middle, slight lift on exit).
// Dotted grid at 0.08 + radial glow at 0.2 behind everything.
// Hero copy fades/drifts over the first 60vh. SSR/no-JS renders terminal
// states; JS arms motion only when allowed — reduced-motion shows finals.
import { useEffect, useRef, useState } from "react";
import { Container } from "@/components/ui/layout";
import { BlackButton } from "@/components/ui/primitives";
import { SpotlightCard } from "@/components/ui/spotlight-card";
import { Parallax } from "@/components/ui/parallax";
import {
  animate,
  stagger,
  useInViewOnce,
  useInViewToggle,
  useReducedMotion,
  usePointerTilt,
  utils,
} from "@/lib/animations";
import { prefersReducedMotion } from "@/lib/animations/motion-preference";
import {
  BRAND,
  GATEWAY_BASE,
  GET_STARTED_URL,
  GUARDRAIL_CATEGORIES,
  POLICY_SCOPE,
  PROVIDERS,
} from "@/lib/site";

type Pill = {
  label: string;
  bg: string;
  pos: string;
  dur: string;
  delay: string;
  speed: number;
  tip: string;
};

const STREAMING_COUNT = PROVIDERS.filter((p) => p.streaming).length;
const SCOPES = POLICY_SCOPE.map((s) => (s === "api_key" ? "per-key" : s)).join(" or ");

const PILLS: Pill[] = [
  { label: "Multi-provider", bg: "#72ddb1", pos: "left-[4%] top-[4%]", dur: "6.5s", delay: "0s", speed: 0.55, tip: `${PROVIDERS.length} adapters · one endpoint` },
  { label: "Usage & cost", bg: "#e8b1a2", pos: "right-[4%] top-[8%]", dur: "7.5s", delay: "-2s", speed: 0.4, tip: "Usage & cost tracked per key" },
  { label: "Guardrails", bg: "#f5e6a3", pos: "left-[7%] top-[32%]", dur: "6s", delay: "-1s", speed: 0.25, tip: `Guardrails: ${GUARDRAIL_CATEGORIES.length} categories active` },
  { label: "API keys", bg: "#a9bdf4", pos: "right-[7%] top-[30%]", dur: "8s", delay: "-3.5s", speed: -0.15, tip: `Keys carry ${SCOPES} scope` },
  { label: "Request logs", bg: "#dde8d0", pos: "left-[5%] top-[52%]", dur: "7s", delay: "-4s", speed: 0.4, tip: "Every request leaves a trail" },
  { label: "Streaming", bg: "#72ddb1", pos: "right-[10%] bottom-[16%]", dur: "6.8s", delay: "-1.8s", speed: 0.25, tip: `Streaming on ${STREAMING_COUNT}/${PROVIDERS.length} adapters` },
];

/* Blurred ghosts: same hues, out of focus, offset from the sharp pills. */
const GHOSTS: { bg: string; pos: string }[] = [
  { bg: "#72ddb1", pos: "left-[16%] top-[14%]" },
  { bg: "#e8b1a2", pos: "right-[15%] top-[22%]" },
  { bg: "#f5e6a3", pos: "left-[2%] top-[44%]" },
  { bg: "#a9bdf4", pos: "right-[2%] top-[44%]" },
  { bg: "#dde8d0", pos: "left-[20%] bottom-[10%]" },
  { bg: "#72ddb1", pos: "right-[22%] bottom-[6%]" },
];

/* Dotted grid (0.08) + radial glow (0.2): token colors only, opacity layers. */
function HeroBackdrop() {
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true">
      <div className="hero-dots absolute inset-0" />
      <Parallax speed={0.1} className="absolute inset-0">
        <div className="hero-glow absolute inset-0" />
      </Parallax>
    </div>
  );
}

function HeroPills() {
  const [ref, playing] = useInViewToggle<HTMLDivElement>(0);
  return (
    <div
      ref={ref}
      data-playing={playing}
      className="hero-pills pointer-events-none absolute inset-0 z-10"
      aria-hidden="true"
    >
      {GHOSTS.map((g, i) => (
        <span
          key={`g-${i}`}
          className={`absolute hidden h-9 w-36 rounded-full opacity-50 blur-md min-[1024px]:block ${g.pos}`}
          style={{ backgroundColor: g.bg }}
        />
      ))}
      {PILLS.map((p) => (
        <Parallax
          key={p.label}
          speed={p.speed}
          className={`absolute hidden min-[1024px]:block ${p.pos}`}
        >
          <span className="hero-chipgroup pointer-events-auto">
            <SpotlightCard className="rounded-full">
              <span
                className="hero-chip pill-float flex items-center rounded-full px-4 py-1.5 text-[0.8rem] font-semibold text-coal"
                style={{ "--chip-bg": p.bg, animationDuration: p.dur, animationDelay: p.delay } as React.CSSProperties}
              >
                {p.label}
              </span>
            </SpotlightCard>
            <span className="hero-tip" aria-hidden="true">
              {p.tip}
            </span>
          </span>
        </Parallax>
      ))}
    </div>
  );
}

/* Word-by-word headline rise on load (60ms stagger). Single h1 kept for
   a11y (aria-label carries the full line); word spans are presentational. */
function HeroHeadline() {
  const ref = useRef<HTMLHeadingElement | null>(null);
  const words = BRAND.headline.split(" ");

  useEffect(() => {
    const el = ref.current;
    if (!el || prefersReducedMotion()) return;
    const items = Array.from(el.querySelectorAll<HTMLElement>(".hw-word"));
    if (!items.length) return;
    utils.set(items, { y: "112%" });
    const a = animate(items, {
      y: ["112%", "0%"],
      duration: 850,
      delay: stagger(60, { start: 120 }),
      ease: "outExpo",
    });
    return () => {
      a.revert();
    };
  }, []);

  return (
    <h1
      ref={ref}
      aria-label={`${BRAND.headline}.`}
      className="mx-auto mt-7 w-full max-w-4xl text-balance text-center font-serif font-medium tracking-tight text-coal"
      style={{ fontSize: "clamp(2.6rem, 6vw, 4.75rem)", lineHeight: 1.05, textWrap: "balance" }}
    >
      {words.map((w, i) => (
        <span key={i} aria-hidden="true" className="hw-mask">
          <span className="hw-word">{w}</span>
          {i === words.length - 1 ? "." : "\u00A0"}
        </span>
      ))}
    </h1>
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
  const flatRef = useRef<HTMLDivElement | null>(null);
  const tiltRef = usePointerTilt<HTMLDivElement>(6);
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
  }, [reduced]);

  /* Scroll flatten: rotateX 14°→0 as the card reaches viewport middle,
     slight lift as it exits upward. Transform-only, rAF, no re-render. */
  useEffect(() => {
    const el = flatRef.current;
    if (!el || prefersReducedMotion()) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const rect = el.getBoundingClientRect();
      const vh = window.innerHeight || 1;
      const center = rect.top + rect.height / 2;
      const t = Math.min(1, Math.max(0, (center - vh * 0.5) / (vh * 0.5)));
      const lift = -Math.min(10, Math.max(0, (vh * 0.5 - center) * 0.03));
      el.style.transform = `perspective(1200px) rotateX(${(t * 14).toFixed(2)}deg) translate3d(0, ${lift.toFixed(2)}px, 0)`;
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

  const rows = PROVIDERS.map((p, i) => ({
    endpoint: p.endpoints[0],
    provider: p.id === "custom" ? "Custom" : p.name,
    terminal: TERMINAL[i % TERMINAL.length],
  }));

  return (
    <div ref={wrapRef} className="mx-auto mt-14 max-w-6xl">
      <div ref={flatRef} style={{ transform: "perspective(1200px) rotateX(0deg)" }}>
        <div ref={tiltRef}>
          <div>
            <SpotlightCard className="rounded-2xl">
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
                            <tr key={`${r.provider}-${r.endpoint}`} className="dash-row border-t border-cream-line/70">
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
                              <td className="px-4 py-2.5 font-mono text-[0.8rem] text-coal">
                                <span title={`POST ${GATEWAY_BASE}${r.endpoint} — full route`}>POST {r.endpoint}</span>
                              </td>
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
            </SpotlightCard>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Hero() {
  const driftRef = useRef<HTMLDivElement | null>(null);

  /* Hero copy fades + drifts over the first 60vh of scroll. */
  useEffect(() => {
    const el = driftRef.current;
    if (!el || prefersReducedMotion()) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const vh = window.innerHeight || 1;
      const t = Math.min(1, Math.max(0, window.scrollY / (vh * 0.6)));
      el.style.opacity = `${(1 - t * 0.9).toFixed(3)}`;
      el.style.transform = `translate3d(0, ${(t * 56).toFixed(2)}px, 0)`;
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
      el.style.opacity = "";
      el.style.transform = "";
    };
  }, []);

  return (
    <section className="relative overflow-hidden bg-cream">
      <HeroBackdrop />
      <HeroPills />
      <Container width="wide" className="relative pb-20 pt-16 md:pt-24">
        <div ref={driftRef} className="flex w-full flex-col items-center text-center">
          <p className="mx-auto inline-flex w-fit items-center justify-center gap-2.5 rounded-full border border-cream-line bg-white px-4 py-1.5 text-center text-sm font-medium text-coal">
            <span className="font-bold" aria-hidden="true">
              ✳
            </span>
            <span>Open source · {BRAND.license}</span>
          </p>

          <HeroHeadline />

          <p className="mx-auto mt-6 w-full max-w-2xl text-center text-pretty text-[1.1rem] leading-relaxed text-coal/70">
            Connect your applications to multiple AI providers through one unified gateway. Manage credentials, models, usage, and policies from a single control plane.
          </p>

          <div className="mt-9 flex w-full flex-wrap items-center justify-center gap-4">
            <BlackButton href={GET_STARTED_URL} ariaLabel="Get started with ToLLma">
              Get Started <span aria-hidden="true">→</span>
            </BlackButton>
          </div>
        </div>

        <DashboardCard />
      </Container>
      <style>{`
        .hero-dots {
          background-image: radial-gradient(circle, var(--color-coal) 1px, transparent 1.4px);
          background-size: 26px 26px;
          opacity: 0.08;
        }
        .hero-glow {
          background: radial-gradient(52% 42% at 50% 30%, var(--color-mint), transparent 70%);
          opacity: 0.2;
        }
        .hw-mask { display: inline-block; overflow: hidden; vertical-align: bottom; padding-bottom: 0.08em; margin-bottom: -0.08em; }
        .hw-word { display: inline-block; will-change: transform; }
        .hero-chip {
          background-color: color-mix(in srgb, var(--chip-bg) 38%, rgba(255, 255, 255, 0.72));
          -webkit-backdrop-filter: blur(14px) saturate(160%);
          backdrop-filter: blur(14px) saturate(160%);
          border: 1px solid rgba(255, 255, 255, 0.65);
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.7), 0 12px 32px -12px rgba(23, 25, 20, 0.25);
          border-radius: 999px;
          transition: transform 250ms var(--ease-out-expo);
        }
        @supports not ((backdrop-filter: blur(14px)) or (-webkit-backdrop-filter: blur(14px))) {
          .hero-chip { background-color: color-mix(in srgb, var(--chip-bg) 72%, white); }
        }
        .hero-chipgroup { position: relative; display: inline-block; border-radius: 999px; transition: transform 250ms var(--ease-out-expo); }
        .hero-chipgroup:hover, .hero-chipgroup:focus-visible { transform: translateY(-3px); }
        .hero-tip {
          position: absolute; left: 50%; top: calc(100% + 8px);
          transform: translate(-50%, 4px); white-space: nowrap;
          background: var(--color-coal); color: var(--color-cream);
          font-size: 0.75rem; font-weight: 500; line-height: 1;
          padding: 7px 10px; border-radius: 8px;
          opacity: 0; pointer-events: none;
          transition: opacity 200ms ease, transform 200ms var(--ease-out-expo);
        }
        .hero-chipgroup:hover .hero-tip, .hero-chipgroup:focus-visible .hero-tip { opacity: 1; transform: translate(-50%, 0); }
        .dash-row { transition: background-color 180ms ease; }
        .dash-row:hover { background-color: color-mix(in srgb, var(--color-mint) 16%, transparent); }
        @media (prefers-reduced-motion: reduce) {
          .hero-tip { display: none; }
        }
      `}</style>
    </section>
  );
}
