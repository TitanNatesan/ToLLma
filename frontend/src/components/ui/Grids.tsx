import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Shared card grid: 1 col → sm:2 → xl:3 (organizations + permission sets). */
export function CardGrid({
  children,
  id,
  className,
  testId,
}: {
  children: ReactNode;
  id?: string;
  className?: string;
  testId?: string;
}) {
  return (
    <div id={id} className={cn("grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3", className)} data-testid={testId}>
      {children}
    </div>
  );
}

/**
 * Shared stat grid: 1 col → sm:2 → xl:4. Pass `xl` to override the wide
 * breakpoint (e.g. admin API-keys keeps xl:5 for its five KPIs).
 */
export function StatGrid({
  children,
  id,
  xl = "xl:grid-cols-4",
  className,
  testId,
}: {
  children: ReactNode;
  id?: string;
  xl?: string;
  className?: string;
  testId?: string;
}) {
  return (
    <div id={id} className={cn("grid grid-cols-1 gap-3 sm:grid-cols-2", xl, className)} data-testid={testId}>
      {children}
    </div>
  );
}
