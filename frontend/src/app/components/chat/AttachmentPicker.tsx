"use client";

import { useRef } from "react";
import { Paperclip } from "lucide-react";

/** Single upload button. Capability filtering lives in the parent: it
 *  computes `accept`, validates picks, and shows model suggestions.
 *  Renders nothing when the model accepts no uploads (text-only). */
export function AttachmentPicker({
  accept,
  disabled,
  onPick,
}: {
  /** Combined accept string, or null when uploads are unsupported. */
  accept: string | null;
  disabled?: boolean;
  onPick: (files: FileList) => void;
}) {
  const input = useRef<HTMLInputElement | null>(null);

  if (!accept) return null;

  return (
    <span className="flex items-center" data-testid="attachment-picker">
      <button
        type="button"
        title="Attach files"
        aria-label="Attach files"
        disabled={disabled}
        data-testid="attach-button"
        onClick={() => input.current?.click()}
        className="flex size-7 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-40 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
      >
        <Paperclip className="size-4" />
      </button>
      <input
        ref={input}
        type="file"
        multiple
        accept={accept}
        className="hidden"
        tabIndex={-1}
        data-testid="attach-input"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) onPick(e.target.files);
          e.target.value = "";
        }}
      />
    </span>
  );
}
