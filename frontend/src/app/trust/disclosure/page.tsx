"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation } from "@tanstack/react-query";
import { CheckCircle2, FileWarning } from "lucide-react";
import { Button, Card, CardContent, Input, PageContainer, PageHeader, SectionHeader, Textarea } from "@/components/ui";
import { parseApiError } from "@/lib/errors";
import { submitVulnReport } from "@/services/trust";

/**
 * Responsible disclosure page. Reports post to the live public intake
 * (`POST /api/v1/incidents/reports/vulnerability`); the response echoes only
 * id + status + received_at (reporter-PII rule). Mailto stays as an
 * alternate channel until Agent F confirms the canonical contact (Wave 3).
 */
// ponytail: provisional contact — confirm the intake channel with Agent F.
const DISCLOSURE_CONTACT = "security@tollma.ai";

export default function TrustDisclosurePage() {
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [affected, setAffected] = useState("");
  const [contact, setContact] = useState("");
  const [error, setError] = useState<string | null>(null);

  const report = useMutation({
    mutationFn: () => submitVulnReport({ title: title.trim(), details: details.trim(), affected: affected.trim(), reporter_contact: contact.trim() }),
    onSuccess: () => {
      setError(null);
      setTitle("");
      setDetails("");
      setAffected("");
      setContact("");
    },
    onError: (e) => setError(parseApiError(e).message),
  });

  const valid = title.trim().length >= 4 && details.trim().length >= 10;

  return (
    <PageContainer
      header={
        <PageHeader
          title="Responsible disclosure"
          subtitle="How to report a security vulnerability to us."
        />
      }
      testId="trust-disclosure-page"
      maxWidth="max-w-3xl"
    >
      <Card>
        <CardContent className="pt-4">
          <SectionHeader title="Policy" description="What we ask of reporters and what we commit in return." />
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">
            <li>Report privately first — give us reasonable time to fix before any public disclosure.</li>
            <li>Do not access, modify, or exfiltrate customer data while investigating.</li>
            <li>We will acknowledge receipt, keep you updated on remediation, and credit reporters who opt in.</li>
            <li>Out of scope: spam, social engineering of staff, and denial-of-service testing.</li>
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4">
          <SectionHeader title="Report a vulnerability" description="Submitted to the security queue. Only a receipt id is echoed back." />
          {report.isSuccess ? (
            <div role="status" data-testid="trust-disclosure-receipt" className="mt-3 flex items-start gap-2 rounded-md border border-tollma-200 bg-tollma-50 px-3 py-2 text-xs text-tollma-800 dark:border-tollma-900 dark:bg-tollma-950/50 dark:text-tollma-200">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <p>
                Report received — reference <span className="font-mono">{report.data.id}</span> ({report.data.status}).
                <button
                  type="button"
                  className="ml-2 font-medium underline underline-offset-2"
                  onClick={() => report.reset()}
                  data-testid="trust-disclosure-again"
                >
                  File another
                </button>
              </p>
            </div>
          ) : (
            <form
              className="mt-3 flex flex-col gap-3"
              data-testid="trust-disclosure-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (valid && !report.isPending) report.mutate();
              }}
            >
              <label className="flex flex-col gap-1 text-xs font-medium text-zinc-800 dark:text-zinc-200">
                Title
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Short summary (min 4 characters)"
                  data-testid="trust-disclosure-title"
                  className="text-xs"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-zinc-800 dark:text-zinc-200">
                Details
                <Textarea
                  value={details}
                  onChange={(e) => setDetails(e.target.value)}
                  placeholder="Reproduction steps, impact (min 10 characters). No customer personal data."
                  data-testid="trust-disclosure-details"
                  className="min-h-24 text-xs"
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-xs font-medium text-zinc-800 dark:text-zinc-200">
                  Affected <span className="font-normal text-zinc-400">(optional)</span>
                  <Input
                    value={affected}
                    onChange={(e) => setAffected(e.target.value)}
                    placeholder="Version, URL, component"
                    data-testid="trust-disclosure-affected"
                    className="text-xs"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs font-medium text-zinc-800 dark:text-zinc-200">
                  Contact <span className="font-normal text-zinc-400">(optional)</span>
                  <Input
                    value={contact}
                    onChange={(e) => setContact(e.target.value)}
                    placeholder="How we can reach you"
                    data-testid="trust-disclosure-contact"
                    className="text-xs"
                  />
                </label>
              </div>
              {error && (
                <p role="alert" data-testid="trust-disclosure-error" className="text-[11px] text-red-500 dark:text-red-400">
                  {error}
                </p>
              )}
              <div>
                <Button type="submit" size="sm" disabled={!valid || report.isPending} data-testid="trust-disclosure-submit">
                  {report.isPending ? "Submitting…" : "Submit report"}
                </Button>
              </div>
            </form>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-zinc-100 pt-3 dark:border-zinc-900" data-testid="trust-disclosure-report">
            <FileWarning className="size-4 text-zinc-400" aria-hidden="true" />
            <p className="text-[11px] text-zinc-400">
              Prefer email?{" "}
              <Link href={`mailto:${DISCLOSURE_CONTACT}`} data-testid="trust-disclosure-mailto" className="font-medium underline underline-offset-2">
                {DISCLOSURE_CONTACT}
              </Link>
            </p>
          </div>
        </CardContent>
      </Card>
    </PageContainer>
  );
}
