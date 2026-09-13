"use client";

import { Badge } from "./primitives";
import { cn } from "@/lib/utils";

export type StatusType =
  | "valid"
  | "invalid"
  | "unknown"
  | "active"
  | "inactive"
  | "syncing"
  | "done"
  | "error";

interface StatusConfig {
  label: string;
  dotColor: string;
  variant: "default" | "secondary" | "success" | "destructive" | "warning" | "outline";
}

const CONFIGS: Record<StatusType, StatusConfig> = {
  valid: {
    label: "Valid",
    dotColor: "bg-emerald-500",
    variant: "success",
  },
  invalid: {
    label: "Invalid",
    dotColor: "bg-red-500",
    variant: "destructive",
  },
  unknown: {
    label: "Unvalidated",
    dotColor: "bg-zinc-400",
    variant: "secondary",
  },
  active: {
    label: "Active",
    dotColor: "bg-emerald-500",
    variant: "success",
  },
  inactive: {
    label: "Inactive",
    dotColor: "bg-zinc-400",
    variant: "secondary",
  },
  syncing: {
    label: "Syncing",
    dotColor: "bg-blue-500 animate-pulse",
    variant: "secondary",
  },
  done: {
    label: "Synced",
    dotColor: "bg-emerald-500",
    variant: "success",
  },
  error: {
    label: "Error",
    dotColor: "bg-red-500",
    variant: "destructive",
  },
};

export function StatusBadge({
  status,
  label,
  className,
}: {
  status: StatusType | string;
  label?: string;
  className?: string;
}) {
  const config = CONFIGS[status as StatusType] ?? {
    label: status,
    dotColor: "bg-zinc-400",
    variant: "outline",
  };

  return (
    <Badge
      variant={config.variant}
      className={cn("inline-flex items-center gap-1.5 text-[10px] font-medium", className)}
    >
      <span className={cn("size-1.5 rounded-full shrink-0", config.dotColor)} />
      <span>{label ?? config.label}</span>
    </Badge>
  );
}
