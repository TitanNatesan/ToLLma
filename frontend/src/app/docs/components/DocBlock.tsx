"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import { PageContainer } from "@/components/ui/PageContainer";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { DocsNav } from "./DocsNav";
import { SidebarPanelPortal } from "@/components/Sidebar/SidebarPanelPortal";
import { copyTextToClipboard } from "@/lib/clipboard";
import type { ReactNode } from "react";

export function DocPage({ children, testId }: { children: ReactNode; testId: string }) {
  return (
    <PageContainer testId={testId} maxWidth="max-w-[1080px]">
      <SidebarPanelPortal>
        <nav aria-label="Documentation" className="flex flex-col gap-2">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Documentation
          </h2>
          <DocsNav />
        </nav>
      </SidebarPanelPortal>
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </PageContainer>
  );
}

export function DocSection({
  title,
  children,
  testId,
}: {
  title: string;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <section
      data-testid={testId}
      className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
    >
      <SectionHeader title={title} />
      <div className="mt-2 flex flex-col gap-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
        {children}
      </div>
    </section>
  );
}

export function DocCode({ children, testId }: { children: string; testId?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    const ok = await copyTextToClipboard(children);
    if (!ok) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div className="relative">
      <pre
        data-testid={testId}
        className={cn(
          "overflow-x-auto rounded-lg bg-zinc-950 p-3 pr-11 font-mono text-[11px] leading-relaxed",
          "text-zinc-100 dark:bg-zinc-900",
        )}
      >
        <code>{children}</code>
      </pre>
      <button
        type="button"
        onClick={() => void copy()}
        aria-label={copied ? "Copied" : "Copy code"}
        title={copied ? "Copied" : "Copy code"}
        data-testid={testId ? `${testId}-copy` : "doc-code-copy"}
        className={cn(
          "absolute top-2 right-2 flex size-7 items-center justify-center rounded-md transition-colors",
          copied
            ? "text-tollma-400"
            : "text-zinc-400 hover:bg-white/10 hover:text-zinc-100",
        )}
      >
        {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
      </button>
    </div>
  );
}
