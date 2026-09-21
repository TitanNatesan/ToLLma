"use client";

import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

export interface MarkdownContentProps {
  content: string;
  className?: string;
}

/**
 * Reasoning/context markdown surface adapted from AI Elements `Streamdown`
 * usage. ToLLma normalized reasoning is GFM text, so the existing
 * react-markdown pipeline is reused instead of adding a second renderer.
 */
const MarkdownContentInner = ({ content, className }: MarkdownContentProps) => (
  <div className={cn("prose prose-sm max-w-none dark:prose-invert", className)}>
    <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
  </div>
);

export const MarkdownContent = memo(
  MarkdownContentInner,
  (prev, next) => prev.content === next.content && prev.className === next.className,
);
