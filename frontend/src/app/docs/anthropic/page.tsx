"use client";

import { PageHeader } from "@/components/ui";
import { DocCode, DocPage, DocSection } from "../components/DocBlock";

/** Anthropic-compatible surface: POST /v1/messages against any provider. */
export default function DocsAnthropicPage() {
  return (
    <DocPage testId="docs-anthropic-page">
      <PageHeader title="Anthropic Compatible" subtitle="POST /v1/messages · any provider out" />
      <DocSection title="Messages" testId="docs-anthropic-messages">
        <p>Send the Anthropic payload with any model — GPT, DeepSeek, Gemini or Claude answer the Anthropic shape.</p>
        <DocCode testId="docs-anthropic-code">
          {`import anthropic

client = anthropic.Anthropic(
    base_url="http://localhost:8000/v1", api_key="tma_sk_live_..."
)
message = client.messages.create(
    model="openai/gpt-5",  # Anthropic payload in, any provider out
    max_tokens=256,
    messages=[{"role": "user", "content": "Hello!"}],
)
print(message.content[0].text)`}
        </DocCode>
      </DocSection>
      <DocSection title="Streaming" testId="docs-anthropic-stream">
        <p>Stream with the Anthropic event sequence (<code>message_start</code> … <code>message_stop</code>). The <code>anthropic-version</code> header is accepted but optional.</p>
      </DocSection>
    </DocPage>
  );
}
