"use client";

import { PageHeader } from "@/components/ui";
import { DocCode, DocPage, DocSection } from "../components/DocBlock";

/** OpenAI-compatible surface: chat completions, models, streaming. */
export default function DocsOpenAIPage() {
  return (
    <DocPage testId="docs-openai-page">
      <PageHeader title="OpenAI Compatible" subtitle="POST /v1/chat/completions · GET /v1/models" />
      <DocSection title="Setup" testId="docs-openai-setup">
        <p>Install the SDK and point it at the gateway — no other change needed.</p>
        <DocCode testId="docs-openai-setup-code">
          {`pip install openai

from openai import OpenAI

client = OpenAI(base_url="http://localhost:8000/v1", api_key="tma_sk_live_...")`}
        </DocCode>
      </DocSection>
      <DocSection title="Chat completions" testId="docs-openai-chat">
        <p>Any provider behind any model id — Claude, Gemini, DeepSeek and GPT all answer the same shape.</p>
        <DocCode testId="docs-openai-code">
          {`completion = client.chat.completions.create(
    model="anthropic/claude-sonnet-4",  # any provider/model
    messages=[{"role": "user", "content": "Summarize tool use."}],
)
print(completion.choices[0].message.content)`}
        </DocCode>
      </DocSection>
      <DocSection title="Streaming" testId="docs-openai-stream">
        <p>Pass <code>stream=True</code> for OpenAI SSE chunks ending in <code>data: [DONE]</code>, with a terminal usage chunk.</p>
        <DocCode testId="docs-openai-stream-code">
          {`for chunk in client.chat.completions.create(
    model="deepseek/deepseek-r1",
    messages=[{"role": "user", "content": "Think step by step."}],
    stream=True,
):
    print(chunk.choices[0].delta.content or "", end="")`}
        </DocCode>
      </DocSection>
      <DocSection title="Models" testId="docs-openai-models">
        <p><code>GET /v1/models</code> lists only models the calling key may use, as <code>provider/model</code> ids. Unknown or disallowed models answer 403 <code>model_not_allowed</code>; ambiguous bare aliases answer 422 <code>ambiguous_model</code>.</p>
        <DocCode testId="docs-openai-models-code">
          {`curl http://localhost:8000/v1/models -H "Authorization: Bearer tma_sk_live_..."
# → {"data": [{"id": "openai/gpt-5", ...}, {"id": "anthropic/claude-sonnet-4", ...}]}`}
        </DocCode>
      </DocSection>
    </DocPage>
  );
}
