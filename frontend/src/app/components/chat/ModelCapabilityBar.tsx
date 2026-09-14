"use client";

import { Brain, Eye, FileText, Mic, Video, Wrench, Zap } from "lucide-react";
import type { ComponentType } from "react";
import { cn } from "@/lib/utils";
import type { ModelCapabilities } from "./capabilities";

const BADGES: Array<{
  key: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  active: (c: ModelCapabilities) => boolean;
}> = [
  { key: "text", label: "Text", icon: FileText, active: (c) => c.supportsText },
  { key: "vision", label: "Vision", icon: Eye, active: (c) => c.supportsVision },
  { key: "files", label: "Files", icon: FileText, active: (c) => c.supportsFiles },
  { key: "audio", label: "Audio", icon: Mic, active: (c) => c.supportsAudioInput },
  { key: "video", label: "Video", icon: Video, active: (c) => c.supportsVideoInput },
  { key: "reasoning", label: "Reasoning", icon: Brain, active: (c) => c.supportsReasoning },
  { key: "streaming", label: "Streaming", icon: Zap, active: (c) => c.supportsStreaming },
  { key: "tools", label: "Tools", icon: Wrench, active: (c) => c.supportsToolCalling },
];

/** Supported-capability badges only — unsupported controls are hidden, never disabled. */
export function ModelCapabilityBar({ caps, hasModel }: { caps: ModelCapabilities; hasModel: boolean }) {
  if (!hasModel) return null;
  const shown = BADGES.filter((b) => b.active(caps));
  if (shown.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1 px-0.5 pb-1.5" data-testid="capability-bar">
      {shown.map(({ key, label, icon: Icon }) => (
        <span
          key={key}
          data-testid={`cap-badge-${key}`}
          className={cn(
            "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium",
            "border-zinc-200 bg-zinc-50 text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400",
            key === "reasoning" &&
              "border-tollma-200 bg-tollma-50 text-tollma-700 dark:border-tollma-800 dark:bg-tollma-950 dark:text-tollma-300",
          )}
        >
          <Icon className="size-2.5" />
          {label}
        </span>
      ))}
    </div>
  );
}
