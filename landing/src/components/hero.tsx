"use client";

import { motion } from "framer-motion";
import { ArrowRight, BookOpen, FileCode2, ShieldCheck } from "lucide-react";
import { GithubIcon } from "./icons";
import { BRAND, DOCS_URL, GET_STARTED_URL, GITHUB_URL } from "@/lib/site";

/**
 * Animated architecture visual: pure inline SVG + SMIL <animateMotion>.
 * No JavaScript runtime, no backend, no network — renders in the static
 * export and respects nothing-else-to-load. Packets flow client → ToLLma →
 * providers along the connector paths.
 */
function ArchitectureVisual() {
  const packet = (path: string, color: string, dur: string, begin: string) => (
    <circle r="4" fill={color} stroke="#fff" strokeWidth="1.5">
      <animateMotion dur={dur} begin={begin} repeatCount="indefinite" path={path} />
    </circle>
  );

  return (
    <div
      role="img"
      aria-label="Animated diagram: your app sends one request to the ToLLma gateway, which routes it to OpenAI, Anthropic, Ollama, or your agents"
      className="relative overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-950 via-slate-900 to-blue-950 p-4 shadow-2xl sm:p-6"
    >
      <svg viewBox="0 0 560 380" className="h-auto w-full">
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

        {/* travelling packets */}
        {packet("M 146 190 C 170 190, 185 190, 215 190", "#38bdf8", "1.6s", "0s")}
        {packet("M 146 190 C 170 190, 185 190, 215 190", "#38bdf8", "1.6s", "0.8s")}
        {packet("M 345 150 C 375 150, 385 56, 414 56", "#10b981", "1.8s", "0.2s")}
        {packet("M 345 175 C 375 175, 385 146, 414 146", "#10b981", "1.8s", "1.1s")}
        {packet("M 345 205 C 375 205, 385 236, 414 236", "#eab308", "1.8s", "0.6s")}
        {packet("M 345 230 C 375 230, 385 326, 414 326", "#10b981", "1.8s", "1.5s")}
      </svg>
      <div className="mt-2 flex items-center justify-between rounded-lg bg-white/5 px-3 py-2 font-mono text-[11px] text-emerald-300 sm:text-xs">
        <span className="truncate">POST /v1/chat/completions → 200 OK · 412 ms</span>
        <span className="ml-2 hidden shrink-0 rounded bg-emerald-500/20 px-2 py-0.5 text-emerald-300 sm:inline">
          live routing
        </span>
      </div>
    </div>
  );
}

export default function Hero() {
  return (
    <section id="top" className="relative overflow-hidden bg-white">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(60rem_30rem_at_50%_-8rem,rgba(37,99,235,0.12),transparent)]"
      />
      <div className="relative mx-auto grid max-w-6xl items-center gap-10 px-4 pt-14 pb-12 sm:px-6 sm:pt-20 lg:grid-cols-2 lg:gap-12">
        <div>
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="mb-4 inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-brand-dark"
          >
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
            {BRAND.positioning}
          </motion.p>
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.08 }}
            className="text-3xl font-extrabold tracking-tight text-balance sm:text-5xl sm:leading-[1.1]"
          >
            {BRAND.headline}
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.16 }}
            className="mt-5 max-w-xl text-base text-muted text-balance sm:text-lg"
          >
            ToLLma puts one OpenAI-compatible gateway in front of every model —
            cloud APIs, local Ollama, and your own agents — with unified keys,
            budgets, logging, and a knowledge repository. Self-host it in
            minutes. Apache 2.0 licensed, yours forever.
          </motion.p>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.24 }}
            className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center"
          >
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
          </motion.div>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.35 }}
            className="mt-6 flex flex-wrap items-center gap-2 text-xs font-medium text-slate-600"
          >
            {["Apache 2.0", "OpenAI-compatible API", "Docker deploy", "Local-first option"].map(
              (b) => (
                <span
                  key={b}
                  className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1"
                >
                  <FileCode2 className="h-3 w-3 text-mint" aria-hidden /> {b}
                </span>
              ),
            )}
          </motion.div>
        </div>
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.6, delay: 0.2 }}
        >
          <ArchitectureVisual />
        </motion.div>
      </div>
    </section>
  );
}
