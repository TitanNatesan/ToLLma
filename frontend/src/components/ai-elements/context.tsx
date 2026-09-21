"use client";

import {
  createContext,
  useContext,
  useMemo,
  type ComponentProps,
  type ReactNode,
} from "react";
import { Button } from "@/components/ui/primitives";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "./hover-card";
import { cn } from "@/lib/utils";

export interface ContextTokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
}

export interface ContextSchema {
  usedTokens?: number;
  maxTokens?: number;
  usage?: ContextTokenUsage;
  totalTokens?: number;
  cost?: number;
}

interface ContextContextValue {
  usedTokens: number;
  maxTokens: number;
  usage: ContextTokenUsage;
  totalTokens: number;
  cost?: number;
  percentUsed: number;
}

const ContextReact = createContext<ContextContextValue | null>(null);

const useContextValue = (): ContextContextValue => {
  const context = useContext(ContextReact);
  if (!context) {
    throw new Error("Context components must be used within <Context>");
  }
  return context;
};

export type ContextProps = ComponentProps<typeof HoverCard> & ContextSchema;

export const Context = ({
  usedTokens,
  maxTokens,
  usage,
  totalTokens,
  cost,
  children,
  ...props
}: ContextProps) => {
  const contextValue = useMemo<ContextContextValue>(() => {
    const resolvedUsage = usage ?? {};
    const resolvedUsed =
      usedTokens ??
      (resolvedUsage.inputTokens ?? 0) +
        (resolvedUsage.outputTokens ?? 0) +
        (resolvedUsage.reasoningTokens ?? 0) +
        (resolvedUsage.cachedInputTokens ?? 0);
    const resolvedMax = maxTokens ?? 0;
    return {
      usedTokens: resolvedUsed,
      maxTokens: resolvedMax,
      usage: resolvedUsage,
      totalTokens: totalTokens ?? resolvedUsed,
      cost,
      percentUsed: resolvedMax > 0 ? Math.min(100, (resolvedUsed / resolvedMax) * 100) : 0,
    };
  }, [usedTokens, maxTokens, usage, totalTokens, cost]);

  return (
    <ContextReact.Provider value={contextValue}>
      <HoverCard closeDelay={0} openDelay={0} {...props}>
        {children}
      </HoverCard>
    </ContextReact.Provider>
  );
};

export type ContextTriggerProps = ComponentProps<typeof Button>;

const formatPercent = (percentUsed: number) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 1, style: "percent" }).format(
    percentUsed / 100,
  );

export const ContextTrigger = ({ children, className, ...props }: ContextTriggerProps) => {
  const { usedTokens, maxTokens, percentUsed } = useContextValue();

  return (
    <HoverCardTrigger asChild>
      {children ?? (
        <Button
          className={cn("gap-1.5 rounded-full text-xs", className)}
          size="sm"
          type="button"
          variant="ghost"
          {...props}
        >
          <span className="font-medium text-zinc-500 dark:text-zinc-400">
            {formatPercent(percentUsed)}
          </span>
          <span className="text-zinc-400 dark:text-zinc-500">
            {maxTokens
              ? `${usedTokens.toLocaleString()} / ${maxTokens.toLocaleString()}`
              : usedTokens.toLocaleString()}
          </span>
        </Button>
      )}
    </HoverCardTrigger>
  );
};

export type ContextContentProps = ComponentProps<typeof HoverCardContent>;

export const ContextContent = ({ className, children, ...props }: ContextContentProps) => (
  <HoverCardContent
    className={cn("min-w-60 divide-y divide-zinc-100 overflow-hidden p-0 dark:divide-zinc-800", className)}
    {...props}
  >
    {children}
  </HoverCardContent>
);

export type ContextContentHeaderProps = ComponentProps<"div">;

export const ContextContentHeader = ({ children, className, ...props }: ContextContentHeaderProps) => {
  const { usedTokens, maxTokens, percentUsed } = useContextValue();

  return (
    <div className={cn("w-full space-y-2 p-3", className)} {...props}>
      {children ?? (
        <>
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Context usage</p>
            <span className="text-xs text-zinc-400 dark:text-zinc-500">
              {maxTokens
                ? `${usedTokens.toLocaleString()} / ${maxTokens.toLocaleString()}`
                : usedTokens.toLocaleString()}
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
            <div
              className="h-full rounded-full bg-tollma-500 transition-all"
              style={{ width: `${percentUsed}%` }}
            />
          </div>
          <p className="text-right text-[10px] text-zinc-400 tabular-nums dark:text-zinc-500">
            {formatPercent(percentUsed)}
          </p>
        </>
      )}
    </div>
  );
};

export type ContextContentBodyProps = ComponentProps<"div">;

export const ContextContentBody = ({ children, className, ...props }: ContextContentBodyProps) => (
  <div className={cn("w-full p-3", className)} {...props}>
    {children}
  </div>
);

export type ContextContentFooterProps = ComponentProps<"div">;

export const ContextContentFooter = ({ children, className, ...props }: ContextContentFooterProps) => {
  const { cost, totalTokens } = useContextValue();

  return (
    <div
      className={cn("flex w-full items-center justify-between gap-2 p-3 text-xs", className)}
      {...props}
    >
      {children ?? (
        <>
          <span className="text-zinc-500 dark:text-zinc-400">Total tokens</span>
          <span className="font-mono text-zinc-700 dark:text-zinc-200">
            {totalTokens.toLocaleString()}
            {cost !== undefined && ` · $${cost.toFixed(4)}`}
          </span>
        </>
      )}
    </div>
  );
};

type UsageRowProps = ComponentProps<"div"> & { children?: ReactNode };

const UsageRow = ({
  label,
  tokens,
  usedTokens,
  showPercent,
  className,
  children,
  ...props
}: UsageRowProps & { label: string; tokens: number; usedTokens?: number; showPercent?: boolean }) => {
  if (!tokens && !children) return null;

  return (
    <div className={cn("flex items-center justify-between gap-2 py-1 text-xs", className)} {...props}>
      {children ?? (
        <>
          <span className="text-zinc-500 dark:text-zinc-400">{label}</span>
          <span className="font-mono text-zinc-700 dark:text-zinc-200">
            {tokens.toLocaleString()}
            {showPercent && usedTokens ? ` (${((tokens / usedTokens) * 100).toFixed(0)}%)` : ""}
          </span>
        </>
      )}
    </div>
  );
};

export type ContextInputUsageProps = ComponentProps<"div">;

export const ContextInputUsage = (props: ContextInputUsageProps) => {
  const { usage, usedTokens } = useContextValue();
  return (
    <UsageRow
      {...props}
      label="Input"
      showPercent
      tokens={usage.inputTokens ?? 0}
      usedTokens={usedTokens}
    />
  );
};

export type ContextOutputUsageProps = ComponentProps<"div">;

export const ContextOutputUsage = (props: ContextOutputUsageProps) => {
  const { usage } = useContextValue();
  return <UsageRow {...props} label="Output" tokens={usage.outputTokens ?? 0} />;
};

export type ContextReasoningUsageProps = ComponentProps<"div">;

export const ContextReasoningUsage = (props: ContextReasoningUsageProps) => {
  const { usage } = useContextValue();
  return <UsageRow {...props} label="Reasoning" tokens={usage.reasoningTokens ?? 0} />;
};

export type ContextCacheUsageProps = ComponentProps<"div">;

export const ContextCacheUsage = (props: ContextCacheUsageProps) => {
  const { usage } = useContextValue();
  return <UsageRow {...props} label="Cache" tokens={usage.cachedInputTokens ?? 0} />;
};
