"use client";

import { useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui";
import { apiKeyErrorMessage } from "@/services/apiKeys";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => Promise<void> | void;
  onClose: () => void;
}

/** Small confirm modal with inline error + busy state; parent closes on success. */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  destructive = false,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
    } catch (e) {
      setError(apiKeyErrorMessage(e, "The action could not be completed."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) {
          setError(null);
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-md p-4" data-testid="key-confirm-dialog">
        <div className="flex items-start gap-3">
          {destructive && (
            <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-red-100 text-red-600 dark:bg-red-950/60 dark:text-red-400">
              <AlertTriangle className="size-4" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {title}
            </DialogTitle>
            <DialogDescription asChild>
              <div className="mt-1.5 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                {description}
              </div>
            </DialogDescription>
            {error && (
              <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
                {error}
              </p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>
                {cancelLabel}
              </Button>
              <Button
                variant={destructive ? "destructive" : "default"}
                size="sm"
                onClick={() => void confirm()}
                disabled={busy}
                data-testid="key-confirm-action"
              >
                {busy && <Loader2 className="size-3.5 animate-spin" />}
                {confirmLabel}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
