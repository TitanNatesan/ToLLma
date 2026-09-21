"use client";

import { AlertCircle, Loader2 } from "lucide-react";
import {
  Attachment,
  AttachmentInfo,
  AttachmentPreview,
  AttachmentRemove,
  type AttachmentData,
} from "@/components/ai-elements/attachments";
import type { ComposerAttachment } from "./capabilities";

export interface UploadPreviewProps {
  attachments: ComposerAttachment[];
  onRemove: (id: string) => void;
}

function toData(attachment: ComposerAttachment): AttachmentData {
  return {
    type: "file",
    id: attachment.id,
    filename: attachment.name,
    mediaType: attachment.mime,
    size: attachment.size,
    url: attachment.previewUrl,
  };
}

/**
 * Composer attachment staging built on AI Elements Attachments.
 * Uploading entries expose progress; ready entries expose remove; failed
 * entries surface the server error.
 */
export function UploadPreview({ attachments, onRemove }: UploadPreviewProps) {
  if (attachments.length === 0) return null;

  const images = attachments.filter((a) => a.kind === "image");
  const documents = attachments.filter((a) => a.kind !== "image");

  const renderItem = (attachment: ComposerAttachment, variant: "grid" | "list") => (
    <Attachment
      className={variant === "grid" ? "size-16" : "w-full max-w-72 py-2"}
      data={toData(attachment)}
      data-status={attachment.status}
      data-testid={`attachment-chip-${attachment.id}`}
      key={attachment.id}
      onRemove={() => onRemove(attachment.id)}
      variant={variant}
    >
      <AttachmentPreview />
      {variant === "list" && <AttachmentInfo showMediaType />}
      {attachment.status === "error" && (
        <span className="shrink-0 text-[10px] text-red-500" title={attachment.error}>
          <AlertCircle className="size-3.5" />
        </span>
      )}
      <AttachmentRemove />
      {attachment.status === "uploading" && (
        <span className="absolute inset-x-0 bottom-0 h-1 bg-zinc-200/70 dark:bg-zinc-700/70">
          <span
            className="block h-full bg-tollma-500 transition-[width]"
            style={{ width: `${Math.round((attachment.progress ?? 0) * 100)}%` }}
          />
        </span>
      )}
      {attachment.status === "uploading" && variant === "grid" && (
        <span className="absolute inset-0 flex items-center justify-center bg-black/30">
          <Loader2 className="size-4 animate-spin text-white" />
        </span>
      )}
    </Attachment>
  );

  return (
    <div className="space-y-1.5 px-0.5 pb-1.5" data-testid="upload-preview">
      {images.length > 0 && (
        <div className="flex flex-wrap items-start gap-2">
          {images.map((attachment) => renderItem(attachment, "grid"))}
        </div>
      )}
      {documents.length > 0 && (
        <div className="flex flex-col items-start gap-2">
          {documents.map((attachment) => renderItem(attachment, "list"))}
        </div>
      )}
    </div>
  );
}
