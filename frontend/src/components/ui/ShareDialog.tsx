"use client";

import { useState } from "react";
import { Check, Copy, Link2, RefreshCw, ShieldOff } from "lucide-react";
import { toast } from "@/lib/notify";
import { Button, Dialog, DialogContent, DialogTitle } from "@/components/ui/primitives";
import { useIntelligenceMutations, useShares } from "@/hooks/useIntelligence";
import { toastApiError } from "@/lib/errors";
import { copyTextToClipboard } from "@/lib/clipboard";
import { cn } from "@/lib/utils";

export interface ShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId: string | null;
}

const EXPIRY_OPTIONS = [
  { label: "Never", hours: undefined },
  { label: "24 hours", hours: 24 },
  { label: "7 days", hours: 24 * 7 },
  { label: "30 days", hours: 24 * 30 },
];

/** Create / disable / rotate the public read-only link for a conversation. */
export function ShareDialog({ open, onOpenChange, conversationId }: ShareDialogProps) {
  const { data: shares } = useShares(open ? conversationId : null);
  const { share, unshare, rotate } = useIntelligenceMutations(conversationId);
  const [expiryHours, setExpiryHours] = useState<number | undefined>(undefined);
  const [copied, setCopied] = useState(false);

  const active = shares?.find((item) => item.is_public) ?? null;
  const shareUrl = active ? `${window.location.origin}${active.share_url}` : null;

  function handleOpenChange(next: boolean) {
    if (!next) setCopied(false);
    onOpenChange(next);
  }

  async function copyLink() {
    if (!shareUrl) return;
    try {
      const ok = await copyTextToClipboard(shareUrl);
      if (!ok) throw new Error("copy unavailable");
      setCopied(true);
      toast.success("Share link copied");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Could not copy the link", {
        description: "Select the link text manually to copy it.",
      });
    }
  }

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogContent className="max-w-lg gap-4" data-testid="share-dialog">
        <DialogTitle className="text-sm font-semibold">Share conversation</DialogTitle>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Anyone with the link can read this conversation. Provider credentials and account
          information are never exposed.
        </p>

        {active ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 rounded-[var(--radius-md,14px)] border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900">
              <Link2 className="size-3.5 shrink-0 text-zinc-400" />
              <span className="min-w-0 flex-1 truncate font-mono text-xs" data-testid="share-link">
                {shareUrl}
              </span>
              <Button data-testid="share-copy" onClick={copyLink} size="xs" type="button" variant="ghost">
                {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[10px] text-zinc-400">
              <span data-testid="share-views">{active.view_count} views</span>
              <span>·</span>
              <span>{active.expires_at ? `Expires ${new Date(active.expires_at).toLocaleString()}` : "No expiry"}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                data-testid="share-rotate"
                disabled={rotate.isPending}
                onClick={() =>
                  rotate.mutate(active.id, {
                    onSuccess: () => toast.success("New link generated"),
                    onError: (error) => toastApiError(error, { title: "Could not regenerate link" }),
                  })
                }
                size="sm"
                type="button"
                variant="outline"
              >
                <RefreshCw className="size-3.5" /> Regenerate link
              </Button>
              <Button
                className="text-red-600"
                data-testid="share-disable"
                disabled={unshare.isPending}
                onClick={() =>
                  unshare.mutate(active.id, {
                    onSuccess: () => toast.success("Sharing disabled"),
                    onError: (error) => toastApiError(error, { title: "Could not disable sharing" }),
                  })
                }
                size="sm"
                type="button"
                variant="outline"
              >
                <ShieldOff className="size-3.5" /> Disable
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-1.5">
              {EXPIRY_OPTIONS.map((option) => (
                <button
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-xs transition-colors",
                    expiryHours === option.hours
                      ? "border-tollma-500 bg-tollma-50 text-tollma-700 dark:bg-tollma-950/40 dark:text-tollma-300"
                      : "border-zinc-200 text-zinc-500 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800",
                  )}
                  data-testid={`share-expiry-${option.label.toLowerCase().replace(/\s+/g, "-")}`}
                  key={option.label}
                  onClick={() => setExpiryHours(option.hours)}
                  type="button"
                >
                  {option.label}
                </button>
              ))}
            </div>
            <Button
              data-testid="share-create"
              disabled={!conversationId || share.isPending}
              onClick={() =>
                conversationId &&
                share.mutate(
                  { conversationId, expiresInHours: expiryHours },
                  {
                    onSuccess: () => toast.success("Share link created"),
                    onError: (error) => toastApiError(error, { title: "Could not create link" }),
                  },
                )
              }
              size="sm"
              type="button"
            >
              <Link2 className="size-3.5" /> Create share link
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
