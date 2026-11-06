"use client";

import Link from "next/link";
import { FileText } from "lucide-react";
import { Badge } from "@/components/ui";
import { LEGAL_CATEGORY_LABELS } from "./legalSeed";
import type { LegalDocument } from "@/types/trust";

export function lifecycleBadge(doc: LegalDocument) {
  if (doc.status === "archived") return <Badge variant="secondary">archived</Badge>;
  if (doc.status === "published" && doc.lifecycle !== "draft") return <Badge variant="success">v{doc.version}</Badge>;
  return <Badge variant="outline">draft v{doc.version}</Badge>;
}

/** Catalogue rows: title + summary + status/category badges. */
export function LegalDocList({ docs, testId }: { docs: LegalDocument[]; testId?: string }) {
  return (
    <ul className="divide-y divide-zinc-100 dark:divide-zinc-900" data-testid={testId ?? "legal-doc-list"}>
      {docs.map((doc) => (
        <li key={doc.slug} data-testid={`legal-doc-row-${doc.slug}`}>
          <Link
            href={`/legal/${doc.slug}`}
            data-testid={`legal-doc-${doc.slug}`}
            className="flex items-start gap-3 rounded-md px-3 py-3 transition-colors hover:bg-zinc-50 focus-visible:outline-none dark:hover:bg-zinc-900/50"
          >
            <FileText className="mt-0.5 size-4 shrink-0 text-zinc-400" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-zinc-900 dark:text-zinc-100">
                {doc.title}
                {lifecycleBadge(doc)}
                {doc.category && <Badge variant="secondary">{LEGAL_CATEGORY_LABELS[doc.category]}</Badge>}
              </span>
              <span className="mt-0.5 block truncate text-xs text-zinc-500 dark:text-zinc-400">
                {doc.summary ?? "Legal document."}
              </span>
              <span className="mt-0.5 block text-[11px] text-zinc-400">
                {doc.effective_at ? `Effective ${doc.effective_at}` : "Effective date pending"} · {doc.locale}
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
