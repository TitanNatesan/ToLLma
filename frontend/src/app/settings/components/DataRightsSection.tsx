"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { Badge, Button, EmptyState, ErrorState, LoadingState, Select, SettingItem, Textarea } from "@/components/ui";
import { toast } from "@/lib/notify";
import { parseApiError, toastApiError } from "@/lib/errors";
import { listDSRs, requestFullExport, submitDSR } from "@/services/trust";
import type { DSRType } from "@/types/trust";

const DSR_TYPES: Array<{ value: DSRType; label: string }> = [
  { value: "access", label: "Access — get a copy of my data" },
  { value: "correction", label: "Correction — fix inaccurate data" },
  { value: "erasure", label: "Erasure — delete my data" },
  { value: "portability", label: "Portability — machine-readable export" },
  { value: "grievance", label: "Grievance — escalate a complaint" },
];

export function dsrQueryKey() {
  return ["trust", "privacy", "dsr"] as const;
}

function statusVariant(status: string): "success" | "secondary" | "warning" | "destructive" {
  if (status === "fulfilled" || status === "partially_fulfilled") return "success";
  if (status === "rejected") return "destructive";
  if (status === "submitted") return "secondary";
  return "warning";
}

/** DSR export + request status + delete-request entry (DangerZone owns erasure). */
export function DataRightsSection() {
  const queryClient = useQueryClient();
  const [dsrType, setDsrType] = useState<DSRType>("access");
  const [detail, setDetail] = useState("");

  const dsrs = useQuery({ queryKey: dsrQueryKey(), queryFn: listDSRs, retry: false });

  const exportData = useMutation({
    mutationFn: requestFullExport,
    onSuccess: (payload) => {
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = "tollma-account-export.json";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(href);
      toast.success("Account export downloaded");
    },
    onError: (e) => {
      toastApiError(e, { title: "Export failed" });
    },
  });

  const submit = useMutation({
    mutationFn: () => submitDSR(dsrType, detail.trim()),
    onSuccess: (dsr) => {
      toast.success(`Request submitted — due ${dsr.due_at}`);
      setDetail("");
      void queryClient.invalidateQueries({ queryKey: dsrQueryKey() });
    },
    onError: (e) => {
      toastApiError(e, { title: "Could not submit request" });
    },
  });

  return (
    <div data-testid="privacy-data-rights">
      <SettingItem label="Export my data" description="Download a JSON copy of your account data.">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={exportData.isPending}
          onClick={() => exportData.mutate()}
          data-testid="dsr-export"
          className="gap-1.5"
        >
          <Download className="size-3.5" aria-hidden="true" />
          {exportData.isPending ? "Preparing…" : "Download export"}
        </Button>
      </SettingItem>

      <div className="py-2" data-testid="dsr-list">
        <p className="pb-1 text-xs font-medium text-zinc-800 dark:text-zinc-200">My requests</p>
        {dsrs.isPending ? (
          <LoadingState message="Loading requests…" />
        ) : dsrs.isError ? (
          <ErrorState
            title="Could not load requests"
            message={parseApiError(dsrs.error).message}
            onRetry={() => void dsrs.refetch()}
          />
        ) : (dsrs.data ?? []).length === 0 ? (
          <EmptyState
            title="No requests yet"
            description="Submit a request below to exercise your data rights."
            testId="dsr-empty"
          />
        ) : (
          <ul className="space-y-1.5">
            {(dsrs.data ?? []).map((dsr) => (
              <li
                key={dsr.id}
                data-testid={`dsr-${dsr.id}`}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-100 px-3 py-2 text-xs dark:border-zinc-900"
              >
                <span className="font-medium capitalize text-zinc-800 dark:text-zinc-200">{dsr.type}</span>
                <Badge variant={statusVariant(dsr.status)}>{dsr.status.replace(/_/g, " ")}</Badge>
                <span className="text-[11px] text-zinc-400">due {dsr.due_at}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <form
        className="flex flex-col gap-2 border-t border-zinc-100 pt-3 dark:border-zinc-800/60"
        data-testid="dsr-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!submit.isPending) submit.mutate();
        }}
      >
        <p className="text-xs font-medium text-zinc-800 dark:text-zinc-200">New request</p>
        <Select
          value={dsrType}
          onChange={(e) => setDsrType(e.target.value as DSRType)}
          data-testid="dsr-type"
          className="max-w-xs text-xs"
          aria-label="Request type"
        >
          {DSR_TYPES.map(({ value, label }) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
        <Textarea
          value={detail}
          onChange={(e) => setDetail(e.target.value)}
          placeholder="Details that help us act (optional, max 4000 chars)"
          data-testid="dsr-detail"
          className="min-h-16 text-xs"
        />
        <div>
          <Button type="submit" size="sm" disabled={submit.isPending} data-testid="dsr-submit">
            {submit.isPending ? "Submitting…" : "Submit request"}
          </Button>
        </div>
      </form>

      <div className="flex items-center justify-between gap-3 border-t border-zinc-100 pt-3 dark:border-zinc-800/60">
        <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
          Full account deletion lives in the danger zone below.
        </p>
        <Button type="button" variant="outline" size="sm" asChild data-testid="dsr-goto-danger">
          <a href="#danger-zone">Go to danger zone</a>
        </Button>
      </div>
    </div>
  );
}
