"use client";

import type { ReactNode } from "react";
import { AlertCircle, RotateCcw } from "lucide-react";
import { Button } from "./primitives";
import { cn } from "@/lib/utils";

export function ErrorState({
  title = "Something went wrong",
  message,
  onRetry,
  className,
}: {
  title?: string;
  message?: ReactNode;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center p-6 text-center text-red-600 dark:text-red-400 gap-2",
        className,
      )}
    >
      <AlertCircle className="size-6 text-red-500" />
      <h4 className="text-sm font-semibold">{title}</h4>
      {message && <p className="text-xs text-zinc-500 max-w-sm">{message}</p>}
      {onRetry && (
        <Button
          size="sm"
          variant="outline"
          onClick={onRetry}
          className="mt-2 gap-1.5 text-xs text-zinc-700 dark:text-zinc-300"
        >
          <RotateCcw className="size-3" />
          Retry
        </Button>
      )}
    </div>
  );
}
