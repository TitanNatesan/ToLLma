"use client";

import Link from "next/link";
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
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {[
          {
            href: "/docs/authentication",
            title: "Authentication",
            body: "API keys, budgets, rate limits and headers.",
          },
          {
            href: "/docs/openai",
            title: "OpenAI Compatible",
            body: "Chat completions, models, streaming and SDK setup.",
          },
          {
            href: "/docs/anthropic",
            title: "Anthropic Compatible",
            body: "Messages API with any provider behind it.",
          },
          {
            href: "/docs/advanced",
            title: "Responses, Media & Limits",
            body: "Responses API, images, videos, budgets and errors.",
          },
        ].map((card) => (
          <Link
            key={card.href}
            href={card.href}
            data-testid={`docs-card-${card.href.split("/").pop()}`}
            className="rounded-xl border border-zinc-200 p-4 transition-colors hover:border-tollma-500 dark:border-zinc-800 dark:hover:border-tollma-500"
          >
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{card.title}</h2>
            <p className="mt-1 text-xs text-zinc-500">{card.body}</p>
          </Link>
        ))}
      </div>
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
