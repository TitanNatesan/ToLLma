"use client";

import { PageHeader } from "@/components/ui";
import { DocCode, DocPage, DocSection } from "../components/DocBlock";

/** Anthropic-compatible surface: POST /v1/messages against any provider. */
export default function DocsAnthropicPage() {
  return (
    <DocPage testId="docs-anthropic-page">
      <PageHeader title="Anthropic Compatible" subtitle="POST /v1/messages · any provider out" />
      <DocSection title="Setup" testId="docs-anthropic-setup">
        <p>Install the SDK and point it at the gateway. The <code>anthropic-version</code> header is accepted but optional.</p>
        <DocCode testId="docs-anthropic-setup-code">
          {`pip install anthropic

import anthropic

client = anthropic.Anthropic(
    base_url="http://localhost:8000/v1", api_key="tma_sk_live_..."
)`}
        </DocCode>
      </DocSection>
      <DocSection title="Messages" testId="docs-anthropic-messages">
        <p>Send the Anthropic payload with any model — GPT, DeepSeek, Gemini or Claude answer the Anthropic shape.</p>
        <DocCode testId="docs-anthropic-code">
          {`message = client.messages.create(
    model="openai/gpt-5",  # Anthropic payload in, any provider out
    max_tokens=256,
    messages=[{"role": "user", "content": "Hello!"}],
)
print(message.content[0].text)`}
        </DocCode>
      </DocSection>
      <DocSection title="Streaming" testId="docs-anthropic-stream">
        <p>Stream with the Anthropic event sequence (<code>message_start</code> … <code>message_stop</code>). Deltas arrive as <code>content_block_delta</code> events; the gateway closes with <code>message_stop</code>.</p>
        <DocCode testId="docs-anthropic-stream-code">
          {`with client.messages.stream(
    model="anthropic/claude-sonnet-4",
    max_tokens=256,
    messages=[{"role": "user", "content": "Hello!"}],
) as stream:
    for text in stream.text_stream:
        print(text, end="")`}
        </DocCode>
      </DocSection>
    </DocPage>
  );
}
