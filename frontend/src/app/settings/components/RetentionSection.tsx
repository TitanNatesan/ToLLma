"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, ErrorState, Input, LoadingState, SettingItem, Switch } from "@/components/ui";
import { toast } from "@/lib/notify";
import { toastApiError } from "@/lib/errors";
import { listRetention, setRetention } from "@/services/trust";
import type { RetentionCategory, RetentionRead } from "@/types/trust";

const CATEGORIES: Array<{ category: RetentionCategory; label: string; description: string }> = [
  { category: "conversations", label: "Conversations", description: "Conversation records and metadata." },
  { category: "messages", label: "Messages", description: "Message content within conversations." },
  { category: "attachments", label: "Attachments", description: "Uploaded files and media." },
  { category: "prompt_logs", label: "Prompt logs", description: "Logged prompts and completions." },
  { category: "request_logs", label: "Request logs", description: "API request metadata." },
  { category: "guardrail_triggers", label: "Guardrail triggers", description: "Safety-check trigger records." },
  { category: "api_request_logs", label: "API request logs", description: "Gateway request log entries." },
];

export function retentionQueryKey() {
  return ["trust", "privacy", "retention"] as const;
}

function RetentionRow({ row, category, label, description }: { row?: RetentionRead; category: RetentionCategory; label: string; description: string }) {
  const queryClient = useQueryClient();
  const [days, setDays] = useState(row?.retention_days != null ? String(row.retention_days) : "");
  const [zero, setZero] = useState(row?.zero_retention ?? false);
  const save = useMutation({
    mutationFn: () =>
      setRetention(category, days.trim() === "" ? null : Math.max(1, Math.floor(Number(days))), zero),
    onSuccess: () => {
      toast.success(`${label} retention saved`);
      void queryClient.invalidateQueries({ queryKey: retentionQueryKey() });
    },
    onError: (e) => {
      toastApiError(e, { title: "Could not save retention" });
    },
  });

  return (
    <SettingItem label={label} description={description}>
      <div className="flex items-center gap-2" data-testid={`retention-row-${category}`}>
        <Input
          type="number"
          min={1}
          value={days}
          onChange={(e) => setDays(e.target.value)}
          placeholder="default"
          aria-label={`${label} retention days`}
          data-testid={`retention-days-${category}`}
          className="h-8 w-24 text-xs"
        />
        <span className="text-[11px] text-zinc-400">days</span>
        <Switch
          checked={zero}
          onCheckedChange={setZero}
          aria-label={`${label} zero retention`}
          data-testid={`retention-zero-${category}`}
        />
        <span className="text-[11px] text-zinc-400">none</span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={save.isPending}
          onClick={() => save.mutate()}
          data-testid={`retention-save-${category}`}
        >
          {save.isPending ? "Saving…" : "Save"}
        </Button>
      </div>
    </SettingItem>
  );
}

/** F9 personal retention controls. Org policy wins on conflict (server-enforced). */
export function RetentionSection() {
  const retention = useQuery({ queryKey: retentionQueryKey(), queryFn: listRetention, retry: false });

  if (retention.isPending) return <LoadingState message="Loading retention policy…" />;
  if (retention.isError) {
    return (
      <ErrorState
        title="Could not load retention policy"
        message="The privacy service is unavailable."
        onRetry={() => void retention.refetch()}
      />
    );
  }
  const byCategory = new Map((retention.data ?? []).map((row) => [row.data_category, row]));

  return (
    <div data-testid="privacy-retention">
      <p className="pb-1 text-[11px] text-zinc-500 dark:text-zinc-400">
        Blank days use the platform default; “none” skips capture entirely. Organization policy wins on conflict.
        Two clocks apply to prompt logs: this policy governs category retention and capture veto, while the
        Logging settings card stamps per-row body expiry at capture time (existing rows keep their old stamp).
        Bodies expire; metadata rows are kept. Prompt-log rows for other members need PromptLogs.Manage to change.
      </p>
      {CATEGORIES.map(({ category, label, description }) => (
        <RetentionRow key={category} row={byCategory.get(category)} category={category} label={label} description={description} />
      ))}
    </div>
  );
}
