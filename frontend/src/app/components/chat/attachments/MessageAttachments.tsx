"use client";

import { memo } from "react";
import { Download } from "lucide-react";
import {
  Attachment,
  AttachmentInfo,
  AttachmentPreview,
  Attachments,
  type AttachmentData,
} from "@/components/ai-elements/attachments";
import { attachmentContentUrl } from "@/services/api";
import type { ChatAttachment } from "@/types";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function toAttachmentData(attachment: ChatAttachment): AttachmentData {
  return {
    type: "file",
    id: attachment.id,
    filename: attachment.filename,
    mediaType: attachment.mime_type,
    size: attachment.file_size,
    url: attachmentContentUrl(attachment.id),
  };
}

/**
 * Persisted message attachments rendered with AI Elements Attachments:
 * images as a grid, documents as a list with download links.
 */
function MessageAttachmentsInner({ attachments }: { attachments?: ChatAttachment[] }) {
  if (!attachments || attachments.length === 0) return null;

  const images = attachments.filter((a) => a.kind === "image");
  const videos = attachments.filter((a) => a.kind === "video");
  const documents = attachments.filter((a) => a.kind !== "image" && a.kind !== "video");

  return (
    <div className="mb-1.5 space-y-1.5" data-testid="message-attachments">
      {images.length > 0 && (
        <Attachments variant="grid">
          {images.map((attachment) => (
            <a
              href={attachmentContentUrl(attachment.id)}
              key={attachment.id}
              rel="noreferrer"
              target="_blank"
              title={attachment.filename}
            >
              <Attachment data={toAttachmentData(attachment)}>
                <AttachmentPreview />
              </Attachment>
            </a>
          ))}
        </Attachments>
      )}

      {videos.length > 0 && (
        <div className="space-y-1.5" data-testid="message-videos">
          {videos.map((attachment) => (
            <div className="w-full max-w-2xl space-y-1" key={attachment.id}>
              <video
                className="max-h-96 w-full rounded-xl bg-black"
                controls
                data-testid={`message-video-${attachment.id}`}
                preload="metadata"
                src={attachmentContentUrl(attachment.id)}
              />
              <div className="flex items-center gap-2 text-[10px] text-zinc-400">
                <span className="truncate">{attachment.filename}</span>
                <span className="shrink-0">{formatBytes(attachment.file_size)}</span>
                <a
                  className="inline-flex shrink-0 items-center gap-1 text-tollma-600 hover:text-tollma-700 dark:text-tollma-400"
                  download={attachment.filename}
                  href={attachmentContentUrl(attachment.id)}
                >
                  <Download className="size-3" /> Download
                </a>
              </div>
            </div>
          ))}
        </div>
      )}

      {documents.length > 0 && (
        <Attachments variant="list">
          {documents.map((attachment) => (
            <a
              download={attachment.filename}
              href={attachmentContentUrl(attachment.id)}
              key={attachment.id}
              title={`${attachment.filename} (${attachment.kind})`}
            >
              <Attachment
                className="w-full max-w-72 py-2"
                data={toAttachmentData(attachment)}
              >
                <AttachmentPreview />
                <AttachmentInfo showMediaType />
                <span className="flex shrink-0 items-center gap-1 text-[10px] text-zinc-400">
                  {formatBytes(attachment.file_size)}
                  <Download className="size-3" />
                </span>
              </Attachment>
            </a>
          ))}
        </Attachments>
      )}
    </div>
  );
}

export const MessageAttachments = memo(
  MessageAttachmentsInner,
  (prev, next) => prev.attachments === next.attachments,
);
