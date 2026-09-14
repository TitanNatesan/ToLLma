"use client";

import { useRef } from "react";
import { toast } from "sonner";
import { Image as ImageIcon, Mic, Paperclip, Video } from "lucide-react";
import type { ComponentType } from "react";
import { uploadChatAttachment } from "@/services/api";
import {
  ACCEPT_BY_KIND,
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_BYTES,
  kindForFile,
  type AttachmentKind,
  type ComposerAttachment,
} from "./capabilities";

const KIND_BUTTON: Record<AttachmentKind, { icon: ComponentType<{ className?: string }>; label: string; testid: string }> = {
  file: { icon: Paperclip, label: "Upload file", testid: "attach-file" },
  image: { icon: ImageIcon, label: "Upload image", testid: "attach-image" },
  audio: { icon: Mic, label: "Upload audio", testid: "attach-audio" },
  video: { icon: Video, label: "Upload video", testid: "attach-video" },
};

/** One upload button per supported kind. Unsupported kinds render nothing.
 * Files upload immediately (POST /api/v1/chat/attachments); chips appear
 * only after the server accepts them, so staged items always have an id. */
export function AttachmentPicker({
  kinds,
  currentCount,
  disabled,
  conversationId,
  onAdd,
}: {
  kinds: AttachmentKind[];
  currentCount: number;
  disabled?: boolean;
  conversationId?: string | null;
  onAdd: (attachments: ComposerAttachment[]) => void;
}) {
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});

  if (kinds.length === 0) return null;

  async function handleFiles(kind: AttachmentKind, files: FileList | null) {
    if (!files || files.length === 0) return;
    const picked: ComposerAttachment[] = [];
    for (const file of Array.from(files)) {
      if (currentCount + picked.length >= MAX_ATTACHMENTS) {
        toast.error(`Maximum ${MAX_ATTACHMENTS} attachments`);
        break;
      }
      if (file.size > MAX_ATTACHMENT_BYTES) {
        toast.error(`${file.name} exceeds 25 MB`);
        continue;
      }
      const detected = kindForFile(file);
      if (detected !== kind) {
        toast.error(`${file.name} is not a supported ${kind} file`);
        continue;
      }
      try {
        const up = await uploadChatAttachment(file, conversationId);
        picked.push({
          id: crypto.randomUUID(),
          name: up.filename,
          size: up.size,
          mime: up.mime_type,
          kind,
          attachmentId: up.attachment_id,
          previewUrl: kind === "image" ? URL.createObjectURL(file) : undefined,
        });
      } catch (e) {
        toast.error(`Upload failed: ${file.name}`, {
          description: e instanceof Error ? e.message : "unknown error",
        });
      }
    }
    if (picked.length > 0) onAdd(picked);
  }

  return (
    <span className="flex items-center gap-0.5" data-testid="attachment-picker">
      {kinds.map((kind) => {
        const { icon: Icon, label, testid } = KIND_BUTTON[kind];
        return (
          <span key={kind}>
            <button
              type="button"
              title={label}
              aria-label={label}
              disabled={disabled}
              data-testid={testid}
              onClick={() => inputs.current[kind]?.click()}
              className="flex size-7 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-40 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            >
              <Icon className="size-4" />
            </button>
            <input
              ref={(el) => {
                inputs.current[kind] = el;
              }}
              type="file"
              multiple
              accept={ACCEPT_BY_KIND[kind].accept}
              className="hidden"
              tabIndex={-1}
              onChange={(e) => {
                handleFiles(kind, e.target.files);
                e.target.value = "";
              }}
            />
          </span>
        );
      })}
    </span>
  );
}
