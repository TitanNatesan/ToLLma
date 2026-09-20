import type { AIModel } from "@/types";

// ponytail: extended caps (files/video/levels) live in the metadata JSONB
// column — no migration, no new endpoint. GET /api/v1/models already serves
// every flag below, so the composer derives everything client-side.

export type AttachmentKind = "image" | "file" | "audio" | "video";

export interface ModelCapabilities {
  supportsText: boolean;
  supportsVision: boolean;
  supportsFiles: boolean;
  supportsAudioInput: boolean;
  supportsVideoInput: boolean;
  supportsReasoning: boolean;
  supportsStreaming: boolean;
  supportsToolCalling: boolean;
  reasoningLevels: string[];
}

export interface ComposerAttachment {
  id: string;
  name: string;
  size: number;
  mime: string;
  kind: AttachmentKind;
  /** Server id from POST /api/v1/chat/attachments. Set once upload succeeds. */
  attachmentId: string | null;
  /** Object URL for image thumbnails; undefined otherwise. */
  previewUrl?: string;
  /** Upload lifecycle: the entry exists immediately, the file uploads behind
   *  it (AI SDK Attachments pattern). Send is blocked while uploading. */
  status: "uploading" | "ready" | "error";
  progress?: number;
  error?: string;
}

export interface AttachmentDescriptor {
  name: string;
  size: number;
  mime: string;
  kind: AttachmentKind;
  attachmentId: string | null;
}

export interface ChatSendPayload {
  text: string;
  reasoningLevel: string | null;
  attachments: AttachmentDescriptor[];
}

/** Fallback levels when a reasoning model declares none. Filed under
 *  data-driven default: providers that expose levels via metadata win. */
export const DEFAULT_REASONING_LEVELS = ["low", "medium", "high"];

const IMAGE_EXTS = ["jpg", "jpeg", "png", "webp", "gif"];
const FILE_EXTS = ["pdf", "docx", "txt", "md", "csv", "xlsx", "json"];
const AUDIO_EXTS = ["mp3", "wav", "ogg", "m4a"];
const VIDEO_EXTS = ["mp4", "mov", "avi", "webm"];

export const ACCEPT_BY_KIND: Record<AttachmentKind, { accept: string; exts: string[] }> = {
  image: { accept: "image/png,image/jpeg,image/gif,image/webp", exts: IMAGE_EXTS },
  file: {
    accept: ".pdf,.docx,.txt,.csv,.xlsx,.pptx,.json,.md",
    exts: FILE_EXTS,
  },
  audio: { accept: "audio/mpeg,audio/wav,audio/ogg,audio/mp4,audio/flac", exts: AUDIO_EXTS },
  video: { accept: "video/mp4,video/webm,video/quicktime,video/x-msvideo", exts: VIDEO_EXTS },
};

export const MAX_ATTACHMENTS = 10;
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

function meta(model: AIModel): Record<string, unknown> {
  return (model.metadata ?? {}) as Record<string, unknown>;
}

function metaBool(model: AIModel, key: string): boolean {
  return meta(model)[key] === true;
}

function metaLevels(model: AIModel): string[] {
  const raw = meta(model).reasoning_levels;
  if (!Array.isArray(raw)) return [];
  return raw.filter((l): l is string => typeof l === "string" && l.length > 0);
}

/** Derive composer capabilities from capability data only. Never inspects
 *  model/provider names — text-only models yield an empty upload set. */
export function getModelCapabilities(model: AIModel | null | undefined): ModelCapabilities {
  if (!model) {
    return {
      supportsText: true,
      supportsVision: false,
      supportsFiles: false,
      supportsAudioInput: false,
      supportsVideoInput: false,
      supportsReasoning: false,
      supportsStreaming: false,
      supportsToolCalling: false,
      reasoningLevels: [],
    };
  }
  const supportsReasoning = model.supports_reasoning === true;
  const levels = metaLevels(model);
  return {
    supportsText: model.supports_text !== false,
    supportsVision: model.supports_vision === true,
    supportsFiles: metaBool(model, "supports_files"),
    supportsAudioInput: model.supports_audio_input === true,
    supportsVideoInput: metaBool(model, "supports_video_input"),
    supportsReasoning,
    supportsStreaming: model.supports_streaming === true,
    supportsToolCalling: model.supports_tool_calling === true,
    reasoningLevels: supportsReasoning
      ? levels.length > 0
        ? levels
        : [...DEFAULT_REASONING_LEVELS]
      : [],
  };
}

/** Upload kinds the composer may offer, in toolbar order. Empty = text-only. */
export function uploadKinds(caps: ModelCapabilities): AttachmentKind[] {
  const kinds: AttachmentKind[] = [];
  if (caps.supportsFiles) kinds.push("file");
  if (caps.supportsVision) kinds.push("image");
  if (caps.supportsAudioInput) kinds.push("audio");
  if (caps.supportsVideoInput) kinds.push("video");
  return kinds;
}

/** Default reasoning selection: first declared level (cheapest assumption). */
export function defaultReasoningLevel(caps: ModelCapabilities): string | null {
  return caps.reasoningLevels.length > 0 ? caps.reasoningLevels[0] : null;
}

export function kindForFile(file: File): AttachmentKind | null {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (file.type.startsWith("image/") || IMAGE_EXTS.includes(ext)) return "image";
  if (file.type.startsWith("audio/") || AUDIO_EXTS.includes(ext)) return "audio";
  if (file.type.startsWith("video/") || VIDEO_EXTS.includes(ext)) return "video";
  if (FILE_EXTS.includes(ext)) return "file";
  // Backend also extracts pptx/xlsx-adjacent office docs; accept the kind
  // even when the extension list above doesn't offer it in the picker.
  if (["pptx", "flac"].includes(ext)) return ext === "flac" ? "audio" : "file";
  return null;
}

export function describeAttachment(a: ComposerAttachment): AttachmentDescriptor {
  return { name: a.name, size: a.size, mime: a.mime, kind: a.kind, attachmentId: a.attachmentId };
}

/** Attachments the backend accepted — the only ones a send may reference. */
export function readyAttachments(attachments: ComposerAttachment[]): ComposerAttachment[] {
  return attachments.filter((a) => a.status === "ready" && a.attachmentId);
}

/** Combined file-dialog accept string for the single upload button. */
export function combinedAccept(kinds: AttachmentKind[]): string {
  return kinds.map((k) => ACCEPT_BY_KIND[k].accept).join(",");
}

/** Human message for a rejected drop/pick/paste. */
export function unsupportedMessage(kind: AttachmentKind | null, fileName: string): string {
  if (kind === "image") return "This model does not support image inputs.";
  const ext = fileName.split(".").pop()?.toUpperCase() ?? "FILE";
  if (kind === "audio") return `This model does not support ${ext} audio.`;
  if (kind === "video") return `This model does not support ${ext} video.`;
  return `This model does not support ${ext} files.`;
}

/** Capability a rejected kind needs, for model suggestions. */
export function capabilityForKind(kind: AttachmentKind | null): keyof ModelCapabilities | null {
  switch (kind) {
    case "image":
      return "supportsVision";
    case "file":
      return "supportsFiles";
    case "audio":
      return "supportsAudioInput";
    case "video":
      return "supportsVideoInput";
    default:
      return null;
  }
}

/** Up to 3 registered+active models (not the current one) supporting the
 *  rejected input kind. Client-side over the already-fetched registry —
 *  no new endpoint. */
export function suggestModels(
  models: AIModel[],
  kind: AttachmentKind | null,
  excludeId: string | null,
  limit = 3,
): AIModel[] {
  const need = capabilityForKind(kind);
  if (!need) return [];
  return models
    .filter((m) => m.is_active && m.id !== excludeId && getModelCapabilities(m)[need])
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, limit);
}
