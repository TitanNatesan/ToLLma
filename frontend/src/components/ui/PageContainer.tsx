import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Shared page shell: scrollable main (px-4 py-4, scroll-smooth) + inner
 * content column (gap-4, pb-10). The header slot renders flush at the top so
 * a sticky PageHeader pins against the scroll container.
 */
export function PageContainer({
  header,
  children,
  testId,
  dense,
  maxWidth,
  className,
  contentClassName,
}: {
  header?: ReactNode;
  children: ReactNode;
  testId?: string;
  /** Compact rhythm when true (tighter gaps); roomy by default. Kept name to avoid churn. */
  dense?: boolean;
  /** Optional centered width token, e.g. "max-w-2xl". */
  maxWidth?: string;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className={cn(
        "flex min-w-0 flex-1 flex-col overflow-y-auto scroll-smooth bg-white px-4 py-4 dark:bg-zinc-950",
        className,
      )}
      data-testid={testId}
    >
      {header}
      <div
        className={
          contentClassName ??
          cn(
            dense
              ? "mt-4 flex min-w-0 flex-1 flex-col gap-4 pb-10"
              : "mt-6 flex min-w-0 flex-1 flex-col gap-6 pb-12",
            maxWidth && `mx-auto w-full ${maxWidth}`,
          )
        }
      >
        {children}
      </div>
    </main>
  );
}
