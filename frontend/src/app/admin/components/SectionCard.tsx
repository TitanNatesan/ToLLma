"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { SectionHeader } from "@/components/ui/SectionHeader";

export interface SectionCardProps {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  testId?: string;
}

/** Admin section shell: small uppercase label, optional actions, card body. */
export function SectionCard({ title, description, action, children, className, testId }: SectionCardProps) {
  return (
    <section
      className={cn(
        "rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950",
        className,
      )}
      data-testid={testId}
    >
      <SectionHeader title={title} description={description} action={action} tone="label" className="mb-4" />
      {children}
    </section>
  );
}
