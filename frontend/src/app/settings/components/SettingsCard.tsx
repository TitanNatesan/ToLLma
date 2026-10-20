"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { SectionHeader } from "@/components/ui/SectionHeader";

/** Settings card shell: anchor target + heading + body. Matches analytics cards. */
export function SettingsCard({
  id,
  title,
  description,
  action,
  children,
  className,
  testId,
  active,
}: {
  id: string;
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  testId?: string;
  active?: boolean;
}) {
  return (
    <section
      id={id}
      className={cn(
        "scroll-mt-4 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950 data-[active=true]:border-zinc-900 dark:data-[active=true]:border-zinc-100",
        className,
      )}
      data-testid={testId ?? `settings-section-${id}`}
      data-active={active ? "true" : undefined}
      aria-current={active ? "page" : undefined}
    >
      <SectionHeader title={title} description={description} action={action} className="mb-4" />
      {children}
    </section>
  );
}
