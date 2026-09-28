"use client";

import {
  ArrowRight,
  BookOpen,
  ShieldCheck,
  Lock,
  Boxes,
  CircleCheck,
  Cpu,
} from "lucide-react";
import { GithubIcon } from "./icons";
import { BRAND, DOCS_URL, GET_STARTED_URL, GITHUB_URL } from "@/lib/site";
import {
  FadeUp,
  ScaleIn,
  useCappedMouseParallax,
  usePrefersReducedMotion,
} from "@/lib/motion";

/** CTA-adjacent proof row — the three facts a dev checks first. */
const PROOF_CHIPS = [
  { icon: ShieldCheck, label: "Apache 2.0" },
  { icon: Lock, label: "Self-hosted" },
  { icon: Boxes, label: "Open source" },
] as const;

const TRUST_BADGES = [
  { icon: Boxes, label: "Open Source" },
  { icon: ShieldCheck, label: "Apache 2.0" },
  { icon: Lock, label: "Self Hosted" },
  { icon: Cpu, label: "Developer First" },
  { icon: CircleCheck, label: "No Vendor Lock-In" },
] as const;

/**
 * Interactive architecture visual: inline SVG + SMIL <animateMotion> packets
 * travelling slowly User → ToLLma → providers. No JS runtime, no network —
 * renders in the static export. Durations are deliberately slow (4s+).
 *
 * Depth is layered: grid pattern + radial washes sit behind the nodes,
 * the gateway carries a gradient fill with an outer glow, and each node
 * has a small presence dot (slow SMIL pulse, static when reduced motion).
 */
function ArchitectureVisual({ reduce }: { reduce: boolean }) {
  const packet = (path: string, color: string, dur: string, begin: string) => (
    <circle
      r="4"
      fill={color}
      stroke="#fff"
      strokeWidth="1.5"
      opacity="0.95"
      style={{ filter: `drop-shadow(0 0 6px ${color})` }}
    >
      <animateMotion dur={dur} begin={begin} repeatCount="indefinite" path={path} />
    </circle>
  );

  const presence = (cx: number, cy: number, color: string, begin: string) => (
    <circle cx={cx} cy={cy} r="3.5" fill={color} stroke="#fff" strokeWidth="1">
      {!reduce && (
        <animate attributeName="opacity" values="1;0.35;1" dur="3.2s" begin={begin} repeatCount="indefinite" />
      )}
    </circle>
  );

  return (
    <div
      role="img"
      aria-label="Animated diagram: your app sends one request to the ToLLma gateway, which routes it to OpenAI, Anthropic, Ollama, or your agents"
      className="glass-reflection relative overflow-hidden rounded-2xl border border-white/20 bg-gradient-to-br from-slate-950 via-slate-900 to-blue-950 p-4 shadow-[0_32px_64px_-24px_rgba(37,99,235,0.5)] sm:p-6"
    >
      {/* Interior depth: blueprint grid + radial washes behind the diagram */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="bg-grid-dark absolute inset-0 opacity-60 [mask-image:radial-gradient(28rem_20rem_at_50%_40%,black,transparent_80%)]" />
        <div className="absolute top-[8%] left-1/2 h-44 w-72 -translate-x-1/2 rounded-full bg-blue-500/20 blur-3xl" />
        <div className="absolute right-[4%] bottom-[6%] h-28 w-44 rounded-full bg-emerald-400/10 blur-3xl" />
      </div>
      <svg viewBox="0 0 560 380" className="relative z-[2] h-auto w-full">
        <defs>
          <linearGradient id="tollma-gateway" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3b82f6" />
            <stop offset="100%" stopColor="#1e40af" />
          </linearGradient>
          <linearGradient id="tollma-node" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#24334d" />
            <stop offset="100%" stopColor="#0f172a" />
          </linearGradient>
          <filter id="tollma-glow" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="10" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>

        {/* connectors sit under the nodes */}
        <g aria-hidden>
          <path id="lane-in" d="M 146 190 C 170 190, 185 190, 215 190" fill="none" stroke="#38bdf8" strokeWidth="2" strokeDasharray="6 4" opacity="0.9" />
          <path id="lane-a" d="M 345 150 C 375 150, 385 56, 414 56" fill="none" stroke="#10b981" strokeWidth="2" strokeDasharray="6 4" opacity="0.75" />
          <path id="lane-b" d="M 345 175 C 375 175, 385 146, 414 146" fill="none" stroke="#10b981" strokeWidth="2" strokeDasharray="6 4" opacity="0.75" />
          <path id="lane-c" d="M 345 205 C 375 205, 385 236, 414 236" fill="none" stroke="#eab308" strokeWidth="2" strokeDasharray="6 4" opacity="0.75" />
          <path id="lane-d" d="M 345 230 C 375 230, 385 326, 414 326" fill="none" stroke="#10b981" strokeWidth="2" strokeDasharray="6 4" opacity="0.75" />
        </g>

        {/* client node */}
        <g>
          <rect x="16" y="150" width="130" height="80" rx="12" fill="url(#tollma-node)" stroke="#38bdf8" strokeWidth="1.5" />
          {presence(30, 164, "#38bdf8", "0s")}
          <text x="81" y="182" textAnchor="middle" fill="#e2e8f0" fontSize="13" fontWeight="700">
            Your App
          </text>
          <text x="81" y="201" textAnchor="middle" fill="#94a3b8" fontSize="11">
            1 endpoint
          </text>
          <text x="81" y="216" textAnchor="middle" fill="#38bdf8" fontSize="10" fontFamily="monospace">
            /v1/chat
          </text>
        </g>

        {/* gateway node */}
        <g>
          <rect x="215" y="110" width="130" height="160" rx="14" fill="#2563eb" opacity="0.35" filter="url(#tollma-glow)" aria-hidden />
          <rect x="215" y="110" width="130" height="160" rx="14" fill="url(#tollma-gateway)" stroke="#93c5fd" strokeWidth="2" />
          <rect x="227" y="114" width="106" height="1.5" rx="0.75" fill="#ffffff" opacity="0.35" aria-hidden />
          {presence(331, 124, "#4ade80", "0.8s")}
          <text x="280" y="148" textAnchor="middle" fill="#ffffff" fontSize="16" fontWeight="800">
            ToLLma
          </text>
          <text x="280" y="168" textAnchor="middle" fill="#bfdbfe" fontSize="11">
            AI Gateway
          </text>
          {["auth + keys", "routing", "budgets", "logs"].map((t, i) => (
            <g key={t}>
              <rect x="229" y={182 + i * 20} width="102" height="15" rx="7.5" fill="#1d4ed8" stroke="#60a5fa" strokeOpacity="0.4" />
              <text x="280" y={193.5 + i * 20} textAnchor="middle" fill="#dbeafe" fontSize="9.5">
                {t}
              </text>
            </g>
          ))}
        </g>

        {/* provider nodes */}
        {[
          { y: 30, name: "OpenAI", sub: "cloud", dot: "#4ade80", begin: "0.2s" },
          { y: 120, name: "Anthropic", sub: "cloud", dot: "#4ade80", begin: "1.1s" },
          { y: 210, name: "Ollama", sub: "local", dot: "#facc15", begin: "2s" },
          { y: 300, name: "Agents", sub: "tools + RAG", dot: "#4ade80", begin: "2.7s" },
        ].map((p) => (
          <g key={p.name}>
            <rect x="414" y={p.y} width="130" height="52" rx="10" fill="#0f172a" stroke="#10b981" strokeWidth="1.5" />
            <rect x="414" y={p.y} width="3.5" height="52" rx="1.75" fill="#10b981" opacity="0.8" aria-hidden />
            {presence(530, p.y + 13, p.dot, p.begin)}
            <text x="476" y={p.y + 22} textAnchor="middle" fill="#e2e8f0" fontSize="12" fontWeight="700">
              {p.name}
            </text>
            <text x="476" y={p.y + 38} textAnchor="middle" fill="#6ee7b7" fontSize="10">
              {p.sub}
            </text>
          </g>
        ))}

        {/* travelling packets (slow, subtle; omitted for reduced motion —
            SMIL <animateMotion> cannot be paused from CSS) */}
        {!reduce && (
          <>
            {packet("M 146 190 C 170 190, 185 190, 215 190", "#38bdf8", "4.2s", "0s")}
            {packet("M 146 190 C 170 190, 185 190, 215 190", "#38bdf8", "4.2s", "2.1s")}
            {packet("M 345 150 C 375 150, 385 56, 414 56", "#10b981", "4.8s", "0.4s")}
            {packet("M 345 175 C 375 175, 385 146, 414 146", "#10b981", "4.8s", "2.6s")}
            {packet("M 345 205 C 375 205, 385 236, 414 236", "#eab308", "4.8s", "1.5s")}
            {packet("M 345 230 C 375 230, 385 326, 414 326", "#10b981", "4.8s", "3.4s")}
          </>
        )}
      </svg>
      <div className="relative z-[2] mt-2 flex items-center justify-between rounded-lg bg-white/5 px-3 py-2 font-mono text-[11px] text-emerald-300 sm:text-xs">
        <span className="truncate">POST /v1/chat/completions → 200 OK · 412 ms</span>
        <span className="ml-2 hidden shrink-0 rounded bg-emerald-500/20 px-2 py-0.5 text-emerald-300 sm:inline">
          live routing
        </span>
      </div>
    </div>
  );
}

export default function Hero() {
  const reduce = usePrefersReducedMotion();
  const parallax = useCappedMouseParallax<HTMLElement>();

  return (
    <section
      id="top"
      aria-label="Introduction"
      onMouseMove={reduce ? undefined : parallax.onMouseMove}
      onMouseLeave={reduce ? undefined : parallax.onMouseLeave}
      className="noise-overlay relative overflow-hidden bg-white"
    >
      {/* Layered depth: base wash + grid + glows + bottom fade into page */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div
          className="absolute inset-0 bg-[radial-gradient(56rem_30rem_at_50%_-8rem,rgba(37,99,235,0.14),transparent),radial-gradient(36rem_22rem_at_85%_30%,rgba(16,185,129,0.08),transparent),radial-gradient(30rem_20rem_at_10%_60%,rgba(234,179,8,0.06),transparent)]"
          style={parallax.layer("background")}
        />
        <div className="bg-grid absolute inset-0 [mask-image:radial-gradient(60rem_36rem_at_50%_0%,black,transparent_75%)]" />
        <div
          className="animate-glow-drift absolute -top-24 left-1/4 h-72 w-72 rounded-full bg-blue-500/20 blur-3xl"
          style={reduce ? undefined : parallax.layer("glow")}
        />
        <div className="absolute top-40 right-[8%] hidden h-56 w-56 rounded-full bg-emerald-400/15 blur-3xl lg:block" />
        <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-b from-transparent to-slate-50/80" />
      </div>

      <div className="container-x relative z-[2] grid items-center gap-10 pt-14 pb-10 sm:pt-20 lg:grid-cols-[1.05fr_1fr] lg:gap-14">
        {/* Copy column */}
        <div className="min-w-0">
          <FadeUp>
            <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-brand-dark">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
              {BRAND.positioning}
            </p>
          </FadeUp>
          <FadeUp delay={0.05}>
            <h1 className="max-w-xl text-3xl font-extrabold tracking-tight text-balance text-ink sm:text-5xl sm:leading-[1.08]">
              {BRAND.headline}
            </h1>
          </FadeUp>
          <FadeUp delay={0.1}>
            <p className="mt-5 max-w-xl text-base text-muted text-balance sm:text-lg">
              ToLLma puts one OpenAI-compatible gateway in front of every model —
              cloud APIs, local Ollama, and your own agents — with unified keys,
              budgets, logging, and a knowledge repository. Self-host it in
              minutes. Apache 2.0 licensed, yours forever.
            </p>
          </FadeUp>
          {/* CTA hierarchy (DESIGN_REPORT §6): one dominant filled primary,
              one outline secondary, GitHub demoted to a tertiary ghost link. */}
          <FadeUp delay={0.15}>
            <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
              <span className="relative inline-flex">
                <span
                  aria-hidden
                  className="animate-cta-glow absolute -inset-1 rounded-2xl bg-gradient-to-r from-blue-600/30 via-blue-500/20 to-emerald-500/20 blur-lg"
                />
                <a
                  href={GET_STARTED_URL}
                  className="relative inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-brand px-6 py-3 text-sm font-bold text-white shadow-lg shadow-blue-600/25 transition hover:bg-brand-dark"
                >
                  Get Started <ArrowRight className="h-4 w-4" aria-hidden />
                </a>
              </span>
              <a
                href={DOCS_URL}
                className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
              >
                <BookOpen className="h-4 w-4" aria-hidden /> Docs
              </a>
              <a
                href={GITHUB_URL}
                className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
              >
                <GithubIcon className="h-4 w-4" aria-hidden /> Star on GitHub
              </a>
            </div>
          </FadeUp>
          <FadeUp delay={0.2}>
            <div className="mt-6 flex flex-wrap items-center gap-2 text-xs font-medium text-slate-600">
              {PROOF_CHIPS.map((b) => (
                <span
                  key={b.label}
                  className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1"
                >
                  <b.icon className="h-3 w-3 text-emerald-700" aria-hidden /> {b.label}
                </span>
              ))}
              <span className="text-slate-400">· Docker deploy · OpenAI-compatible API</span>
            </div>
          </FadeUp>
        </div>

        {/* Interactive architecture column */}
        <ScaleIn
          delay={0.15}
          className="relative min-w-0"
          style={reduce ? undefined : parallax.layer("card")}
        >
          <div
            aria-hidden
            className="absolute -inset-6 rounded-[2rem] bg-gradient-to-br from-blue-500/15 via-emerald-400/10 to-amber-300/10 blur-2xl"
          />
          <div className="relative">
            <ArchitectureVisual reduce={reduce} />
            {/* Restrained floats: desktop-only, compact, single-line each */}
            <div className="absolute -top-3 right-0 hidden rounded-xl border border-slate-200 bg-white/95 px-3 py-1.5 shadow-md backdrop-blur lg:block">
              <p className="flex items-center gap-1.5 font-mono text-[11px] font-bold text-emerald-700">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />
                200 OK · 412 ms
              </p>
            </div>
            <div className="absolute -bottom-3 left-0 hidden rounded-xl border border-slate-200 bg-white/95 px-3 py-1.5 shadow-md backdrop-blur lg:block">
              <p className="font-mono text-[11px] font-bold text-ink">
                $18.42 <span className="font-normal text-slate-500">/ $50 budget</span>
              </p>
            </div>
          </div>
        </ScaleIn>
      </div>

      {/* Trust bar */}
      <div className="container-x relative z-[2] pb-12">
        <FadeUp>
          <ul
            aria-label="Project guarantees"
            className="flex flex-wrap items-center justify-center gap-2 sm:gap-3"
          >
            {TRUST_BADGES.map((b) => (
              <li key={b.label}>
                <span className="trust-badge inline-flex cursor-default items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-bold text-slate-700 shadow-sm">
                  <b.icon className="h-3.5 w-3.5 text-brand" aria-hidden />
                  {b.label}
                </span>
              </li>
            ))}
          </ul>
        </FadeUp>
      </div>
    </section>
  );
}
