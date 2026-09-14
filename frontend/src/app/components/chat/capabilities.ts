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

const IMAGE_EXTS = ["png", "jpg", "jpeg", "gif", "webp"];
const FILE_EXTS = ["pdf", "docx", "txt", "csv", "xlsx", "pptx", "json", "md"];
const AUDIO_EXTS = ["mp3", "wav", "ogg", "m4a", "flac"];
const VIDEO_EXTS = ["mp4", "webm", "mov", "avi"];

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
  return null;
}

export function describeAttachment(a: ComposerAttachment): AttachmentDescriptor {
  return { name: a.name, size: a.size, mime: a.mime, kind: a.kind, attachmentId: a.attachmentId };
}
