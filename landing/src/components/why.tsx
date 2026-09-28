import { Check, Minus } from "lucide-react";
import { SectionHeading } from "./nav";
import { COMPETITOR_MATRIX } from "../../data/competitors";
import type { MatrixCell } from "../../data/competitors";

/**
 * Objective, category-level comparison rendered from
 * `landing/data/competitors.ts` (10 products × rows as data dictates).
 *
 * Sourcing: competitor cells cite official vendor docs, ToLLma cells cite
 * repo code paths — full per-cell URLs live in the data file. The two
 * evidence-backed corrections from COMPETITORS.md are baked into the data:
 * Open WebUI license carries the v0.6.6+ branding-clause note, and LiteLLM
 * request logging reads Yes (per-key/team spend + request logs, admin UI).
 */

const TOLLMA_ID = "tollma";

function Cell({ cell, highlight }: { cell: MatrixCell; highlight?: boolean }) {
  const badge =
    cell.display === "Yes" || cell.display === "Partial" || cell.display === "—";
  if (badge) {
    const yes = cell.tone === "yes";
    const partial = cell.tone === "partial";
    return (
      <span className="block">
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold whitespace-nowrap ${
            yes
              ? "bg-mint-light text-emerald-700"
              : partial
                ? "bg-gold-light text-yellow-700"
                : "bg-slate-100 text-slate-500"
          }`}
        >
          {yes ? (
            <Check className="h-3 w-3" aria-hidden />
          ) : partial ? (
            <Minus className="h-3 w-3" aria-hidden />
          ) : null}
          {cell.display === "—" ? "—" : cell.display}
        </span>
        <span className="mt-1 block max-w-48 text-[11px] leading-snug text-slate-500">
          {cell.note}
        </span>
      </span>
    );
  }
  return (
    <span className="block">
      <span
        className={`inline-flex items-center gap-1.5 text-xs font-bold whitespace-nowrap ${
          highlight ? "text-ink" : "text-slate-700"
        }`}
      >
        <span
          aria-hidden
          className={`h-1.5 w-1.5 rounded-full ${
            cell.tone === "yes"
              ? "bg-emerald-500"
              : cell.tone === "partial"
                ? "bg-gold"
                : "bg-slate-300"
          }`}
        />
        {cell.display}
      </span>
      <span className="mt-1 block max-w-48 text-[11px] leading-snug text-slate-500">
        {cell.note}
      </span>
    </span>
  );
}

export default function Why() {
  const { columns, rows } = COMPETITOR_MATRIX;
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
        <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,9fr)] lg:gap-10">
          {/* Sticky intro column (calm section: static, no entrances) */}
          <div className="lg:sticky lg:top-24 lg:self-start">
            <div className="card group relative overflow-hidden p-6">
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 opacity-0 transition duration-300 group-hover:opacity-100"
                style={{
                  background:
                    "radial-gradient(22rem 12rem at 50% 0%, rgba(37,99,235,0.08), transparent 70%)",
                }}
              />
              <p className="relative text-xs font-bold tracking-widest text-brand uppercase">
                The matrix
              </p>
              <h3 className="relative mt-1 text-xl font-bold text-balance">
                One stack instead of a patchwork of tools.
              </h3>
              <p className="relative mt-2 text-sm leading-relaxed text-muted">
                If you only need a proxy, LiteLLM is a great fit; if you only
                need a chat UI, so is Open WebUI. ToLLma is for teams that
                want the gateway, the agents, and the knowledge base together.
              </p>
              <p className="relative mt-4 border-t border-dashed border-slate-200 pt-4 text-xs leading-relaxed text-slate-500">
                Categories describe each project&apos;s documented focus, not
                a benchmark. “Partial” means the capability exists in limited
                form, is enterprise-gated, or arrives via an adjacent feature.
              </p>
            </div>
          </div>

          {/* Matrix card */}
          <div className="gradient-border overflow-hidden rounded-2xl bg-white shadow-[0_24px_48px_-24px_rgba(15,23,42,0.25)]">
            <div
              className="overflow-x-auto"
              tabIndex={0}
              role="region"
              aria-label="Scrollable comparison table"
            >
              <table className="w-full min-w-[120rem] border-collapse text-left">
                <caption className="sr-only">
                  Category comparison of ten AI gateway, chat, and
                  observability products including ToLLma
                </caption>
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/70">
                    <th
                      scope="col"
                      className="sticky left-0 z-[2] bg-slate-50 px-4 py-3 text-xs font-bold tracking-wide text-slate-500 uppercase shadow-[1px_0_0_0_rgba(226,232,240,1)]"
                    >
                      Capability
                    </th>
                    {columns.map((c) => {
                      const isTollma = c.id === TOLLMA_ID;
                      return (
                        <th
                          key={c.id}
                          scope="col"
                          className={`px-4 py-3 ${
                            isTollma ? "bg-brand-light/60" : ""
                          }`}
                        >
                          <span
                            className={`block text-sm font-bold whitespace-nowrap ${
                              isTollma ? "text-brand-dark" : ""
                            }`}
                          >
                            {c.label}
                          </span>
                          <span className="mt-0.5 block text-[11px] font-normal whitespace-nowrap text-slate-500">
                            {c.tagline}
                          </span>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={r.id}
                      className="matrix-row border-b border-slate-100 last:border-0"
                    >
                      <th
                        scope="row"
                        className="sticky left-0 z-[1] bg-white px-4 py-3 text-xs font-semibold text-slate-600 shadow-[1px_0_0_0_rgba(241,245,249,1)] sm:text-sm"
                      >
                        {r.label}
                      </th>
                      {columns.map((c) => {
                        const isTollma = c.id === TOLLMA_ID;
                        return (
                          <td
                            key={c.id}
                            className={`px-4 py-3 align-top ${
                              isTollma ? "bg-brand-light/30" : ""
                            }`}
                          >
                            <Cell cell={r.cells[c.id]} highlight={isTollma} />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="border-t border-dashed border-slate-200 px-5 py-2 text-[11px] font-semibold text-slate-500 lg:hidden">
              Scroll horizontally to compare all ten products →
            </p>
            {/* Sources + evidence-backed corrections footnote */}
            <div className="border-t border-slate-200 bg-slate-50/60 px-5 py-4 text-[11px] leading-relaxed text-slate-500 sm:px-6">
              <p>
                <span className="font-bold text-slate-600">License note.</span>{" "}
                Open WebUI v0.6.6+ keeps BSD-3-Clause for earlier code but adds
                a branding-protection clause, and the project states current
                releases are not an OSI-approved open-source license. Source:{" "}
                <a
                  href="https://docs.openwebui.com/license"
                  className="font-semibold text-brand-dark underline-offset-2 hover:underline"
                >
                  docs.openwebui.com/license
                </a>
                .
              </p>
              <p className="mt-1.5">
                <span className="font-bold text-slate-600">Logs note.</span>{" "}
                LiteLLM request logging reads Yes: the proxy persists
                per-request spend and usage logs queryable per key, team, and
                user with an admin UI. Source:{" "}
                <a
                  href="https://docs.litellm.ai/docs/"
                  className="font-semibold text-brand-dark underline-offset-2 hover:underline"
                >
                  docs.litellm.ai/docs
                </a>
                .
              </p>
              <p className="mt-1.5">
                Full per-cell sources live in{" "}
                <span className="font-mono">landing/data/competitors.ts</span>{" "}
                — official docs for competitors,{" "}
                <span className="font-mono">repo:</span> code paths for ToLLma.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
