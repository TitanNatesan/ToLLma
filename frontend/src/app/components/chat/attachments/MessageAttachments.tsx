"use client";

import { memo, useState } from "react";
import { Download } from "lucide-react";
import {
  Attachment,
  AttachmentInfo,
  AttachmentPreview,
  Attachments,
  type AttachmentData,
} from "@/components/ai-elements/attachments";
import { MediaCard } from "@/app/components/media/MediaCard";
import { MediaViewer } from "@/app/components/media/MediaViewer";
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

export interface MessageAttachmentsProps {
  attachments?: ChatAttachment[];
  /** Generation metadata (resolution/quality/seconds/cost) for media cards. */
  metadata?: Record<string, unknown>;
  /** Message total cost, used when metadata carries no media cost. */
  cost?: string | null;
  costEstimated?: boolean;
}

/**
 * Persisted message attachments.
 *
 * Generated images and videos render as one aligned card each (preview +
 * filename/resolution/size/cost inside a single container) and open in the
 * unified MediaViewer on click. Documents keep the AI Elements list rows.
 */
function MessageAttachmentsInner({
  attachments,
  metadata,
  cost,
  costEstimated,
}: MessageAttachmentsProps) {
  const [preview, setPreview] = useState<ChatAttachment | null>(null);

  if (!attachments || attachments.length === 0) return null;

  const media = attachments.filter((a) => a.kind === "image" || a.kind === "video");
  const documents = attachments.filter((a) => a.kind !== "image" && a.kind !== "video");

  return (
    <div className="mb-1.5 space-y-2" data-testid="message-attachments">
      {media.length > 0 && (
        <div className="flex w-full flex-col items-center gap-2" data-testid="message-media">
          {media.map((attachment) => (
            <MediaCard
              cost={cost}
              costEstimated={costEstimated}
              fileSize={attachment.file_size}
              filename={attachment.filename}
              key={attachment.id}
              kind={attachment.kind === "video" ? "video" : "image"}
              metadata={metadata}
              onOpen={() => setPreview(attachment)}
              src={attachmentContentUrl(attachment.id)}
            />
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

      <MediaViewer
        fileSize={preview?.file_size}
        filename={preview?.filename ?? ""}
        key={preview?.id ?? "closed"}
        kind={preview?.kind === "video" ? "video" : "image"}
        onClose={() => setPreview(null)}
        open={preview !== null}
        src={preview ? attachmentContentUrl(preview.id) : ""}
      />
    </div>
  );
}

export const MessageAttachments = memo(
  MessageAttachmentsInner,
  (prev, next) =>
    prev.attachments === next.attachments &&
    prev.metadata === next.metadata &&
    prev.cost === next.cost &&
    prev.costEstimated === next.costEstimated,
);
