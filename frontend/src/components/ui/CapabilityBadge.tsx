"use client";

import type { ComponentType } from "react";
import {
  Brain,
  Database,
  Eye,
  FileText,
  Image as ImageIcon,
  Mic,
  Volume2,
  Wrench,
  Zap,
} from "lucide-react";
import { Badge, Tooltip } from "./primitives";
import { cn } from "@/lib/utils";

export type CapabilityKey =
  | "supports_text"
  | "supports_vision"
  | "supports_audio_input"
  | "supports_audio_output"
  | "supports_image_generation"
  | "supports_tool_calling"
  | "supports_reasoning"
  | "supports_streaming"
  | "supports_embeddings";

interface CapMeta {
  label: string;
  shortLabel: string;
  icon: ComponentType<{ className?: string }>;
  description: string;
}

export const CAPABILITY_CONFIG: Record<CapabilityKey, CapMeta> = {
  supports_text: {
    label: "Text",
    shortLabel: "Text",
    icon: FileText,
    description: "Supports natural language generation and completion",
  },
  supports_vision: {
    label: "Vision",
    shortLabel: "Vision",
    icon: Eye,
    description: "Can understand and process images",
  },
  supports_audio_input: {
    label: "Audio In",
    shortLabel: "Audio-In",
    icon: Mic,
    description: "Can accept and process audio inputs",
  },
  supports_audio_output: {
    label: "Audio Out",
    shortLabel: "Audio-Out",
    icon: Volume2,
    description: "Can synthesize and output spoken audio",
  },
  supports_image_generation: {
    label: "Image Gen",
    shortLabel: "Images",
    icon: ImageIcon,
    description: "Can generate or edit images",
  },
  supports_tool_calling: {
    label: "Tool Calling",
    shortLabel: "Tools",
    icon: Wrench,
    description: "Supports function calling and external tool use",
  },
  supports_reasoning: {
    label: "Reasoning",
    shortLabel: "Reasoning",
    icon: Brain,
    description: "Specialized for chain-of-thought and complex reasoning",
  },
  supports_streaming: {
    label: "Streaming",
    shortLabel: "Stream",
    icon: Zap,
    description: "Supports progressive server-sent event (SSE) streaming",
  },
  supports_embeddings: {
    label: "Embeddings",
    shortLabel: "Embed",
    icon: Database,
    description: "Can generate high-dimensional vector embeddings",
  },
};

export function CapabilityBadge({
  capability,
  compact = false,
  showLabel = true,
  className,
}: {
  capability: CapabilityKey | string;
  compact?: boolean;
  showLabel?: boolean;
  className?: string;
}) {
  const meta = CAPABILITY_CONFIG[capability as CapabilityKey];
  if (!meta) {
    return (
      <Badge variant="outline" className={cn("text-[10px]", className)}>
        {capability}
      </Badge>
    );
  }

  const Icon = meta.icon;

  return (
    <Tooltip content={`${meta.label}: ${meta.description}`}>
      <Badge
        variant="secondary"
        className={cn(
          "cursor-default gap-1 text-[10px] font-normal transition-colors hover:bg-zinc-200 dark:hover:bg-zinc-700",
          compact ? "px-1.5 py-0.2" : "px-2 py-0.5",
          className,
        )}
      >
        <Icon className="size-3 text-zinc-500 dark:text-zinc-400" />
        {showLabel && (
          <span>{compact ? meta.shortLabel : meta.label}</span>
        )}
      </Badge>
    </Tooltip>
  );
}
