"use client";

import { PageHeader } from "@/components/ui";
import { DocCode, DocPage, DocSection } from "./components/DocBlock";

/** API documentation index: auth, compatibility surfaces and SDK quickstarts. */
export default function DocsPage() {
  return (
    <DocPage testId="docs-page">
      <PageHeader
        title="API Reference"
        subtitle="One gateway, every SDK. Point any OpenAI- or Anthropic-compatible client at ToLLma."
      />
      <DocSection title="Setup" testId="docs-setup">
        <ol className="list-decimal space-y-1 pl-5">
          <li>Create a key at API Keys — it is shown once, then only a hash is stored.</li>
          <li>Point any compatible client at <code>http://localhost:8000/v1</code>.</li>
          <li>Send the key as <code>Authorization: Bearer</code> (or <code>x-api-key</code>).</li>
          <li>Pick a model as <code>provider/model</code>, e.g. <code>openai/gpt-5</code>.</li>
        </ol>
      </DocSection>
      <DocSection title="Quickstart">
        <DocCode testId="docs-quickstart-code">
          {`from openai import OpenAI

client = OpenAI(base_url="http://localhost:8000/v1", api_key="tma_sk_live_...")
response = client.chat.completions.create(
    model="my-provider/gpt-oss-20b",
    messages=[{"role": "user", "content": "Hello!"}],
)
print(response.choices[0].message.content)`}
        </DocCode>
      </DocSection>
    </DocPage>
  );
}
