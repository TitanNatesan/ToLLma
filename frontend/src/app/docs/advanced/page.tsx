"use client";

import { PageHeader } from "@/components/ui";
import { DocCode, DocPage, DocSection } from "../components/DocBlock";

/** Responses API, media endpoints, key identity and SDK notes. */
export default function DocsAdvancedPage() {
  return (
    <DocPage testId="docs-advanced-page">
      <PageHeader title="Responses, Media & Limits" subtitle="The rest of the /v1 surface." />
      <DocSection title="Responses API" testId="docs-advanced-responses">
        <p><code>POST /v1/responses</code> accepts <code>input</code> plus optional <code>instructions</code>, and streams <code>response.output_text.delta</code> events.</p>
        <DocCode testId="docs-advanced-responses-code">
          {`response = client.post(
    "http://localhost:8000/v1/responses",
    headers={"Authorization": "Bearer tma_sk_live_..."},
    json={"model": "google/gemini-2.5-pro", "input": "Hello!"},
)`}
        </DocCode>
      </DocSection>
      <DocSection title="Images" testId="docs-advanced-media">
        <p><code>POST /v1/images/generations</code> renders from a prompt; <code>/v1/images/edits</code> takes an image plus a prompt describing the change. Both require models flagged for image generation — otherwise the gateway answers 403 <code>model_not_allowed</code>.</p>
        <DocCode testId="docs-advanced-media-code">
          {`curl http://localhost:8000/v1/images/generations \\
  -H "Authorization: Bearer tma_sk_live_..." \\
  -H "Content-Type: application/json" \\
  -d '{"model": "openai/gpt-image-1", "prompt": "A lighthouse at dawn"}'`}
        </DocCode>
      </DocSection>
      <DocSection title="Video" testId="docs-advanced-video">
        <p><code>POST /v1/videos/generations</code> starts an async render for video-capable models and returns a job id — poll the job until it completes, then download the result.</p>
        <DocCode testId="docs-advanced-video-code">
          {`curl http://localhost:8000/v1/videos/generations \\
  -H "Authorization: Bearer tma_sk_live_..." \\
  -H "Content-Type: application/json" \\
  -d '{"model": "google/veo-3", "prompt": "Waves breaking at dusk"}'`}
        </DocCode>
      </DocSection>
      <DocSection title="Key identity" testId="docs-advanced-me">
        <p><code>GET /v1/me</code> returns the calling key, its allowed models and current spend versus budget.</p>
        <DocCode testId="docs-advanced-me-code">
          {`curl http://localhost:8000/v1/me -H "Authorization: Bearer tma_sk_live_..."
# → {"key": "research", "models": ["openai/gpt-5", ...],
#     "spend_usd": 1.42, "max_budget_usd": 10.0}`}
        </DocCode>
      </DocSection>
      <DocSection title="Limits" testId="docs-advanced-limits">
        <p>Budgets are checked before the provider call (403, no overage); rate windows answer 429 with <code>Retry-After</code>. See Authentication for the full budget, rate-limit and error-code reference.</p>
      </DocSection>
      <DocSection title="Other SDKs" testId="docs-advanced-sdks">
        <p>LangChain, LlamaIndex, CrewAI, Vercel AI SDK, OpenWebUI, Cursor, Continue and OpenHands all work by setting their OpenAI-compatible base URL to <code>http://localhost:8000/v1</code> with the API key.</p>
        <DocCode testId="docs-advanced-sdks-code">
          {`import { createOpenAI } from "@ai-sdk/openai";

const tollma = createOpenAI({
  baseURL: "http://localhost:8000/v1",
  apiKey: "tma_sk_live_...",
});`}
        </DocCode>
      </DocSection>
    </DocPage>
  );
}
