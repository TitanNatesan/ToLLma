"use client";

import {
  Activity,
  Clock,
  Cpu,
  Database,
  Gauge,
  HardDrive,
  MemoryStick,
  Percent,
  Server,
  Timer,
  Workflow,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAdminHealthStream } from "@/hooks/useAdminHealthStream";
import { SectionCard } from "./SectionCard";
import { HealthChecksList, StatusPill } from "./HealthPanel";
import { KpiCard } from "./KpiCard";
import { LiveHealthCharts } from "./LiveHealthCharts";
import { fmtDateTime, fmtMs, fmtNumber, fmtPercent, fmtUptime } from "./format";
import type { AdminHealth, AdminHealthCheck, LiveHealthStreamStatus } from "@/types/admin";

const DASH = "—";

const STATUS_DISPLAY: Record<
  LiveHealthStreamStatus,
  { label: string; dot: string; text: string; pulse?: boolean }
> = {
  connecting: {
    label: "Connecting…",
    dot: "bg-zinc-400",
    text: "text-zinc-500 dark:text-zinc-400",
  },
  live: {
    label: "Live",
    dot: "bg-tollma-500",
    text: "text-tollma-700 dark:text-tollma-300",
    pulse: true,
  },
  reconnecting: {
    label: "Reconnecting…",
    dot: "bg-amber-500",
    text: "text-amber-700 dark:text-amber-300",
    pulse: true,
  },
  disconnected: {
    label: "Disconnected",
    dot: "bg-red-500",
    text: "text-red-700 dark:text-red-300",
  },
};

/** SSE connection badge: Live (green pulse) / Reconnecting / Disconnected. */
function LiveStatusBadge({ status }: { status: LiveHealthStreamStatus }) {
  const badge = STATUS_DISPLAY[status];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider",
        badge.text,
      )}
      data-testid="admin-health-stream-status"
    >
      <span className={cn("size-2 shrink-0 rounded-full", badge.dot, badge.pulse && "animate-pulse")} />
      {badge.label}
    </span>
  );
}

/** Snapshot fallback for a dependency status when the stream has no sample yet. */
function checkFallback(checks: AdminHealthCheck[], names: string[]): string | null {
  const match = checks.find((check) => names.some((name) => check.name.toLowerCase().includes(name)));
  return match?.status ?? null;
}

/** Health tab: live SSE telemetry with snapshot fallbacks and probe checks. */
export function HealthSection({ data }: { data: AdminHealth }) {
  const { samples, latest, status, error } = useAdminHealthStream();
  const server = latest?.server;
  const process = latest?.process;
  const database = latest?.database;
  const cache = latest?.cache;
  const queue = latest?.queue;

  const databaseStatus =
    database?.status ?? checkFallback(data.checks, ["database", "postgres", "sql"]) ?? data.status;
  const cacheStatus = cache?.status ?? checkFallback(data.checks, ["cache", "valkey", "redis"]) ?? data.status;

  return (
    <div className="space-y-4">
      <div
        className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950"
        data-testid="admin-health-banner"
      >
        <div className="flex items-center gap-3">
          <LiveStatusBadge status={status} />
          <div>
            <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Live platform telemetry</p>
            <p className="text-[11px] text-zinc-400" data-testid="admin-health-stream-timestamp">
              {latest ? `Last sample ${fmtDateTime(latest.timestamp)}` : "Waiting for the first live sample"}
              {" · "}uptime {fmtUptime(latest?.process.backend_uptime_seconds ?? data.uptime_seconds)}
              {" · "}snapshot {fmtDateTime(data.checked_at)}
              {" · "}
              <span data-testid="admin-health-stream-samples">{samples.length} samples</span>
            </p>
          </div>
        </div>
        {error && (
          <p className="text-[11px] text-red-600 dark:text-red-400" data-testid="admin-health-stream-error">
            {error}
          </p>
        )}
      </div>

      <SectionCard
        title="System"
        description="Host resource utilisation, sampled every 2 seconds."
        testId="admin-health-system"
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            label="CPU"
            value={fmtPercent(server?.cpu_percent)}
            sub={server ? "Live sample" : "Awaiting live sample"}
            icon={<Cpu className="size-4" />}
            testId="admin-health-cpu"
          />
          <KpiCard
            label="Memory"
            value={fmtPercent(server?.memory_percent)}
            sub={
              server
                ? `${fmtNumber(server.memory_used_mb)} / ${fmtNumber(server.memory_total_mb)} MB`
                : "Awaiting live sample"
            }
            icon={<MemoryStick className="size-4" />}
            testId="admin-health-memory"
          />
          <KpiCard
            label="Disk"
            value={fmtPercent(server?.disk_percent)}
            sub={
              server
                ? `${server.disk_used_gb.toFixed(1)} / ${server.disk_total_gb.toFixed(1)} GB`
                : "Awaiting live sample"
            }
            icon={<HardDrive className="size-4" />}
            testId="admin-health-disk"
          />
          <KpiCard
            label="Load average"
            value={server ? server.load_average.toFixed(2) : DASH}
            sub={server ? "1-minute load" : "Awaiting live sample"}
            icon={<Gauge className="size-4" />}
            testId="admin-health-load"
          />
        </div>
      </SectionCard>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <SectionCard
          title="Backend"
          description="Process health and in-flight work."
          testId="admin-health-backend"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <KpiCard
              label="Uptime"
              value={fmtUptime(latest?.process.backend_uptime_seconds ?? data.uptime_seconds)}
              sub={latest ? "Live sample" : "Snapshot fallback"}
              icon={<Server className="size-4" />}
              testId="admin-health-uptime"
            />
            <KpiCard
              label="Active requests"
              value={process ? fmtNumber(process.active_requests) : DASH}
              sub={process ? "Live sample" : "Awaiting live sample"}
              icon={<Workflow className="size-4" />}
              testId="admin-health-active-requests"
            />
            <KpiCard
              label="Active generations"
              value={fmtNumber(latest?.process.active_generations ?? data.active_generations)}
              sub={latest ? "Live sample" : "Snapshot fallback"}
              icon={<Activity className="size-4" />}
              testId="admin-health-active-generations"
            />
          </div>
        </SectionCard>

        <SectionCard
          title="Database"
          description="Connection pool and probe latency."
          testId="admin-health-database"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <KpiCard
              label="Status"
              value={<StatusPill status={databaseStatus} />}
              sub={database ? "Live sample" : "Snapshot fallback"}
              icon={<Database className="size-4" />}
              testId="admin-health-db-status"
            />
            <KpiCard
              label="Connections"
              value={database ? fmtNumber(database.connections) : DASH}
              sub={database ? "Live sample" : "Awaiting live sample"}
              icon={<Workflow className="size-4" />}
              testId="admin-health-db-connections"
            />
            <KpiCard
              label="Latency"
              value={fmtMs(latest?.database.latency_ms ?? data.avg_latency_ms)}
              sub={`p95 ${fmtMs(data.p95_latency_ms)}`}
              icon={<Timer className="size-4" />}
              testId="admin-health-db-latency"
            />
          </div>
        </SectionCard>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <SectionCard title="Cache" description="Shared cache status and footprint." testId="admin-health-cache">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <KpiCard
              label="Status"
              value={<StatusPill status={cacheStatus} />}
              sub={cache ? "Live sample" : "Snapshot fallback"}
              icon={<MemoryStick className="size-4" />}
              testId="admin-health-cache-status"
            />
            <KpiCard
              label="Memory"
              value={cache ? `${fmtNumber(cache.memory_mb)} MB` : DASH}
              sub={cache ? "Live sample" : "Awaiting live sample"}
              icon={<MemoryStick className="size-4" />}
              testId="admin-health-cache-memory"
            />
          </div>
        </SectionCard>

        <SectionCard title="Queue" description="Background job backlog." testId="admin-health-queue">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <KpiCard
              label="Pending jobs"
              value={queue ? fmtNumber(queue.pending_jobs) : DASH}
              sub={queue ? "Live sample" : "Awaiting live sample"}
              icon={<Clock className="size-4" />}
              testId="admin-health-queue-pending"
            />
            <KpiCard
              label="Running jobs"
              value={queue ? fmtNumber(queue.running_jobs) : DASH}
              sub={queue ? "Live sample" : "Awaiting live sample"}
              icon={<Workflow className="size-4" />}
              testId="admin-health-queue-running"
            />
          </div>
        </SectionCard>
      </div>

      <SectionCard
        title="Live charts"
        description="Rolling window of the last 60 samples (≈2 minutes)."
        testId="admin-health-charts-card"
      >
        <LiveHealthCharts samples={samples} />
      </SectionCard>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Active generations (snapshot)"
          value={fmtNumber(data.active_generations)}
          icon={<Activity className="size-4" />}
          testId="admin-health-snapshot-active-generations"
        />
        <KpiCard
          label="Avg latency"
          value={fmtMs(data.avg_latency_ms)}
          icon={<Gauge className="size-4" />}
          testId="admin-health-avg-latency"
        />
        <KpiCard
          label="P95 latency"
          value={fmtMs(data.p95_latency_ms)}
          icon={<Timer className="size-4" />}
          testId="admin-health-p95-latency"
        />
        <KpiCard
          label="Error rate (1h)"
          value={fmtPercent(data.error_rate_1h)}
          goodDirection="down"
          icon={<Percent className="size-4" />}
          testId="admin-health-error-rate"
        />
      </div>

      <SectionCard
        title="Checks"
        description="Backend dependency probes."
        testId="admin-health-checks-card"
        action={
          <span className="flex items-center gap-1.5 text-[10px] text-zinc-400">
            <Clock className="size-3" />
            {fmtDateTime(data.checked_at)}
          </span>
        }
      >
        <HealthChecksList checks={data.checks} />
      </SectionCard>
    </div>
  );
}
