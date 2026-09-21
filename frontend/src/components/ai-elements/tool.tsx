"use client";

import {
  CheckCircleIcon,
  ChevronDownIcon,
  CircleIcon,
  ClockIcon,
  WrenchIcon,
  XCircleIcon,
} from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { isValidElement } from "react";
import { Badge } from "@/components/ui/primitives";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "./collapsible";
import { CodeBlock } from "./code-block";
import { cn } from "@/lib/utils";

/**
 * Tool execution states (AI SDK naming) so a future tool-calling backend can
 * feed this component without translation.
 */
export type ToolState =
  | "input-streaming"
  | "input-available"
  | "output-available"
  | "output-error";

export type ToolProps = ComponentProps<typeof Collapsible>;

export const Tool = ({ className, ...props }: ToolProps) => (
  <Collapsible
    className={cn("group not-prose mb-4 w-full rounded-md border border-zinc-200 dark:border-zinc-800", className)}
    {...props}
  />
);

const statusLabels: Record<ToolState, string> = {
  "input-available": "Running",
  "input-streaming": "Pending",
  "output-available": "Completed",
  "output-error": "Error",
};

const statusIcons: Record<ToolState, ReactNode> = {
  "input-available": <ClockIcon className="size-4 animate-pulse" />,
  "input-streaming": <CircleIcon className="size-4" />,
  "output-available": <CheckCircleIcon className="size-4 text-green-600" />,
  "output-error": <XCircleIcon className="size-4 text-red-600" />,
};

export const getStatusBadge = (status: ToolState) => (
  <Badge className="gap-1.5 rounded-full text-xs" variant="secondary">
    {statusIcons[status]}
    {statusLabels[status]}
  </Badge>
);

export type ToolHeaderProps = {
  title?: string;
  className?: string;
  state: ToolState;
};

export const ToolHeader = ({ className, title, state, ...props }: ToolHeaderProps) => (
  <CollapsibleTrigger
    className={cn("flex w-full items-center justify-between gap-4 p-3", className)}
    {...props}
  >
    <div className="flex items-center gap-2">
      <WrenchIcon className="size-4 text-zinc-500 dark:text-zinc-400" />
      <span className="text-sm font-medium">{title ?? "Tool"}</span>
      {getStatusBadge(state)}
    </div>
    <ChevronDownIcon className="size-4 text-zinc-500 transition-transform group-data-[state=open]:rotate-180 dark:text-zinc-400" />
  </CollapsibleTrigger>
);

export type ToolContentProps = ComponentProps<typeof CollapsibleContent>;

export const ToolContent = ({ className, ...props }: ToolContentProps) => (
  <CollapsibleContent className={cn("space-y-4 p-4 text-sm outline-none", className)} {...props} />
);

export type ToolInputProps = ComponentProps<"div"> & {
  input: unknown;
};

export const ToolInput = ({ className, input, ...props }: ToolInputProps) => (
  <div className={cn("space-y-2 overflow-hidden", className)} {...props}>
    <h4 className="text-xs font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
      Parameters
    </h4>
    <div className="rounded-md bg-zinc-50 dark:bg-zinc-800/50">
      <CodeBlock bare code={JSON.stringify(input, null, 2)} language="json" />
    </div>
  </div>
);

export type ToolOutputProps = ComponentProps<"div"> & {
  output: unknown;
  errorText?: string;
};

export const ToolOutput = ({ className, output, errorText, ...props }: ToolOutputProps) => {
  if (!(output || errorText)) {
    return null;
  }

  let rendered: ReactNode = <div>{output as ReactNode}</div>;

  if (typeof output === "object" && !isValidElement(output)) {
    rendered = <CodeBlock bare code={JSON.stringify(output, null, 2)} language="json" />;
  } else if (typeof output === "string") {
    rendered = <CodeBlock bare code={output} language="json" />;
  }

  return (
    <div className={cn("space-y-2", className)} {...props}>
      <h4 className="text-xs font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
        {errorText ? "Error" : "Result"}
      </h4>
      <div
        className={cn(
          "overflow-x-auto rounded-md text-xs [&_table]:w-full",
          errorText ? "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300" : "bg-zinc-50 dark:bg-zinc-800/50",
        )}
      >
        {errorText && <div>{errorText}</div>}
        {rendered}
      </div>
    </div>
  );
};
