"use client";

import { FileWarning, Scale, ServerCog, ShieldCheck } from "lucide-react";
import { PageContainer, PageHeader } from "@/components/ui";
import { TrustSectionCard } from "@/components/trust/TrustSectionCard";

/** Trust Center hub: static cards linking to the four Wave 2 surfaces. */
export default function TrustCenterPage() {
  return (
    <PageContainer
      header={
        <PageHeader
          title="Trust Center"
          subtitle="Security, legal, subprocessors, and how to report a vulnerability."
        />
      }
      testId="trust-page"
      maxWidth="max-w-3xl"
    >
      <div className="grid gap-3 sm:grid-cols-2" data-testid="trust-hub">
        <TrustSectionCard
          href="/trust/security"
          icon={ShieldCheck}
          title="Security"
          description="Posture summary and model-provider policy registry."
          testId="trust-hub-security"
        />
        <TrustSectionCard
          href="/legal"
          icon={Scale}
          title="Legal"
          description="Terms, privacy, security, and AI policy documents."
          testId="trust-hub-legal"
        />
        <TrustSectionCard
          href="/trust/subprocessors"
          icon={ServerCog}
          title="Subprocessors"
          description="Third parties that process customer data."
          testId="trust-hub-subprocessors"
        />
        <TrustSectionCard
          href="/trust/disclosure"
          icon={FileWarning}
          title="Disclosure"
          description="Report a vulnerability responsibly."
          testId="trust-hub-disclosure"
        />
      </div>
      <p className="text-[11px] text-zinc-400" data-testid="trust-hub-note">
        Registry-backed sections show live data when their backend lands; until
        then they render honest pending states instead of placeholders.
      </p>
    </PageContainer>
  );
}
