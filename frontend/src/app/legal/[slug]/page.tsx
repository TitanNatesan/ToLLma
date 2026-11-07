"use client";

import { use } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { Button, EmptyState, ErrorState, LoadingState, PageContainer, PageHeader } from "@/components/ui";
import { LegalDocViewer } from "@/components/trust/LegalDocViewer";
import { decorateLegalDocument, findSeedDocument, seedBodyNotice } from "@/components/trust/legalSeed";
import { getLegalDocument, isNotBuiltError } from "@/services/trust";
import { useAuthStore } from "@/store/auth";

/**
 * Legal document viewer (Next 16 client-page convention: `use(params)`).
 * Live registry first; bundled seed body as fallback; unknown slugs render
 * the not-found empty state.
 */
export default function LegalDocPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const seed = findSeedDocument(slug);

  const detail = useQuery({
    queryKey: ["trust", "legal", "document", slug],
    queryFn: () => getLegalDocument(slug),
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  const doc = detail.data ? decorateLegalDocument(detail.data) : (seed ?? null);
  const fromApi = detail.data !== undefined;
  // Acceptance recording requires a session: anonymous readers get the
  // read-only document (their acceptances/me query would 401).
  const authed = useAuthStore((s) => s.user) !== null;

  return (
    <PageContainer
      header={
        <PageHeader
          title={doc?.title ?? "Legal document"}
          subtitle={doc ? `${doc.locale} · version ${doc.version}` : undefined}
          hideMenu
          actions={
            <Link href="/legal" data-testid="legal-back">
              <Button variant="outline" size="sm" className="gap-1.5">
                <ArrowLeft className="size-3.5" aria-hidden="true" />
                All documents
              </Button>
            </Link>
          }
        />
      }
      testId="legal-doc-page"
      maxWidth="max-w-3xl"
    >
      {detail.isPending && !seed ? (
        <LoadingState message="Loading document…" />
      ) : detail.isError && !seed && !isNotBuiltError(detail.error) ? (
        <ErrorState
          title="Could not load this document"
          message="The legal service is unavailable."
          onRetry={() => void detail.refetch()}
        />
      ) : !doc ? (
        <EmptyState
          title="Document not found"
          description={`No legal document matches “${slug}”.`}
          action={
            <Link href="/legal">
              <Button variant="outline" size="sm">
                Back to the legal center
              </Button>
            </Link>
          }
          testId="legal-doc-missing"
        />
      ) : (
        <LegalDocViewer doc={doc} body={detail.data?.body ?? seedBodyNotice(doc)} acceptanceEnabled={fromApi && authed} />
      )}
    </PageContainer>
  );
}
