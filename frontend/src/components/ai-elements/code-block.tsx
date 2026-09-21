"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

export interface CodeBlockProps {
  code: string;
  language?: string;
  className?: string;
  /** Hide the header bar (language + copy) for compact embeds. */
  bare?: boolean;
}

/** ToLLma-styled code block used by AI Elements tool/context surfaces. */
export function CodeBlock({ code, language = "code", className, bare = false }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    void navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div
      className={cn(
        "relative my-2 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950",
        className,
      )}
      data-testid="code-block"
    >
      {!bare && (
        <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900/50 px-3 py-1.5">
          <span className="font-mono text-[10px] text-zinc-500">{language}</span>
          <button
            type="button"
            onClick={handleCopy}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-white"
          >
            {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
            <span>{copied ? "Copied" : "Copy"}</span>
          </button>
        </div>
      )}
      <pre className="overflow-x-auto p-3 text-xs text-zinc-100">
        <code>{code}</code>
      </pre>
    </div>
  );
}
