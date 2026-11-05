"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { isBenchmarkStatus, listBenchmarkRuns } from "@/services/benchmarks";

export const BENCHMARK_KEYS = {
  all: ["benchmarks"] as const,
  runs: (orgId?: string | null) => ["benchmarks", "runs", orgId ?? "personal"] as const,
};

const noRetryOn404 = (count: number, e: unknown) =>
  isBenchmarkStatus(e, 404) ? false : count < 1;

/** Cursor-paginated benchmark runs (tooling-recorded; read-only in UI). */
export function useBenchmarkRuns(orgId?: string | null, limit = 25, enabled = true) {
  return useInfiniteQuery({
    queryKey: BENCHMARK_KEYS.runs(orgId ?? undefined),
    queryFn: ({ pageParam }) =>
      listBenchmarkRuns({ org_id: orgId ?? undefined, limit, cursor: pageParam as string | undefined }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    retry: noRetryOn404,
  });
}
