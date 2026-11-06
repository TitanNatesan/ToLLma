"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Scale } from "lucide-react";
import { Button, Card, CardContent, EmptyState, LoadingState, PageContainer, PageHeader } from "@/components/ui";
import { LegalDocList } from "@/components/trust/LegalDocList";
import { LEGAL_DOCUMENT_SEED, decorateLegalDocument } from "@/components/trust/legalSeed";
import { listLegalDocuments, listReacceptRequired } from "@/services/trust";

/**
 * Legal center index. Live registry first (`status: published` rows
 * decorated with E-side summaries/categories); bundled seed only when the
 * backend is absent. Docs flagged by `reaccept-required` surface a banner.
 */
export default function LegalCenterPage() {
  const catalogue = useQuery({
    queryKey: ["trust", "legal", "documents"],
    queryFn: listLegalDocuments,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
  const reaccept = useQuery({
    queryKey: ["trust", "legal", "reaccept"],
    queryFn: listReacceptRequired,
    retry: false,
    staleTime: 60 * 1000,
  });

  const docs = (catalogue.data ?? LEGAL_DOCUMENT_SEED).map(decorateLegalDocument);
  const degraded = catalogue.isError || !catalogue.data;
  const needsReaccept = reaccept.data ?? [];

  return (
    <PageContainer
      header={
        <PageHeader
          title="Legal center"
          subtitle="Terms, privacy, security, and AI policies governing ToLLma."
        />
      }
      testId="legal-page"
      maxWidth="max-w-3xl"
    >
      {needsReaccept.length > 0 && (
        <div
          role="status"
          data-testid="legal-reaccept-banner"
          className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100"
        >
          <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
          <span>
            {needsReaccept.length === 1 ? "1 document needs" : `${needsReaccept.length} documents need`} re-acceptance:{" "}
            {needsReaccept.map((doc, i) => (
              <span key={doc.slug}>
                {i > 0 && ", "}
                <Link href={`/legal/${doc.slug}`} className="font-medium underline underline-offset-2" data-testid={`legal-reaccept-${doc.slug}`}>
                  {doc.title}
                </Link>
              </span>
            ))}
          </span>
        </div>
      )}
      {catalogue.isPending ? (
        <LoadingState message="Loading legal documents…" />
      ) : docs.length === 0 ? (
        <EmptyState
          icon={Scale}
          title="No legal documents published"
          description="The registry is empty. Check back once the legal catalogue is published."
          testId="legal-empty"
        />
      ) : (
        <Card>
          <CardContent className="px-2 py-1">
            {degraded && (
              <p
                className="mx-2 mt-2 flex flex-wrap items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100"
                data-testid="legal-degraded-note"
              >
                Showing the bundled catalogue — the live registry is unavailable.
                <Button variant="outline" size="sm" onClick={() => void catalogue.refetch()} data-testid="legal-retry">
                  Retry
                </Button>
              </p>
            )}
            <LegalDocList docs={docs} />
          </CardContent>
        </Card>
      )}
    </PageContainer>
  );
}
