import { Check, Minus } from "lucide-react";
import { SectionHeading, Reveal } from "./nav";

/**
 * Objective, category-level comparison. Describes what each project
 * focuses on — no attacks, no unverified claims.
 */
const ROWS: { label: string; openwebui: string; litellm: string; tollma: string }[] = [
  {
    label: "Primary focus",
    openwebui: "Self-hosted chat UI for LLMs",
    litellm: "LLM API proxy & SDK",
    tollma: "Gateway for models + agents",
  },
  {
    label: "Chat interface",
    openwebui: "yes",
    litellm: "no",
    tollma: "yes",
  },
  {
    label: "Agent hosting (tools, RAG)",
    openwebui: "partial",
    litellm: "no",
    tollma: "yes",
  },
  {
    label: "Knowledge repository",
    openwebui: "partial",
    litellm: "no",
    tollma: "yes",
  },
  {
    label: "API keys & budgets",
    openwebui: "partial",
    litellm: "yes",
    tollma: "yes",
  },
  {
    label: "Gateway request logs",
    openwebui: "no",
    litellm: "partial",
    tollma: "yes",
  },
  {
    label: "License",
    openwebui: "BSD-3-Clause",
    litellm: "MIT",
    tollma: "Apache 2.0",
  },
];

function Cell({ value, highlight }: { value: string; highlight?: boolean }) {
  const yes = value === "yes";
  const partial = value === "partial";
  const no = value === "no";
  if (yes || partial || no) {
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold ${
          yes
            ? "bg-mint-light text-emerald-700"
            : partial
              ? "bg-gold-light text-yellow-700"
              : "bg-slate-100 text-slate-400"
        }`}
      >
        {yes ? <Check className="h-3 w-3" aria-hidden /> : partial ? <Minus className="h-3 w-3" aria-hidden /> : null}
        {yes ? "Yes" : partial ? "Partial" : "—"}
      </span>
    );
  }
  return (
    <span className={`text-xs sm:text-sm ${highlight ? "font-bold text-ink" : "text-muted"}`}>
      {value}
    </span>
  );
}

export default function Why() {
  return (
    <section id="why" className="scroll-mt-20 bg-slate-50 py-16 sm:py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHeading
          eyebrow="Why ToLLma"
          title="Different tools solve different slices"
          sub="Open WebUI excels at chat, LiteLLM at proxying. ToLLma combines gateway, agents, and knowledge in one self-hosted stack."
        />
        <Reveal>
          <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full min-w-150 border-collapse text-left">
              <caption className="sr-only">
                Category comparison of Open WebUI, LiteLLM, and ToLLma
              </caption>
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70">
                  <th scope="col" className="px-4 py-3 text-xs font-bold tracking-wide text-slate-500 uppercase">
                    Capability
                  </th>
                  <th scope="col" className="px-4 py-3 text-sm font-bold">Open WebUI</th>
                  <th scope="col" className="px-4 py-3 text-sm font-bold">LiteLLM</th>
                  <th scope="col" className="bg-brand-light/50 px-4 py-3 text-sm font-bold text-brand-dark">
                    ToLLma
                  </th>
                </tr>
              </thead>
              <tbody>
                {ROWS.map((r) => (
                  <tr key={r.label} className="border-b border-slate-100 last:border-0">
                    <th scope="row" className="px-4 py-3 text-xs font-semibold text-slate-600 sm:text-sm">
                      {r.label}
                    </th>
                    <td className="px-4 py-3"><Cell value={r.openwebui} /></td>
                    <td className="px-4 py-3"><Cell value={r.litellm} /></td>
                    <td className="bg-brand-light/30 px-4 py-3"><Cell value={r.tollma} highlight /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Reveal>
        <p className="mx-auto mt-4 max-w-3xl text-center text-xs leading-relaxed text-slate-500">
          Categories describe each project's documented focus, not a benchmark.
          “Partial” means the capability exists in limited form or via plugins.
          If you only need a proxy, LiteLLM is a great fit; if you only need a
          chat UI, so is Open WebUI. ToLLma is for teams that want the gateway,
          the agents, and the knowledge base together.
        </p>
      </div>
    </section>
  );
}
