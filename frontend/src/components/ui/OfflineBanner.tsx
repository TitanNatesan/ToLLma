"use client";

import { WifiOff } from "lucide-react";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";

/**
 * Global offline indicator. Banner only — send paths already degrade through
 * their existing error toasts, so no send logic changes here.
 */
export function OfflineBanner() {
  const online = useOnlineStatus();
  if (online) return null;
  return (
    <div
      role="alert"
      data-testid="offline-banner"
      className="flex shrink-0 items-center gap-2 border-b border-zinc-300 bg-zinc-100 px-4 py-2 text-sm text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
    >
      <WifiOff className="size-4 shrink-0" aria-hidden="true" />
      <p className="min-w-0 flex-1">
        You&apos;re offline — new messages and changes can&apos;t sync until you reconnect.
      </p>
    </div>
  );
}
