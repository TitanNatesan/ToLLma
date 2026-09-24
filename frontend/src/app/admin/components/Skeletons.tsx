"use client";

/** Loading skeletons for admin tabs — same geometry as the loaded content. */

export function KpiGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="admin-kpi-skeleton">
      {Array.from({ length: count }).map((_, index) => (
        <div
          key={index}
          className="h-28 animate-pulse rounded-xl border border-zinc-200 bg-zinc-100/60 dark:border-zinc-800 dark:bg-zinc-900/60"
        />
      ))}
    </div>
  );
}

export function ChartSkeleton({ height = 260 }: { height?: number }) {
  return (
    <div
      className="w-full animate-pulse rounded-lg bg-zinc-100/60 dark:bg-zinc-900/60"
      style={{ height }}
      data-testid="admin-chart-skeleton"
    />
  );
}

export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-2" data-testid="admin-table-skeleton">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="h-8 animate-pulse rounded-md bg-zinc-100/60 dark:bg-zinc-900/60" />
      ))}
    </div>
  );
}

/** Default tab fallback: KPI tiles + one chart block. */
export function SectionSkeleton() {
  return (
    <div className="space-y-4">
      <KpiGridSkeleton count={4} />
      <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="mb-4 h-3 w-32 animate-pulse rounded bg-zinc-100 dark:bg-zinc-900" />
        <ChartSkeleton />
      </div>
    </div>
  );
}
