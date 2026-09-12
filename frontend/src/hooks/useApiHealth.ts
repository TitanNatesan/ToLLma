"use client";

import { useCallback, useEffect, useState } from "react";
import { getLiveness, getReadiness } from "@/services/api";
import type { ApiState, HealthResponse } from "@/types";

export function useApiHealth() {
  const [liveness, setLiveness] = useState<ApiState<HealthResponse>>({ data: null, error: null, loading: true });
  const [readiness, setReadiness] = useState<ApiState<HealthResponse>>({ data: null, error: null, loading: true });

  const refresh = useCallback(async () => {
    setLiveness((s) => ({ ...s, loading: true, error: null }));
    setReadiness((s) => ({ ...s, loading: true, error: null }));
    try {
      setLiveness({ data: await getLiveness(), error: null, loading: false });
    } catch (e) {
      setLiveness({ data: null, error: e instanceof Error ? e.message : "unknown error", loading: false });
    }
    try {
      setReadiness({ data: await getReadiness(), error: null, loading: false });
    } catch (e) {
      setReadiness({ data: null, error: e instanceof Error ? e.message : "unknown error", loading: false });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { liveness, readiness, refresh };
}
