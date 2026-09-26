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
      <DocSection title="Images and video" testId="docs-advanced-media">
        <p><code>POST /v1/images/generations</code>, <code>/v1/images/edits</code> and <code>/v1/videos/generations</code> require models flagged for image/video generation — otherwise the gateway answers 403 <code>model_not_allowed</code>.</p>
      </DocSection>
      <DocSection title="Key identity" testId="docs-advanced-me">
        <p><code>GET /v1/me</code> returns the calling key, its allowed models and current spend versus budget.</p>
      </DocSection>
      <DocSection title="Other SDKs" testId="docs-advanced-sdks">
        <p>LangChain, LlamaIndex, CrewAI, Vercel AI SDK, OpenWebUI, Cursor, Continue and OpenHands all work by setting their OpenAI-compatible base URL to <code>http://localhost:8000/v1</code> with the API key.</p>
      </DocSection>
    </DocPage>
  );
}
