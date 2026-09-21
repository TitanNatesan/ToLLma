"use client";

import { CheckCircle2, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui";

/**
 * Shown instead of password management for OAuth accounts: they have no local
 * password, so the only honest surface is provider information.
 */
export function ProviderAuthSection() {
  return (
    <div className="space-y-4" data-testid="provider-auth-section">
      <div className="flex items-start gap-3 rounded-xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/60">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-800">
          <GoogleMark />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Google Account</p>
            <Badge
              className="gap-1 border-transparent bg-emerald-100 text-[10px] text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
              data-testid="provider-connected-badge"
              variant="secondary"
            >
              <CheckCircle2 className="size-3" /> Connected
            </Badge>
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
            This account is authenticated through Google OAuth. Password management is handled by
            Google.
          </p>
          <a
            className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-tollma-600 hover:text-tollma-700 dark:text-tollma-400 dark:hover:text-tollma-300"
            data-testid="google-account-link"
            href="https://myaccount.google.com/security"
            rel="noreferrer"
            target="_blank"
          >
            Visit Google Account settings
            <ExternalLink className="size-3" />
          </a>
        </div>
      </div>

      <div className="flex items-center justify-between rounded-lg border border-zinc-200 px-3 py-2 text-xs dark:border-zinc-800">
        <span className="text-zinc-500 dark:text-zinc-400">Authentication provider</span>
        <span className="font-medium text-zinc-800 dark:text-zinc-200" data-testid="provider-name">
          Google OAuth
        </span>
      </div>
      <div className="flex items-center justify-between rounded-lg border border-zinc-200 px-3 py-2 text-xs dark:border-zinc-800">
        <span className="text-zinc-500 dark:text-zinc-400">Local password</span>
        <span className="font-medium text-zinc-800 dark:text-zinc-200">Not set</span>
      </div>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg aria-hidden="true" className="size-4" viewBox="0 0 24 24">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.57c2.08-1.92 3.27-4.74 3.27-8.09Z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.76c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
        fill="#34A853"
      />
      <path d="M5.84 14.11a6.6 6.6 0 0 1 0-4.22V7.05H2.18a11 11 0 0 0 0 9.9l3.66-2.84Z" fill="#FBBC05" />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.05l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38Z"
        fill="#EA4335"
      />
    </svg>
  );
}
