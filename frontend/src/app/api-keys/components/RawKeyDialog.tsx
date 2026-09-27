"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ClipboardList, Copy, KeyRound, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui";
import { cn } from "@/lib/utils";
import { copyTextToClipboard } from "@/lib/clipboard";

interface RawKeyDialogProps {
  open: boolean;
  /** Shown once; owned by the parent and discarded when this dialog closes. */
  rawKey: string;
  keyName: string;
  reason: "create" | "rotate";
  onClose: () => void;
}

/**
 * Show-once secret dialog. The raw key lives only in the parent's transient
 * state for the lifetime of this dialog; closing clears it. Dismissal is
 * blocked until the acknowledgement is ticked so the key cannot be lost by a
 * stray Escape or backdrop click.
 */
export function RawKeyDialog({ open, rawKey, keyName, reason, onClose }: RawKeyDialogProps) {
  const [copied, setCopied] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, []);

  async function copy() {
    try {
      const ok = await copyTextToClipboard(rawKey);
      if (!ok) throw new Error("copy unavailable");
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
      toast.error("Could not copy the key", {
        description: "Select the key text manually to copy it.",
      });
    }
  }

  function close() {
    if (!acknowledged) return;
    setCopied(false);
    setAcknowledged(false);
    onClose();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <DialogContent
        className="max-w-lg gap-0 overflow-hidden p-0"
        data-testid="raw-key-dialog"
        onEscapeKeyDown={(event) => {
          if (!acknowledged) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (!acknowledged) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (!acknowledged) event.preventDefault();
        }}
      >
        {/* One-time secret header — amber rails signal "handle with care". */}
        <div className="border-b border-amber-200/80 bg-gradient-to-br from-amber-50 to-amber-100/50 px-5 py-4 dark:border-amber-900/50 dark:from-amber-950/40 dark:to-amber-950/20">
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-amber-200 bg-white text-amber-600 shadow-xs dark:border-amber-900/60 dark:bg-amber-950/60 dark:text-amber-400">
              <KeyRound className="size-4" />
            </span>
            <div className="min-w-0">
              <DialogTitle className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                {reason === "create" ? "API key created" : "API key rotated"}
              </DialogTitle>
              <DialogDescription asChild>
                <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400">
                  <span className="font-medium text-zinc-800 dark:text-zinc-200">{keyName}</span>
                  {reason === "rotate"
                    ? " — the previous secret was invalidated immediately."
                    : " is ready to use."}
                </p>
              </DialogDescription>
            </div>
          </div>
        </div>

        <div className="space-y-4 p-5">
          <div className="flex items-start gap-2 rounded-lg border border-amber-300/80 bg-amber-50/70 px-3 py-2.5 text-[11px] leading-relaxed text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-200">
            <ShieldAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <span>
              <span className="font-semibold">Shown only once.</span> This is the only time the key
              is displayed — store it in a secret manager now. It cannot be retrieved later, only
              rotated.
            </span>
          </div>

          <div className="flex items-stretch gap-2">
            <code
              className={cn(
                "flex min-w-0 flex-1 select-all items-center overflow-x-auto rounded-md border px-3 py-2.5 font-mono text-xs",
                copied
                  ? "border-tollma-400 bg-tollma-50/60 text-tollma-900 dark:border-tollma-700 dark:bg-tollma-950/30 dark:text-tollma-100"
                  : "border-zinc-300 bg-zinc-50 text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100",
              )}
              data-testid="raw-key-value"
            >
              {rawKey}
            </code>
            <Button
              type="button"
              variant={copied ? "secondary" : "default"}
              size="sm"
              className={cn(
                "shrink-0 transition-colors",
                copied && "text-tollma-700 dark:text-tollma-300",
              )}
              onClick={() => void copy()}
              data-testid="raw-key-copy"
            >
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>

          <ul className="grid gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
            <li className="flex items-center gap-2">
              <ClipboardList className="size-3.5 shrink-0 text-zinc-400" />
              Paste it into your deployment&apos;s secret store or environment variables.
            </li>
            <li className="flex items-center gap-2">
              <ShieldAlert className="size-3.5 shrink-0 text-zinc-400" />
              Never commit it to source control or share it in chat.
            </li>
          </ul>
        </div>

        <div className="sticky bottom-0 space-y-3 border-t border-zinc-200 bg-white/95 px-5 py-3 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95">
          <Checkbox
            id="raw-key-ack"
            checked={acknowledged}
            onChange={(event) => setAcknowledged(event.target.checked)}
            label="I have copied this key — it will never be shown again"
            data-testid="raw-key-ack"
          />
          <div className="flex justify-end">
            <Button size="sm" onClick={close} disabled={!acknowledged} data-testid="raw-key-done">
              Done
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
