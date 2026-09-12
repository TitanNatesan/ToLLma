"use client";

import { useQuery } from "@tanstack/react-query";
import { getLiveness, getReadiness } from "@/services/api";

export function useApiHealth() {
  const liveness = useQuery({ queryKey: ["health", "live"], queryFn: getLiveness, retry: false });
  const readiness = useQuery({ queryKey: ["health", "ready"], queryFn: getReadiness, retry: false });
  const refresh = () => {
    void liveness.refetch();
    void readiness.refetch();
  };
  return {
    liveness: { data: liveness.data ?? null, error: liveness.error ? String(liveness.error) : null, loading: liveness.isLoading },
    readiness: { data: readiness.data ?? null, error: readiness.error ? String(readiness.error) : null, loading: readiness.isLoading },
    refresh,
  };
}
