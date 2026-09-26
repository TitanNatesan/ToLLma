"use client";

import { PageHeader } from "@/components/ui";
import { DocCode, DocPage, DocSection } from "../components/DocBlock";

/** Authentication, budgets, rate limits and error codes. */
export default function DocsAuthenticationPage() {
  return (
    <DocPage testId="docs-authentication-page">
      <PageHeader title="Authentication" subtitle="API keys, budgets, rate limits and errors." />
      <DocSection title="API keys" testId="docs-auth-keys">
        <p>
          Create a key at API Keys. It is shown once as{" "}
          <code>tma_sk_live_…</code> — only a SHA-256 hash is stored. Send it as{" "}
          <code>Authorization: Bearer</code> or <code>x-api-key</code>.
        </p>
        <DocCode testId="docs-auth-curl">
          {`curl http://localhost:8000/v1/models \\
  -H "Authorization: Bearer tma_sk_live_..."`}
        </DocCode>
      </DocSection>
      <DocSection title="Model identifiers" testId="docs-auth-models">
        <p>
          Use <code>provider/model</code> (e.g. <code>openai/gpt-5</code>) or a bare alias when it
          is unique (e.g. <code>gpt-5</code>). Ambiguous aliases return{" "}
          <code>ambiguous_model</code> — qualify with the provider.
        </p>
      </DocSection>
      <DocSection title="Budgets and rate limits" testId="docs-auth-limits">
        <p>
          Keys enforce budgets <em>before</em> the provider call: exhausted budgets answer 403
          with no overage. Rate limits (RPM/RPH/RPD/TPM/TPD) answer 429 with{" "}
          <code>Retry-After</code>. Daily/monthly spend caps and per-model overrides apply the
          same way.
        </p>
      </DocSection>
      <DocSection title="Errors" testId="docs-auth-errors">
        <p>401 unauthenticated · 403 model_not_allowed / budget / disabled key · 409 conflict · 422 ambiguous_model / validation · 429 rate limited · 502 provider failure.</p>
      </DocSection>
    </DocPage>
  );
}
