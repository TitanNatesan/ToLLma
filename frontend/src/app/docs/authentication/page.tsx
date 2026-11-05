"use client";

import { PageHeader } from "@/components/ui";
import { DocCode, DocPage, DocSection } from "../components/DocBlock";

/** Authentication, budgets, rate limits and error codes. */
export default function DocsAuthenticationPage() {
  return (
    <DocPage testId="docs-authentication-page">
      <PageHeader title="Authentication" subtitle="API keys, headers, budgets, rate limits and errors." />
      <DocSection title="API keys" testId="docs-auth-keys">
        <ol className="list-decimal space-y-1 pl-5">
          <li>Create a key at API Keys. It is shown once as <code>tma_sk_live_…</code> — copy it immediately.</li>
          <li>Only a SHA-256 hash is stored; ToLLma can never show the secret again. Rotate if it leaks.</li>
          <li>Attach the key to every request (see Headers below).</li>
          <li>Scope it down: model allowlist, IP rules, budget and rate limits.</li>
        </ol>
        <DocCode testId="docs-auth-curl">
          {`curl http://localhost:8000/v1/models \\
  -H "Authorization: Bearer tma_sk_live_..."`}
        </DocCode>
      </DocSection>
      <DocSection title="Headers" testId="docs-auth-headers">
        <p>
          Send the key as <code>Authorization: Bearer &lt;key&gt;</code> or as{" "}
          <code>x-api-key: &lt;key&gt;</code> — both authenticate the same way. All API
          routes live under <code>http://localhost:8000/v1</code>; every response is JSON.
        </p>
        <DocCode testId="docs-auth-headers-code">
          {`# Both headers work; Bearer is preferred.
curl http://localhost:8000/v1/me -H "Authorization: Bearer tma_sk_live_..."
curl http://localhost:8000/v1/me -H "x-api-key: tma_sk_live_..."`}
        </DocCode>
      </DocSection>
      <DocSection title="Model identifiers" testId="docs-auth-models">
        <p>
          Use <code>provider/model</code> (e.g. <code>openai/gpt-5</code>) or a bare alias when it
          is unique (e.g. <code>gpt-5</code>). Ambiguous aliases answer{" "}
          <code>ambiguous_model</code> — qualify with the provider. <code>GET /v1/models</code>{" "}
          lists only the models the calling key may use.
        </p>
      </DocSection>
      <DocSection title="Budgets" testId="docs-auth-budgets">
        <p>
          Keys enforce budgets <em>before</em> the provider call: an exhausted budget answers
          403 with no overage, so spend can never overshoot. Configure a{" "}
          <code>max_budget_usd</code> with a reset window (e.g. every 30 days), optional daily
          and monthly spend caps, and per-model overrides for expensive models.
        </p>
        <DocCode testId="docs-auth-budgets-code">
          {`# Key identity includes current spend versus budget.
curl http://localhost:8000/v1/me -H "Authorization: Bearer tma_sk_live_..."
# → {"key": "research", "spend_usd": 1.42, "max_budget_usd": 10.0, ...}`}
        </DocCode>
      </DocSection>
      <DocSection title="Rate limits" testId="docs-auth-limits">
        <p>
          Per-key rate limits (RPM/RPH/RPD/TPM/TPD) answer 429 with a{" "}
          <code>Retry-After</code> header when the window is exhausted — back off and retry.
          Daily/monthly spend caps and per-model overrides apply the same way.
        </p>
        <DocCode testId="docs-auth-limits-code">
          {`HTTP/1.1 429 Too Many Requests
Retry-After: 42
{"detail": "rate_limited", "retry_after": 42}`}
        </DocCode>
      </DocSection>
      <DocSection title="Error codes" testId="docs-auth-errors">
        <p>
          401 unauthenticated · 403 model_not_allowed / budget / disabled key · 409 conflict ·
          422 ambiguous_model / validation · 429 rate limited · 502 provider failure.
        </p>
        <DocCode testId="docs-auth-errors-code">
          {`{"detail": "model_not_allowed", "model": "openai/gpt-5"}
{"detail": "ambiguous_model", "candidates": ["openai/gpt-5", "azure/gpt-5"]}
{"detail": "budget_exceeded", "spend_usd": 10.0, "max_budget_usd": 10.0}`}
        </DocCode>
      </DocSection>
    </DocPage>
  );
}
