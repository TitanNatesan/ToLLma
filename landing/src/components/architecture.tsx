"use client";

import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { SectionHeading } from "./nav";
import { FadeUp } from "@/lib/motion";

/**
 * Sticky scroll-storytelling: pinned narrative on the left, six request
 * lifecycle steps scrolling on the right. Copy is preserved from the
 * Route / Govern / Ground lenses — reorganized as a single request journey:
 * gateway entry → resolution → policy → execution → analytics → streaming.
 */

const STEPS = [
  {
    id: "entry",
    lens: "Route",
    title: "1 · Gateway entry",
    body: "Your app calls POST /v1/chat/completions with a model alias. One endpoint, one wire format — the OpenAI shape your client already speaks.",
    bullets: ["Identical OpenAI wire format in and out"],
  },
  {
    id: "resolution",
    lens: "Route",
    title: "2 · Model resolution",
    body: "ToLLma resolves the alias to the best provider — OpenAI, Anthropic, a local Ollama box, or an in-house agent.",
    bullets: ["Model aliases decouple code from providers", "Per-key routing rules & fallbacks"],
  },
  {
    id: "policy",
    lens: "Govern",
    title: "3 · Policy & budgets",
    body: "Each hop through the gateway is authenticated, metered, and logged. Spend caps are enforced before dispatch, not discovered on the invoice.",
    bullets: ["Scoped, revocable API keys", "Spend caps enforced before dispatch"],
  },
  {
    id: "execution",
    lens: "Ground",
    title: "4 · Grounded execution",
    body: "Drop documents into the repository once. At query time ToLLma retrieves the relevant chunks and injects them into the prompt — so any model or agent answers from your docs.",
    bullets: ["Ingest docs once, use everywhere", "Retrieval injected at gateway level"],
  },
  {
    id: "analytics",
    lens: "Govern",
    title: "5 · Logs & analytics",
    body: "Inspect every request — latency, tokens, status — when production surprises you. Token usage, latency, and error trends per model, key, and time range.",
    bullets: ["Full request log for debugging"],
  },
  {
    id: "streaming",
    lens: "Route · Ground",
    title: "6 · Streaming response",
    body: "The response streams back unchanged to your app. Works with cloud and local models — switch providers in config, not in code.",
    bullets: ["Works with cloud and local models"],
  },
] as const;

export default function Architecture() {
  const [active, setActive] = useState<string>(STEPS[0].id);
  const stepRefs = useRef<Map<string, HTMLElement>>(new Map());

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) setActive(e.target.getAttribute("data-step")!);
        }
      },
      { rootMargin: "-40% 0px -50% 0px", threshold: 0 },
    );
    stepRefs.current.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  return (
    <section
      id="architecture"
      aria-label="Architecture: how a request flows"
      className="noise-overlay section scroll-mt-20 bg-slate-50"
    >
      <div
        aria-hidden
        className="bg-grid pointer-events-none absolute inset-0 opacity-50 [mask-image:radial-gradient(54rem_30rem_at_50%_10%,black,transparent_75%)]"
      />
      <div className="container-x relative z-[2]">
        <SectionHeading
          eyebrow="Architecture"
          title="User → ToLLma → Providers"
          sub="Three jobs, one hop. Follow a single request through the gateway."
        />

        <div className="grid gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-12">
          {/* Pinned narrative */}
          <div className="lg:sticky lg:top-24 lg:self-start">
            <FadeUp>
              <div className="gradient-border rounded-2xl bg-white p-6 shadow-sm sm:p-7">
                <p className="font-mono text-xs text-slate-500">
                  POST /v1/chat/completions
                </p>
                <p className="mt-2 text-lg font-bold text-balance">
                  One request in, best model out.
                </p>
                <p className="mt-2 text-sm leading-relaxed text-muted">
                  Keys, budgets, and logs on every call — grounded in your own
                  knowledge. Scroll to walk the six stages.
                </p>
                {/* Step index nav (keyboard accessible) */}
                <nav aria-label="Request lifecycle steps" className="mt-5">
                  <ol className="space-y-1.5">
                    {STEPS.map((s, i) => {
                      const isActive = active === s.id;
                      return (
                        <li key={s.id}>
                          <a
                            href={`#arch-${s.id}`}
                            onClick={() => setActive(s.id)}
                            aria-current={isActive ? "true" : undefined}
                            className={`flex min-h-[44px] items-center gap-3 rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
                              isActive
                                ? "bg-brand text-white shadow-md shadow-blue-600/25"
                                : "text-slate-600 hover:bg-slate-100"
                            }`}
                          >
                            <span
                              aria-hidden
                              className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-extrabold ${
                                isActive ? "bg-white/20" : "bg-slate-100 text-slate-500"
                              }`}
                            >
                              {i + 1}
                            </span>
                            {s.title.replace(/^\d · /, "")}
                          </a>
                        </li>
                      );
                    })}
                  </ol>
                </nav>
                {/* Gradient progress line */}
                <div
                  aria-hidden
                  className="mt-5 h-1 overflow-hidden rounded-full bg-slate-100"
                >
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-brand via-mint to-gold transition-all duration-500"
                    style={{
                      width: `${((STEPS.findIndex((s) => s.id === active) + 1) / STEPS.length) * 100}%`,
                    }}
                  />
                </div>
              </div>
            </FadeUp>
          </div>

          {/* Scrolling steps, linked by a gradient journey line */}
          <ol className="space-y-0">
            {STEPS.map((s, i) => (
              <li key={s.id} className="relative pb-3 last:pb-0">
                <FadeUp delay={Math.min(i * 0.03, 0.12)}>
                  <article
                    id={`arch-${s.id}`}
                    data-step={s.id}
                    ref={(el) => {
                      if (el) stepRefs.current.set(s.id, el);
                      else stepRefs.current.delete(s.id);
                    }}
                    aria-label={s.title}
                    className={`group relative scroll-mt-28 overflow-hidden rounded-2xl border bg-white p-6 shadow-sm transition duration-300 hover:shadow-[0_20px_44px_-20px_rgba(37,99,235,0.35)] sm:p-7 ${
                      active === s.id
                        ? "border-blue-300 shadow-[0_20px_44px_-20px_rgba(37,99,235,0.35)]"
                        : "border-slate-200"
                    }`}
                  >
                    <div
                      aria-hidden
                      className="pointer-events-none absolute inset-0 opacity-0 transition duration-300 group-hover:opacity-100"
                      style={{
                        background:
                          "radial-gradient(24rem 12rem at 50% 0%, rgba(37,99,235,0.08), transparent 70%)",
                      }}
                    />
                    <div className="relative">
                    <p className="text-xs font-bold tracking-widest text-brand uppercase">
                      {s.lens}
                    </p>
                    <h3 className="mt-1 text-lg font-bold">{s.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-muted sm:text-base">
                      {s.body}
                    </p>
                    <ul className="mt-4 space-y-2">
                      {s.bullets.map((b) => (
                        <li key={b} className="flex items-start gap-2 text-sm font-medium">
                          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-mint-light text-emerald-700">
                            <Check className="h-3 w-3" aria-hidden />
                          </span>
                          {b}
                        </li>
                      ))}
                    </ul>
                    </div>
                  </article>
                </FadeUp>
                {i < STEPS.length - 1 && (
                  <div aria-hidden className="flex justify-center pt-3">
                    <span className="h-4 w-px bg-gradient-to-b from-brand/40 via-mint/40 to-gold/40" />
                  </div>
                )}
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
