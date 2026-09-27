"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Check } from "lucide-react";
import { SectionHeading, Reveal } from "./nav";

const TABS = [
  {
    id: "route",
    label: "Route",
    title: "One request in, best model out",
    body: "Your app calls POST /v1/chat/completions with a model alias. ToLLma resolves the alias, checks the key's budget, and forwards to the right provider — OpenAI, Anthropic, a local Ollama box, or an in-house agent. The response streams back unchanged.",
    bullets: ["Model aliases decouple code from providers", "Per-key routing rules & fallbacks", "Identical OpenAI wire format in and out"],
    flow: ["App", "ToLLma Gateway", "Best provider"],
  },
  {
    id: "govern",
    label: "Govern",
    title: "Keys, budgets, and logs on every call",
    body: "Each hop through the gateway is authenticated, metered, and logged. Issue a scoped key per app or teammate, cap spend per key, and inspect every request — latency, tokens, status — when production surprises you.",
    bullets: ["Scoped, revocable API keys", "Spend caps enforced before dispatch", "Full request log for debugging"],
    flow: ["API key", "Budget check", "Audit log"],
  },
  {
    id: "ground",
    label: "Ground",
    title: "Ground answers in your own knowledge",
    body: "Drop documents into the repository once. At query time ToLLma retrieves the relevant chunks and injects them into the prompt — so any model or agent answers from your docs, not from memory. Nothing to re-index per provider.",
    bullets: ["Ingest docs once, use everywhere", "Retrieval injected at gateway level", "Works with cloud and local models"],
    flow: ["Documents", "Repository", "Grounded answer"],
  },
] as const;

export default function Architecture() {
  const [active, setActive] = useState<(typeof TABS)[number]["id"]>("route");
  const tab = TABS.find((t) => t.id === active)!;

  return (
    <section id="architecture" className="scroll-mt-20 bg-slate-50 py-16 sm:py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHeading
          eyebrow="Architecture"
          title="User → ToLLma → Providers"
          sub="Three jobs, one hop. Pick a lens to see what the gateway does with each request."
        />
        <Reveal>
          <div
            role="tablist"
            aria-label="Architecture lenses"
            className="mx-auto mb-8 flex w-fit rounded-xl border border-slate-200 bg-white p-1 shadow-sm"
          >
            {TABS.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={active === t.id}
                onClick={() => setActive(t.id)}
                className={`rounded-lg px-4 py-2 text-sm font-bold transition sm:px-6 ${
                  active === t.id
                    ? "bg-brand text-white shadow"
                    : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </Reveal>
        <AnimatePresence mode="wait">
          <motion.div
            key={tab.id}
            role="tabpanel"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.3 }}
            className="mx-auto max-w-4xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8"
          >
            {/* flow diagram */}
            <div className="mb-6 flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
              {tab.flow.map((node, i) => (
                <div key={node} className="flex flex-1 items-center gap-2">
                  <div
                    className={`flex-1 rounded-xl px-3 py-3 text-center text-sm font-bold ${
                      i === 1
                        ? "bg-brand text-white shadow-md shadow-blue-600/25"
                        : "border border-slate-200 bg-slate-50 text-slate-700"
                    }`}
                  >
                    {node}
                  </div>
                  {i < tab.flow.length - 1 && (
                    <ArrowRight
                      className="h-4 w-4 shrink-0 rotate-90 text-brand sm:rotate-0"
                      aria-hidden
                    />
                  )}
                </div>
              ))}
            </div>
            <h3 className="text-lg font-bold">{tab.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted sm:text-base">
              {tab.body}
            </p>
            <ul className="mt-4 space-y-2">
              {tab.bullets.map((b) => (
                <li key={b} className="flex items-start gap-2 text-sm font-medium">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-mint-light text-emerald-700">
                    <Check className="h-3 w-3" aria-hidden />
                  </span>
                  {b}
                </li>
              ))}
            </ul>
          </motion.div>
        </AnimatePresence>
      </div>
    </section>
  );
}
