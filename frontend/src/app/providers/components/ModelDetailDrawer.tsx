"use client";

import {
  Badge,
  Button,
  CapabilityBadge,
  DetailPanel,
  Switch,
} from "@/components/ui";
import { useModelMutations } from "@/hooks/useRegistry";
import type { AIModel, Provider } from "@/types";
import {
  Bot,
  Pencil,
  Trash2,
} from "lucide-react";
import { stripTrailingZeros } from "@/lib/utils";

interface ModelDetailDrawerProps {
  model: AIModel | null;
  provider: Provider | null;
  open: boolean;
  onClose: () => void;
  onEdit?: (m: AIModel) => void;
}

const CAPS_LIST = [
  "supports_text",
  "supports_vision",
  "supports_audio_input",
  "supports_audio_output",
  "supports_image_generation",
  "supports_tool_calling",
  "supports_reasoning",
  "supports_streaming",
] as const;

export function ModelDetailDrawer({
  model,
  provider,
  open,
  onClose,
  onEdit,
}: ModelDetailDrawerProps) {
  const mm = useModelMutations();

  if (!model) return null;

  const activeCaps = CAPS_LIST.filter(
    (k) => (model as unknown as Record<string, boolean>)[k],
  );

  function fmtPrice(val: string): string {
    const n = parseFloat(val);
    if (isNaN(n) || n === 0) return "$0";
    return `$${stripTrailingZeros(val)}/1M`;
  }

  async function handleDelete() {
    mm.remove.mutate(model!.id);
    onClose();
  }

  return (
    <DetailPanel
      open={open}
      onClose={onClose}
      title={model.name}
      subtitle={model.model_id}
      width={420}
      testId="model-detail-drawer"
      actions={
        <div className="flex items-center gap-1">
          {onEdit && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0"
              onClick={() => onEdit(model)}
              title="Edit Model"
            >
              <Pencil className="size-3.5" />
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0 text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20"
            onClick={handleDelete}
            title="Delete Model"
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-5 text-xs">
        {/* Active Toggle & Endpoint Type */}
        <div className="flex items-center justify-between rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900/40">
          <div className="flex items-center gap-2">
            <Bot className="size-4 text-zinc-500" />
            <div>
              <div className="font-semibold text-zinc-900 dark:text-zinc-100">
                Model Status
              </div>
              <div className="text-[11px] text-zinc-500">
                {model.is_active ? "Available in chat composer" : "Disabled"}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              checked={model.is_active}
              onCheckedChange={(v) => mm.update.mutate({ id: model.id, body: { is_active: v } })}
              aria-label="Toggle model active state"
            />
            <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
              {model.is_active ? "Active" : "Disabled"}
            </span>
          </div>
        </div>

        {/* Section: Identity */}
        <div className="flex flex-col gap-2">
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
            Identity & Provider
          </h3>
          <div className="rounded-lg border border-zinc-200 divide-y divide-zinc-100 dark:border-zinc-800 dark:divide-zinc-800/60 overflow-hidden bg-white dark:bg-zinc-900/30">
            <div className="flex items-center justify-between p-2.5">
              <span className="text-zinc-500">Provider</span>
              <span className="font-medium text-zinc-800 dark:text-zinc-200">
                {provider?.name ?? "Unknown"} ({provider?.provider_type})
              </span>
            </div>
            <div className="flex items-center justify-between p-2.5">
              <span className="text-zinc-500">Endpoint Type</span>
              <Badge variant="outline" className="font-mono text-[10px]">
                {model.endpoint_type}
              </Badge>
            </div>
            <div className="flex items-center justify-between p-2.5">
              <span className="text-zinc-500">Model ID</span>
              <span className="font-mono text-[11px] text-zinc-700 dark:text-zinc-300">
                {model.model_id}
              </span>
            </div>
            {model.release_date && (
              <div className="flex items-center justify-between p-2.5">
                <span className="text-zinc-500">Release Date</span>
                <span className="text-zinc-700 dark:text-zinc-300">
                  {model.release_date}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Section: Pricing */}
        <div className="flex flex-col gap-2">
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
            Pricing (per 1 Million Tokens)
          </h3>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-zinc-200 bg-white p-2.5 dark:border-zinc-800 dark:bg-zinc-900/30">
              <span className="text-[10px] text-zinc-400">Input Price</span>
              <div className="mt-0.5 font-semibold text-zinc-800 dark:text-zinc-200">
                {fmtPrice(model.input_price)}
              </div>
            </div>
            <div className="rounded-lg border border-zinc-200 bg-white p-2.5 dark:border-zinc-800 dark:bg-zinc-900/30">
              <span className="text-[10px] text-zinc-400">Output Price</span>
              <div className="mt-0.5 font-semibold text-zinc-800 dark:text-zinc-200">
                {fmtPrice(model.output_price)}
              </div>
            </div>
            <div className="rounded-lg border border-zinc-200 bg-white p-2.5 dark:border-zinc-800 dark:bg-zinc-900/30">
              <span className="text-[10px] text-zinc-400">Cache Read</span>
              <div className="mt-0.5 font-semibold text-zinc-800 dark:text-zinc-200">
                {fmtPrice(model.cache_read_price)}
              </div>
            </div>
            <div className="rounded-lg border border-zinc-200 bg-white p-2.5 dark:border-zinc-800 dark:bg-zinc-900/30">
              <span className="text-[10px] text-zinc-400">Cache Write</span>
              <div className="mt-0.5 font-semibold text-zinc-800 dark:text-zinc-200">
                {fmtPrice(model.cache_write_price)}
              </div>
            </div>
          </div>
        </div>

        {/* Section: Limits */}
        <div className="flex flex-col gap-2">
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
            Token & Context Limits
          </h3>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-zinc-200 bg-white p-2.5 dark:border-zinc-800 dark:bg-zinc-900/30">
              <span className="text-[10px] text-zinc-400">Context Window</span>
              <div className="mt-0.5 font-semibold text-zinc-800 dark:text-zinc-200">
                {model.context_window
                  ? `${model.context_window.toLocaleString()} tokens`
                  : "Unspecified"}
              </div>
            </div>
            <div className="rounded-lg border border-zinc-200 bg-white p-2.5 dark:border-zinc-800 dark:bg-zinc-900/30">
              <span className="text-[10px] text-zinc-400">Max Output</span>
              <div className="mt-0.5 font-semibold text-zinc-800 dark:text-zinc-200">
                {model.max_output_tokens
                  ? `${model.max_output_tokens.toLocaleString()} tokens`
                  : "Unspecified"}
              </div>
            </div>
          </div>
        </div>

        {/* Section: Capabilities */}
        <div className="flex flex-col gap-2">
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
            Capabilities
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {activeCaps.map((cap) => (
              <CapabilityBadge key={cap} capability={cap} />
            ))}
          </div>
        </div>

        {/* Description */}
        {model.description && (
          <div className="flex flex-col gap-1.5">
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
              Description
            </h3>
            <p className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
              {model.description}
            </p>
          </div>
        )}
      </div>
    </DetailPanel>
  );
}
