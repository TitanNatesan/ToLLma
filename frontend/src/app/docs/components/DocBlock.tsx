import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { SectionHeader } from "@/components/ui/SectionHeader";

export function DocPage({ children, testId }: { children: ReactNode; testId: string }) {
  return (
    <main
      className="mx-auto flex min-w-0 w-full max-w-[960px] flex-1 flex-col gap-4 overflow-y-auto bg-white px-4 py-4 dark:bg-zinc-950"
      data-testid={testId}
    >
      {children}
    </main>
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
      <div className="mt-2 flex flex-col gap-2 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
        {children}
      </div>
    </section>
  );
}

export function DocCode({ children, testId }: { children: string; testId?: string }) {
  return (
    <pre
      data-testid={testId}
      className={cn(
        "overflow-x-auto rounded-lg bg-zinc-950 p-3 font-mono text-[11px] leading-relaxed",
        "text-zinc-100 dark:bg-zinc-900",
      )}
    >
      <code>{children}</code>
    </pre>
  );
}
