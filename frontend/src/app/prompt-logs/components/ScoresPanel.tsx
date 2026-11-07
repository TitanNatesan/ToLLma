"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Star } from "lucide-react";
import { Badge, Button, EmptyState, ErrorState, Input, LoadingState, Select } from "@/components/ui";
import { toast } from "@/lib/notify";
import { parseApiError } from "@/lib/errors";
import {
  SCORE_DATA_TYPES,
  createScore,
  deleteScore,
  listScores,
  type ScoreRead,
} from "@/services/promptLogs";
import {
  EMPTY_SCORE_FORM,
  scoreValueLabel,
  validateScoreForm,
  type ScoreForm,
} from "./promptLogLogic";

function scoreSubject(input: { logId: string; traceId: string | null; sessionKey: string | null }) {
  return {
    prompt_log_id: input.logId,
    trace_id: input.traceId,
    session_key: input.sessionKey,
  };
}

/**
 * Human scores for one log/trace. Rendered inside the log detail drawer:
 * listing needs only Read (the drawer itself implies the row is visible),
 * deletion needs Manage (server-enforced; the button hides without it).
 */
export function ScoresPanel({
  logId,
  traceId,
  sessionKey,
  orgId,
  canDelete,
}: {
  logId: string;
  traceId: string | null;
  sessionKey: string | null;
  orgId?: string;
  canDelete: boolean;
}) {
  const qc = useQueryClient();
  const subjectKey = traceId ?? logId;
  const scores = useQuery({
    // One query per subject: trace scope covers the whole trace (including
    // this log); without a trace fall back to the log id.
    queryKey: ["prompt-logs", "scores", orgId ?? "personal", subjectKey],
    queryFn: () =>
      listScores(
        traceId
          ? { org_id: orgId, trace_id: traceId }
          : { org_id: orgId, prompt_log_id: logId },
      ),
    staleTime: 0,
  });
  const [form, setForm] = useState<ScoreForm>(EMPTY_SCORE_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const invalidate = () =>
    void qc.invalidateQueries({ queryKey: ["prompt-logs", "scores"] });

  const add = useMutation({
    mutationFn: () => {
      const err = validateScoreForm(form);
      if (err) throw new Error(err);
      const trimmed = form.value.trim();
      return createScore(
        {
          name: form.name.trim(),
          data_type: form.data_type,
          ...(form.data_type === "numeric"
            ? { value_num: Number(trimmed) }
            : { value_text: trimmed }),
          ...scoreSubject({ logId, traceId, sessionKey }),
          comment: form.comment.trim() || null,
        },
        orgId,
      );
    },
    onSuccess: () => {
      setForm(EMPTY_SCORE_FORM);
      setFormError(null);
      invalidate();
      toast.success("Score added.");
    },
    onError: (e) => setFormError(parseApiError(e).message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteScore(id, orgId),
    onSuccess: () => {
      setConfirmId(null);
      invalidate();
      toast.success("Score deleted.");
    },
    onError: (e) => toast.error(parseApiError(e).message),
  });

  function set<K extends keyof ScoreForm>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  const items: ScoreRead[] = scores.data ?? [];

  return (
    <div className="space-y-3" data-testid="prompt-log-scores">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
        Scores{traceId ? " · this trace" : ""}
      </h3>
      {scores.isPending ? (
        <LoadingState message="Loading scores…" />
      ) : scores.error ? (
        <ErrorState
          title="Could not load scores"
          message={parseApiError(scores.error).message}
          onRetry={() => void scores.refetch()}
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon={Star}
          title="No scores yet"
          description={traceId ? "No human scores on this trace." : "No human scores on this log."}
          testId="prompt-log-scores-empty"
        />
      ) : (
        <ul className="space-y-1.5">
          {items.map((s) => (
            <li
              key={s.id}
              className="flex items-center gap-2 rounded-lg border border-zinc-200 p-2 dark:border-zinc-800"
              data-testid={`prompt-log-score-${s.id}`}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-zinc-900 dark:text-zinc-100">
                  {s.name}
                  <span className="ml-1.5 font-mono text-zinc-500">{scoreValueLabel(s)}</span>
                </p>
                {s.comment ? (
                  <p className="truncate text-[11px] text-zinc-500">{s.comment}</p>
                ) : null}
              </div>
              <Badge variant="secondary">{s.data_type}</Badge>
              {canDelete &&
                (confirmId === s.id ? (
                  <span className="flex gap-1">
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={remove.isPending}
                      onClick={() => remove.mutate(s.id)}
                      data-testid={`prompt-log-score-confirm-${s.id}`}
                    >
                      Confirm
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setConfirmId(null)}>
                      Keep
                    </Button>
                  </span>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setConfirmId(s.id)}
                    data-testid={`prompt-log-score-delete-${s.id}`}
                  >
                    Delete
                  </Button>
                ))}
            </li>
          ))}
        </ul>
      )}

      <form
        className="space-y-2 rounded-lg border border-zinc-200 p-2.5 dark:border-zinc-800"
        onSubmit={(e) => {
          e.preventDefault();
          const err = validateScoreForm(form);
          setFormError(err);
          if (!err) add.mutate();
        }}
      >
        <div className="flex gap-2">
          <Input
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="Score name (e.g. helpfulness)"
            aria-label="Score name"
            className="h-8 flex-1 text-xs"
            data-testid="prompt-log-score-name"
          />
          <Select
            value={form.data_type}
            onChange={(e) => set("data_type", e.target.value)}
            aria-label="Score type"
            data-testid="prompt-log-score-type"
            wrapperClassName="w-32"
          >
            {SCORE_DATA_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex gap-2">
          <Input
            value={form.value}
            onChange={(e) => set("value", e.target.value)}
            placeholder={form.data_type === "numeric" ? "Value (number)" : "Value"}
            aria-label="Score value"
            className="h-8 flex-1 text-xs"
            data-testid="prompt-log-score-value"
          />
          <Button
            size="sm"
            type="submit"
            disabled={add.isPending}
            data-testid="prompt-log-score-add"
          >
            {add.isPending ? "Adding…" : "Add score"}
          </Button>
        </div>
        <Input
          value={form.comment}
          onChange={(e) => set("comment", e.target.value)}
          placeholder="Comment (optional)"
          aria-label="Score comment"
          className="h-8 w-full text-xs"
          data-testid="prompt-log-score-comment"
        />
        {formError ? (
          <p className="text-[11px] text-red-600 dark:text-red-400" data-testid="prompt-log-score-error">
            {formError}
          </p>
        ) : null}
      </form>
    </div>
  );
}
