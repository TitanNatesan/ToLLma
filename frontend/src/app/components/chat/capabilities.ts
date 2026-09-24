import type { AIModel } from "@/types";

import { REASONING_OFF_LEVEL, normalizeReasoningLevels } from "./reasoningLevels";

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
  supportsPromptCaching: boolean;
  supportsImageGeneration: boolean;
  supportsImageEditing: boolean;
  supportsVideoGeneration: boolean;
  supportsResponses: boolean;
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
 *  data-driven default: providers that expose levels via metadata win.
 *  "none" is always prepended (see normalizeReasoningLevels). */
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
      supportsPromptCaching: false,
      supportsImageGeneration: false,
      supportsImageEditing: false,
      supportsVideoGeneration: false,
      supportsResponses: false,
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
    supportsPromptCaching: metaBool(model, "supports_prompt_caching"),
    supportsImageGeneration: model.supports_image_generation === true,
    supportsImageEditing: metaBool(model, "supports_image_editing"),
    supportsVideoGeneration: metaBool(model, "supports_video_generation"),
    supportsResponses: metaBool(model, "supports_responses"),
    reasoningLevels: supportsReasoning
      ? normalizeReasoningLevels(levels.length > 0 ? levels : DEFAULT_REASONING_LEVELS)
      : [],
  };
}

export interface MediaRates {
  imageLow: string | null;
  imageMedium: string | null;
  imageHigh: string | null;
  videoPerSecond: string | null;
}

/** Media rate card from model metadata (seeded by the repository). */
export function mediaRates(model: AIModel | null | undefined): MediaRates {
  const source = model ? meta(model) : {};
  const value = (key: string): string | null => {
    const raw = source[key];
    return typeof raw === "string" && raw.length > 0 && raw !== "0" ? raw : null;
  };
  return {
    imageLow: value("image_low_price"),
    imageMedium: value("image_medium_price"),
    imageHigh: value("image_high_price"),
    videoPerSecond: value("video_price_per_second"),
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

/** Default reasoning selection: first level that is not the off switch
 *  (cheapest on-level), so adding "none" never silently disables reasoning
 *  for models that reasoned by default. Off-only level sets fall back to
 *  "none". */
export function defaultReasoningLevel(caps: ModelCapabilities): string | null {
  return (
    caps.reasoningLevels.find((level) => level !== REASONING_OFF_LEVEL) ??
    caps.reasoningLevels[0] ??
    null
  );
}

/** User preference wins when the selected model actually offers that level;
 *  otherwise the model default applies. Preference never overrides capability. */
export function preferredReasoningLevel(
  caps: ModelCapabilities,
  preferred: string | null,
): string | null {
  if (!caps.supportsReasoning) return null;
  if (preferred && caps.reasoningLevels.includes(preferred)) return preferred;
  return defaultReasoningLevel(caps);
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
