"use client";

import { memo } from "react";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
  type ToolState,
} from "@/components/ai-elements/tool";

export type ToolStatus = "running" | "completed" | "failed";

export interface ToolCallProps {
  name: string;
  args?: unknown;
  result?: unknown;
  status: ToolStatus;
  durationMs?: number;
  error?: string;
}

const STATE_BY_STATUS: Record<ToolStatus, ToolState> = {
  running: "input-available",
  completed: "output-available",
  failed: "output-error",
};

/**
 * Tool execution card built on the AI Elements Tool primitives.
 * Ready for a future tool-calling backend: the three ToLLma statuses map onto
 * the AI SDK tool states without changing the rendering layer.
 */
function ToolCallInner({ name, args, result, status, error }: ToolCallProps) {
  return (
    <Tool data-testid="tool-call-block" defaultOpen={status !== "completed"}>
      <ToolHeader state={STATE_BY_STATUS[status]} title={name} />
      <ToolContent>
        {args !== undefined && <ToolInput input={args} />}
        <ToolOutput errorText={status === "failed" ? error ?? "Tool execution failed" : undefined} output={result} />
      </ToolContent>
    </Tool>
  );
}

export const ToolCall = memo(
  ToolCallInner,
  (prev, next) =>
    prev.name === next.name &&
    prev.status === next.status &&
    prev.args === next.args &&
    prev.result === next.result &&
    prev.error === next.error,
);
