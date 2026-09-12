"use client";

import { useRef } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import type { ChatMessage } from "@/types";
import { cn } from "@/lib/utils";
import "highlight.js/styles/github-dark.css";

function copyText(text: string) {
  void navigator.clipboard.writeText(text).catch(() => {});
}

function CodeBlock({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLPreElement>(null);
  return (
    <div className="relative">
      <button
        className="absolute right-2 top-2 rounded bg-zinc-700 px-2 py-0.5 text-xs text-white"
        onClick={() => copyText(ref.current?.innerText ?? "")}
        title="Copy code"
      >
        Copy
      </button>
      <pre ref={ref} className="overflow-x-auto rounded-md bg-zinc-900 p-3 text-sm text-zinc-100">
        {children}
      </pre>
    </div>
  );
}

export function MessageView({ message }: { message: ChatMessage }) {
  const mine = message.role === "user";
  return (
    <div className={cn("flex flex-col gap-1 rounded-lg p-3", mine ? "bg-zinc-100 dark:bg-zinc-800" : "")} data-testid={`message-${message.role}`}>
      <div className="flex items-center gap-2 text-xs text-zinc-500">
        <span className="font-semibold uppercase">{message.role}</span>
        <time dateTime={message.created_at} title={message.created_at}>
          {new Date(message.created_at).toLocaleString()}
        </time>
        {message.total_tokens != null && (
          <span title={`in ${message.prompt_tokens} / out ${message.completion_tokens}`}>
            {message.total_tokens} tok · ${message.total_cost}
          </span>
        )}
        <button className="ml-auto" title="Copy message" onClick={() => copyText(message.content)}>
          Copy
        </button>
      </div>
      <div className="prose prose-sm max-w-none dark:prose-invert">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeHighlight]}
          components={{ pre: ({ children }) => <CodeBlock>{children}</CodeBlock> }}
        >
          {message.content}
        </ReactMarkdown>
      </div>
    </div>
  );
}
