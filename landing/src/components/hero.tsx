"use client";

import {
  ArrowRight,
  BookOpen,
  FileCode2,
  ShieldCheck,
  Lock,
  Boxes,
  CircleCheck,
  Cpu,
} from "lucide-react";
import { GithubIcon } from "./icons";
import { BRAND, DOCS_URL, GET_STARTED_URL, GITHUB_URL } from "@/lib/site";
import { useCappedMouseParallax, usePrefersReducedMotion } from "@/lib/motion";

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
 */
function ArchitectureVisual({ reduce }: { reduce: boolean }) {
  const packet = (path: string, color: string, dur: string, begin: string) => (
    <circle r="4" fill={color} stroke="#fff" strokeWidth="1.5">
      <animateMotion dur={dur} begin={begin} repeatCount="indefinite" path={path} />
    </circle>
  );

  return (
    <div
      role="img"
      aria-label="Animated diagram: your app sends one request to the ToLLma gateway, which routes it to OpenAI, Anthropic, Ollama, or your agents"
      className="glass-reflection relative overflow-hidden rounded-2xl border border-white/20 bg-gradient-to-br from-slate-950 via-slate-900 to-blue-950 p-4 shadow-[0_32px_64px_-24px_rgba(37,99,235,0.5)] sm:p-6"
    >
      <svg viewBox="0 0 560 380" className="relative z-[2] h-auto w-full">
        {/* client node */}
        <g>
          <rect x="16" y="150" width="130" height="80" rx="12" fill="#1e293b" stroke="#38bdf8" strokeWidth="1.5" />
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
          <rect x="215" y="110" width="130" height="160" rx="14" fill="#2563eb" stroke="#93c5fd" strokeWidth="2" />
          <text x="280" y="148" textAnchor="middle" fill="#ffffff" fontSize="16" fontWeight="800">
            ToLLma
          </text>
          <text x="280" y="168" textAnchor="middle" fill="#bfdbfe" fontSize="11">
            AI Gateway
          </text>
          {["auth + keys", "routing", "budgets", "logs"].map((t, i) => (
            <g key={t}>
              <rect x="229" y={182 + i * 20} width="102" height="15" rx="7.5" fill="#1d4ed8" />
              <text x="280" y={193.5 + i * 20} textAnchor="middle" fill="#dbeafe" fontSize="9.5">
                {t}
              </text>
            </g>
          ))}
        </g>

        {/* provider nodes */}
        {[
          { y: 30, name: "OpenAI", sub: "cloud" },
          { y: 120, name: "Anthropic", sub: "cloud" },
          { y: 210, name: "Ollama", sub: "local" },
          { y: 300, name: "Agents", sub: "tools + RAG" },
        ].map((p) => (
          <g key={p.name}>
            <rect x="414" y={p.y} width="130" height="52" rx="10" fill="#0f172a" stroke="#10b981" strokeWidth="1.5" />
            <text x="479" y={p.y + 22} textAnchor="middle" fill="#e2e8f0" fontSize="12" fontWeight="700">
              {p.name}
            </text>
            <text x="479" y={p.y + 38} textAnchor="middle" fill="#6ee7b7" fontSize="10">
              {p.sub}
            </text>
          </g>
        ))}

        {/* connectors: client -> gateway */}
        <path id="lane-in" d="M 146 190 C 170 190, 185 190, 215 190" fill="none" stroke="#38bdf8" strokeWidth="2" strokeDasharray="6 4" />
        {/* connectors: gateway -> providers */}
        <path id="lane-a" d="M 345 150 C 375 150, 385 56, 414 56" fill="none" stroke="#10b981" strokeWidth="2" strokeDasharray="6 4" />
        <path id="lane-b" d="M 345 175 C 375 175, 385 146, 414 146" fill="none" stroke="#10b981" strokeWidth="2" strokeDasharray="6 4" />
        <path id="lane-c" d="M 345 205 C 375 205, 385 236, 414 236" fill="none" stroke="#eab308" strokeWidth="2" strokeDasharray="6 4" />
        <path id="lane-d" d="M 345 230 C 375 230, 385 326, 414 326" fill="none" stroke="#10b981" strokeWidth="2" strokeDasharray="6 4" />

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
      {/* Layered depth: base wash + grid + glows */}
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
      </div>

      <div className="container-x relative z-[2] grid items-center gap-10 pt-14 pb-10 sm:pt-20 lg:grid-cols-[1.05fr_1fr] lg:gap-14">
        {/* Copy column */}
        <div>
          <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-brand-dark">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
            {BRAND.positioning}
          </p>
          <h1 className="text-3xl font-extrabold tracking-tight text-balance sm:text-5xl sm:leading-[1.08]">
            {BRAND.headline}
          </h1>
          <p className="mt-5 max-w-xl text-base text-muted text-balance sm:text-lg">
            ToLLma puts one OpenAI-compatible gateway in front of every model —
            cloud APIs, local Ollama, and your own agents — with unified keys,
            budgets, logging, and a knowledge repository. Self-host it in
            minutes. Apache 2.0 licensed, yours forever.
          </p>
          <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center">
            <a
              href={GET_STARTED_URL}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand px-5 py-3 text-sm font-bold text-white shadow-lg shadow-blue-600/25 transition hover:bg-brand-dark"
            >
              Get Started <ArrowRight className="h-4 w-4" aria-hidden />
            </a>
            <a
              href={GITHUB_URL}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-ink px-5 py-3 text-sm font-bold text-white transition hover:bg-slate-800"
            >
              <GithubIcon className="h-4 w-4" aria-hidden /> Star on GitHub
            </a>
            <a
              href={DOCS_URL}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 px-5 py-3 text-sm font-bold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
            >
              <BookOpen className="h-4 w-4" aria-hidden /> Docs
            </a>
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-2 text-xs font-medium text-slate-600">
            {["Apache 2.0", "OpenAI-compatible API", "Docker deploy", "Local-first option"].map(
              (b) => (
                <span
                  key={b}
                  className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1"
                >
                  <FileCode2 className="h-3 w-3 text-emerald-700" aria-hidden /> {b}
                </span>
              ),
            )}
          </div>
        </div>

        {/* Interactive architecture column */}
        <div
          className="relative"
          style={reduce ? undefined : parallax.layer("card")}
        >
          <div
            aria-hidden
            className="absolute -inset-6 rounded-[2rem] bg-gradient-to-br from-blue-500/15 via-emerald-400/10 to-amber-300/10 blur-2xl"
          />
          <div className="relative">
            <ArchitectureVisual reduce={reduce} />
            {/* Floating status cards (overhang only where there is room) */}
            <div className="absolute -top-4 right-0 hidden rounded-xl border border-slate-200 bg-white/95 px-3 py-2 shadow-lg backdrop-blur sm:block lg:-right-2">
              <p className="flex items-center gap-1.5 font-mono text-[11px] font-bold text-emerald-700">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />
                200 OK · 412 ms
              </p>
              <p className="mt-0.5 text-[10px] text-slate-500">llama-3.1-8b · local</p>
            </div>
            <div className="absolute -bottom-4 left-0 hidden rounded-xl border border-slate-200 bg-white/95 px-3 py-2 shadow-lg backdrop-blur sm:block lg:-left-2">
              <p className="text-[10px] font-semibold tracking-wide text-slate-500 uppercase">
                Spend this month
              </p>
              <p className="font-mono text-[11px] font-bold text-ink">
                $18.42 <span className="font-normal text-slate-500">/ $50 budget</span>
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Trust bar */}
      <div className="container-x relative z-[2] pb-12">
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
      </div>
    </section>
  );
}
