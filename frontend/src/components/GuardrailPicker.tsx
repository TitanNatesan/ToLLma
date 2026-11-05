"use client";

import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { Badge, Checkbox } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { GuardrailPolicy } from "@/services/guardrails";

/**
 * Reusable guardrail assignment checklist: inherited (read-only) policies
 * render locked with a note; own policies toggle. Never rotates keys —
 * it only edits the id set, the caller submits it through its own endpoint.
 */
export function GuardrailPicker({
  inherited,
  assignable,
  mandatoryIds,
  assignedIds,
  onToggle,
  disabled,
  deepLink = true,
}: {
  inherited: GuardrailPolicy[];
  assignable: GuardrailPolicy[];
  mandatoryIds: Set<string>;
  assignedIds: Set<string>;
  onToggle: (id: string) => void;
  disabled?: boolean;
  deepLink?: boolean;
}) {
  return (
    <div className="space-y-3" data-testid="guardrail-picker">
      {inherited.length > 0 && (
        <div className="space-y-1.5">
          {/* Key context fetches effective without provider/model, so inherited is global-only in practice (provider scope retained backend as targeting refinement). */}
          <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
            Inherited (global)
          </p>
          <ul className="space-y-1">
            {inherited.map((p) => (
              <li
                key={p.id}
                className="flex items-center gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1.5 text-xs dark:border-zinc-800 dark:bg-zinc-900/40"
              >
                <ShieldCheck className="size-3.5 shrink-0 text-zinc-400" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-zinc-700 dark:text-zinc-300">{p.name}</span>
                <Badge variant="secondary" className="text-[10px]">inherited</Badge>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="space-y-1.5">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
          This {assignable.length ? "target" : ""} — key-specific policies
        </p>
        {assignable.length === 0 ? (
          <p className="text-xs text-zinc-400">No assignable policies. Create one on the guardrails page.</p>
        ) : (
          <ul className="space-y-1">
            {assignable.map((p) => {
              const locked = mandatoryIds.has(p.id);
              const checked = locked || assignedIds.has(p.id);
              return (
                <li key={p.id}>
                  <label
                    className={cn(
                      "flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5 text-xs",
                      "border-zinc-200 dark:border-zinc-800",
                      checked && "border-tollma-300 bg-tollma-50/60 dark:border-tollma-800 dark:bg-tollma-950/20",
                    )}
                  >
                    <Checkbox
                      checked={checked}
                      disabled={disabled || locked}
                      onChange={() => onToggle(p.id)}
                      aria-label={`Assign ${p.name}`}
                      data-testid={`guardrail-assign-${p.id}`}
                    />
                    <span className="min-w-0 flex-1 truncate text-zinc-700 dark:text-zinc-300">{p.name}</span>
                    {locked ? (
                      <Badge variant="secondary" className="text-[10px]">mandatory</Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px]">{p.severity}</Badge>
                    )}
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {deepLink && (
        <Link href="/guardrails" className="text-[11px] text-tollma-600 hover:underline dark:text-tollma-400">
          Manage guardrails →
        </Link>
      )}
    </div>
  );
}
