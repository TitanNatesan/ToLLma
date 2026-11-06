"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MarkdownContent } from "@/components/ai-elements/markdown";
import { Badge, Button, Checkbox } from "@/components/ui";
import { parseApiError, toastApiError } from "@/lib/errors";
import { toast } from "@/lib/notify";
import { acceptLegalDocument, listMyAcceptances } from "@/services/trust";
import type { LegalDocument } from "@/types/trust";
import { lifecycleBadge } from "./LegalDocList";

/**
 * Document viewer: version/reaccept chips + rendered body + acceptance gate.
 * Acceptance state comes from the live registry (`acceptances/me`); when the
 * backend is absent (`acceptanceEnabled=false`) the checkbox stays disabled
 * with an honest note instead of faking a recording.
 */
export function LegalDocViewer({
  doc,
  body,
  acceptanceEnabled,
}: {
  doc: LegalDocument;
  body: string;
  acceptanceEnabled: boolean;
}) {
  const queryClient = useQueryClient();
  const [acknowledged, setAcknowledged] = useState(false);

  const acceptances = useQuery({
    queryKey: ["trust", "legal", "acceptances", "me"],
    queryFn: listMyAcceptances,
    retry: false,
    staleTime: 60 * 1000,
    enabled: acceptanceEnabled,
  });

  const accepted = (acceptances.data ?? []).some(
    (a) => a.document_slug === doc.slug && a.content_hash === doc.content_hash,
  );

  const accept = useMutation({
    mutationFn: () => acceptLegalDocument({ slug: doc.slug }),
    onSuccess: () => {
      toast.success(`Accepted ${doc.title} v${doc.version}`);
      setAcknowledged(false);
      void queryClient.invalidateQueries({ queryKey: ["trust", "legal", "acceptances", "me"] });
      void queryClient.invalidateQueries({ queryKey: ["trust", "legal", "reaccept"] });
    },
    onError: (e) => {
      toastApiError(e, { title: "Could not record acceptance" });
    },
  });

  return (
    <div data-testid="legal-viewer">
      <div className="flex flex-wrap items-center gap-2" data-testid="legal-viewer-meta">
        {lifecycleBadge(doc)}
        {doc.requires_reaccept && <Badge variant="warning">re-accept on major updates</Badge>}
        {accepted && <Badge variant="success">accepted</Badge>}
        <span className="text-[11px] text-zinc-400">
          {doc.effective_at ? `Effective ${doc.effective_at}` : "Effective date pending"} · {doc.locale} ·{" "}
          <span className="font-mono">{doc.content_hash.slice(0, 19)}…</span>
        </span>
      </div>

      <div className="mt-4 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
        <MarkdownContent content={body} />
      </div>

      <div
        className="mt-4 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
        data-testid="legal-acceptance"
      >
        {accepted ? (
          <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400" data-testid="legal-accept-done">
            You accepted this version. Major updates will ask you to re-accept.
          </p>
        ) : acceptanceEnabled ? (
          <>
            <Checkbox
              id="legal-accept-confirm"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
              label={`I have read and accept ${doc.title} v${doc.version}.`}
              data-testid="legal-accept-checkbox"
            />
            <div className="mt-3">
              <Button
                type="button"
                size="sm"
                disabled={!acknowledged || accept.isPending}
                onClick={() => accept.mutate()}
                data-testid="legal-accept-submit"
              >
                {accept.isPending ? "Recording…" : "Record acceptance"}
              </Button>
            </div>
            {accept.isError && (
              <p className="mt-2 text-[11px] text-red-500 dark:text-red-400">
                {parseApiError(accept.error).message}
              </p>
            )}
          </>
        ) : (
          <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400" data-testid="legal-accept-unavailable">
            Acceptance recording is unavailable until the legal registry API lands
            (orchestrator, Wave 3). This draft is shown for review only.
          </p>
        )}
      </div>
    </div>
  );
}
