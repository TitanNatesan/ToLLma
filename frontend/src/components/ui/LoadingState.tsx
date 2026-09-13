"use client";

import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export function LoadingState({
  message = "Loading…",
  className,
}: {
  message?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 p-8 text-zinc-400 dark:text-zinc-500",
        className,
      )}
    >
      <Loader2 className="size-5 animate-spin text-zinc-500 dark:text-zinc-400" />
      <span className="text-xs">{message}</span>
    </div>
  );
}
