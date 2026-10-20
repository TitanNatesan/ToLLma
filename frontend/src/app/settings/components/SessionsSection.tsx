"use client";

import { useState } from "react";
import { Laptop, LogOut, Monitor, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { Badge, Button, EmptyState, LoadingState } from "@/components/ui";
import { useSessionMutations, useSessions } from "@/hooks/useSettings";
import { fmtRelative } from "@/app/analytics/format";
import { authProviderLabel } from "@/lib/authProvider";
import { fmtTokens } from "@/lib/utils";

function DeviceIcon({ os }: { os: string }) {
  if (os === "iOS" || os === "Android") return <Smartphone className="size-4" />;
  if (os === "Windows") return <Monitor className="size-4" />;
  return <Laptop className="size-4" />;
}

/** Active login sessions with revoke + "log out all other sessions". */
export function SessionsSection() {
  const { data, isLoading } = useSessions();
  const { revoke, revokeOthers } = useSessionMutations();
  const [confirmingOthers, setConfirmingOthers] = useState(false);

  if (isLoading) return <LoadingState message="Loading sessions…" />;
  const sessions = data?.sessions ?? [];

  function onRevoke(sessionId: string) {
    revoke.mutate(sessionId, {
      onSuccess: () => toast.success("Session revoked"),
      onError: (e) => toast.error("Could not revoke session", { description: e.message }),
    });
  }

  function onRevokeOthers() {
    if (!confirmingOthers) {
      setConfirmingOthers(true);
      return;
    }
    setConfirmingOthers(false);
    revokeOthers.mutate(undefined, {
      onSuccess: (result) => toast.success(`${result.revoked} other session(s) signed out`),
      onError: (e) => toast.error("Could not sign out sessions", { description: e.message }),
    });
  }

  return (
    <div className="space-y-2" data-testid="sessions-list">
      {sessions.map((session) => (
        <div
          key={session.id}
          className="flex items-start gap-3 rounded-lg border border-zinc-100 p-3 transition-colors hover:border-zinc-200 dark:border-zinc-900 dark:hover:border-zinc-800"
          data-testid={`session-${session.id}`}
        >
          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-zinc-100 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
            <DeviceIcon os={session.os} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-2 text-xs font-medium text-zinc-800 dark:text-zinc-200">
              {session.device}
              {session.current ? (
                <Badge variant="success" className="px-1.5 py-0 text-[9px]" data-testid={`session-current-${session.id}`}>
                  This device
                </Badge>
              ) : null}
              {session.login_method === "google" && (
                <Badge variant="outline" className="px-1.5 py-0 text-[9px]">
                  Google
                </Badge>
              )}
            </p>
            <p className="mt-0.5 text-[11px] text-zinc-400">
              {authProviderLabel(session.provider)}
              {session.location ? ` · ${session.location}` : ""}
              {session.ip ? ` · ${session.ip}` : ""}
              {" · "}
              Active {fmtRelative(session.last_seen)} · Started{" "}
              {session.created_at ? new Date(session.created_at).toLocaleDateString() : "—"}
            </p>
            <p className="mt-1 text-[11px] text-zinc-400">
              {session.requests.toLocaleString()} request{session.requests === 1 ? "" : "s"} ·{" "}
              {fmtTokens(session.tokens)} tokens
            </p>
          </div>
          {!session.current && (
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-xs text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-950/40"
              onClick={() => onRevoke(session.id)}
              disabled={revoke.isPending}
              data-testid={`session-revoke-${session.id}`}
            >
              <LogOut className="size-3.5" />
              Revoke
            </Button>
          )}
        </div>
      ))}

      {sessions.length === 0 && <p className="py-4 text-center text-xs text-zinc-400">No active sessions.</p>}

      {sessions.length > 1 && (
        <div className="flex justify-end pt-1">
          <Button
            variant="outline"
            size="sm"
            className={confirmingOthers ? "border-red-300 text-red-600 dark:border-red-900" : "text-xs"}
            onClick={onRevokeOthers}
            disabled={revokeOthers.isPending}
            data-testid="sessions-revoke-others"
          >
            {confirmingOthers
              ? "Confirm: sign out all other sessions"
              : revokeOthers.isPending
                ? "Signing out…"
                : "Log out all other sessions"}
          </Button>
        </div>
      )}
    </div>
  );
}
