"use client";

import Link from "next/link";
import { StatusCard } from "@/components/StatusCard";
import { useApiHealth } from "@/hooks/useApiHealth";

export default function ApiTestPage() {
  const { liveness, readiness, refresh } = useApiHealth();
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-2xl font-semibold">API connectivity test</h1>
      <div className="grid gap-4 sm:grid-cols-2">
        <StatusCard title="GET /health" status={liveness.data?.status ?? null} detail={liveness.error} loading={liveness.loading} />
        <StatusCard
          title="GET /health/ready"
          status={readiness.data?.status ?? null}
          detail={readiness.error ?? readiness.data?.database ?? null}
          loading={readiness.loading}
        />
      </div>
      <button className="rounded-full border px-5 py-2" onClick={() => void refresh()}>
        Retry
      </button>
      <Link className="underline" href="/">
        Home
      </Link>
    </main>
  );
}
