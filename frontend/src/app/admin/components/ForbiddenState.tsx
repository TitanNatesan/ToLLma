"use client";

import { ShieldAlert } from "lucide-react";
import { Button, EmptyState } from "@/components/ui";

/** Clean 403 state: the signed-in account is not a platform administrator. */
export function ForbiddenState({ onRetry }: { onRetry?: () => void }) {
  return (
    <div
      className="mx-auto mt-6 flex max-w-md flex-col items-center rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950"
      data-testid="admin-forbidden"
    >
      <EmptyState
        icon={ShieldAlert}
        title="Platform administrator access required"
        description="This console exposes platform-wide usage, cost and health telemetry. Ask a platform administrator to grant your account access."
      />
      {onRetry && (
        <Button variant="outline" size="sm" className="text-xs" onClick={onRetry}>
          Check again
        </Button>
      )}
    </div>
  );
}
