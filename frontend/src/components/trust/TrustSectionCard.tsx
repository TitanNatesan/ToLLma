"use client";

import Link from "next/link";
import type { ComponentType } from "react";
import { ArrowRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui";

/** Thin hub-card wrapper: Card + icon + title + blurb + link. No new tokens. */
export function TrustSectionCard({
  href,
  icon: Icon,
  title,
  description,
  testId,
}: {
  href: string;
  icon: ComponentType<{ className?: string }>;
  title: string;
  description: string;
  testId: string;
}) {
  return (
    <Link href={href} data-testid={testId} className="block rounded-lg focus-visible:outline-none">
      <Card className="h-full transition-colors hover:border-zinc-300 dark:hover:border-zinc-700">
        <CardContent className="flex items-start gap-3 pt-4">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-tollma-50 text-tollma-700 dark:bg-tollma-950/50 dark:text-tollma-300">
            <Icon className="size-4" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {title}
              <ArrowRight className="size-3.5 text-zinc-400" aria-hidden="true" />
            </span>
            <span className="mt-0.5 block text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
              {description}
            </span>
          </span>
        </CardContent>
      </Card>
    </Link>
  );
}
