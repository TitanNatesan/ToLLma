import { Check, Minus } from "lucide-react";
import { SectionHeading } from "./nav";

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
              : "bg-slate-100 text-slate-500"
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
    <section
      id="why"
      aria-label="Why ToLLma"
      className="noise-overlay section scroll-mt-20 bg-slate-50"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(44rem_22rem_at_50%_0%,rgba(37,99,235,0.08),transparent)]"
      />
      <div className="container-x relative z-[2]">
        <SectionHeading
          eyebrow="Why ToLLma"
          title="Different tools solve different slices"
          sub="Open WebUI excels at chat, LiteLLM at proxying. ToLLma combines gateway, agents, and knowledge in one self-hosted stack."
          motion={false}
        />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)] lg:gap-10">
          {/* Sticky intro column (calm section: static, no entrances) */}
          <div className="lg:sticky lg:top-24 lg:self-start">
            <div className="card p-6">
                <p className="text-xs font-bold tracking-widest text-brand uppercase">
                  The matrix
                </p>
                <h3 className="mt-1 text-xl font-bold text-balance">
                  One stack instead of three tools.
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">
                  If you only need a proxy, LiteLLM is a great fit; if you only
                  need a chat UI, so is Open WebUI. ToLLma is for teams that
                  want the gateway, the agents, and the knowledge base together.
                </p>
                <p className="mt-4 border-t border-dashed border-slate-200 pt-4 text-xs leading-relaxed text-slate-500">
                  Categories describe each project&apos;s documented focus, not
                  a benchmark. “Partial” means the capability exists in limited
                  form or via plugins.
                </p>
            </div>
          </div>

          {/* Matrix card */}
          <div className="gradient-border overflow-hidden rounded-2xl bg-white shadow-[0_24px_48px_-24px_rgba(15,23,42,0.25)]">
              <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Scrollable comparison table">
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
                      <tr key={r.label} className="matrix-row border-b border-slate-100 last:border-0">
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
            </div>
        </div>
      </div>
    </section>
  );
}
