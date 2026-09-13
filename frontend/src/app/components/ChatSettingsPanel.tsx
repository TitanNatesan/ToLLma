"use client";

import { motion } from "framer-motion";
import { useModels, useProviders } from "@/hooks/useRegistry";
import { useUsage } from "@/hooks/useChat";
import { useChatStore } from "@/store/chat";
import type { ComponentType } from "react";
import {
  Brain,
  ChevronLeft,
  ChevronRight,
  Eye,
  FileText,
  Image as ImageIcon,
  Mic,
  Volume2,
  Wrench,
  Zap,
} from "lucide-react";
import { Badge, Tooltip } from "@/components/ui";
import { cn } from "@/lib/utils";

const CAPS: Array<[string, ComponentType<{ className?: string }>, string]> = [
  ["supports_text", FileText, "Text generation"],
  ["supports_vision", Eye, "Vision"],
  ["supports_audio_input", Mic, "Audio input"],
  ["supports_audio_output", Volume2, "Audio output"],
  ["supports_image_generation", ImageIcon, "Image generation"],
  ["supports_tool_calling", Wrench, "Tool calling"],
  ["supports_reasoning", Brain, "Extended reasoning"],
  ["supports_streaming", Zap, "Streaming"],
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">{title}</h3>
      {children}
    </section>
  );
}

function StatRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="shrink-0 text-xs text-zinc-500">{label}</span>
      <span className="truncate text-right text-xs font-medium text-zinc-800 dark:text-zinc-200">{value}</span>
    </div>
  );
}

export function IntelligencePanel() {
  const { providerId, modelId, activeConversationId, rightSidebarOpen, setRightSidebar } = useChatStore();
  const { data: providers = [] } = useProviders();
  const { data: models = [] } = useModels(providerId ?? undefined, undefined, { enabled: !!providerId });
  const { data: usage } = useUsage(activeConversationId);

  const provider = providers.find((p) => p.id === providerId);
  const model = models.find((m) => m.id === modelId);
  const activeCaps = model
    ? CAPS.filter(([key]) => (model as unknown as Record<string, boolean>)[key])
    : [];

  function formatCost(val: string): string {
    const n = parseFloat(val);
    if (!n) return "$0";
    return n < 0.0001 ? `$${n.toExponential(2)}` : `$${n.toFixed(4)}`;
  }

  return (
    <>
      {/* Collapse toggle */}
      <button
        className={cn(
          "fixed right-0 top-1/2 z-20 -translate-y-1/2 rounded-l-md border border-r-0 border-zinc-200 bg-white px-1 py-3 text-xs text-zinc-400 shadow-sm transition-all hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900",
          rightSidebarOpen ? "-translate-x-56" : "translate-x-0",
        )}
        onClick={() => setRightSidebar(!rightSidebarOpen)}
        aria-label={rightSidebarOpen ? "Collapse intelligence panel" : "Expand intelligence panel"}
        data-testid="right-sidebar-toggle"
        style={{ transition: "transform 0.25s" }}
      >
        {rightSidebarOpen ? <ChevronRight className="size-3 text-zinc-400" /> : <ChevronLeft className="size-3 text-zinc-400" />}
      </button>

      <motion.aside
        animate={{ width: rightSidebarOpen ? 224 : 0 }}
        transition={{ duration: 0.25, ease: "easeInOut" }}
        className="relative flex shrink-0 flex-col overflow-hidden border-l border-zinc-200 dark:border-zinc-800"
        aria-label="Intelligence panel"
        data-testid="right-sidebar"
      >
        <div className="flex min-h-0 w-56 flex-1 flex-col gap-4 overflow-y-auto p-3">
          <h2 className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">Intelligence</h2>

          {/* Model section */}
          {model ? (
            <Section title="Model">
              <div className="flex flex-col gap-1.5">
                <p className="truncate text-sm font-semibold" data-testid="model-details-name">{model.name}</p>
                <StatRow label="Context" value={model.context_window ? `${(model.context_window / 1000).toFixed(0)}k tokens` : "—"} />
                <StatRow label="Max out" value={model.max_output_tokens ? `${(model.max_output_tokens / 1000).toFixed(0)}k tokens` : "—"} />
                <StatRow label="Price in" value={`$${model.input_price}/1M`} />
                <StatRow label="Price out" value={`$${model.output_price}/1M`} />
              </div>
              {activeCaps.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {activeCaps.map(([, Icon, label]) => (
                    <Tooltip key={label} content={label}>
                      <Badge variant="secondary" className="cursor-default gap-1 text-[10px]">
                        <Icon className="size-3 text-zinc-500" />
                        <span className="hidden sm:inline">{label.split(" ")[0]}</span>
                      </Badge>
                    </Tooltip>
                  ))}
                </div>
              )}
            </Section>
          ) : (
            <Section title="Model">
              <p className="text-xs text-zinc-400">No model selected</p>
            </Section>
          )}

          {/* Provider section */}
          {provider && (
            <Section title="Provider">
              <div className="flex flex-col gap-1.5">
                <p className="truncate text-sm font-medium">{provider.name}</p>
                <StatRow label="Type" value={provider.provider_type} />
                <StatRow
                  label="Status"
                  value={
                    <Badge
                      variant={
                        provider.validation_status === "valid"
                          ? "success"
                          : provider.validation_status === "invalid"
                            ? "destructive"
                            : "outline"
                      }
                      className="text-[10px]"
                    >
                      {provider.validation_status}
                    </Badge>
                  }
                />
                {provider.last_validated_at && (
                  <StatRow
                    label="Validated"
                    value={new Date(provider.last_validated_at).toLocaleDateString()}
                  />
                )}
              </div>
            </Section>
          )}

          {/* Usage section */}
          {usage && usage.total_tokens > 0 && (
            <Section title="Conversation Usage">
              <div className="flex flex-col gap-1.5" data-testid="usage-summary">
                <StatRow label="Prompt" value={<span data-testid="usage-prompt">{usage.prompt_tokens.toLocaleString()}</span>} />
                <StatRow label="Completion" value={<span data-testid="usage-completion">{usage.completion_tokens.toLocaleString()}</span>} />
                <StatRow label="Total" value={<span data-testid="usage-total">{usage.total_tokens.toLocaleString()} tok</span>} />
                <StatRow label="Cost" value={<span data-testid="usage-cost">{formatCost(usage.total_cost)}</span>} />
                <StatRow label="In / Out" value={`${formatCost(usage.input_cost)} / ${formatCost(usage.output_cost)}`} />
              </div>
            </Section>
          )}

          {!provider && !model && (
            <p className="text-xs text-zinc-400">
              Select a provider and model in the chat composer to see details here.
            </p>
          )}
        </div>
      </motion.aside>
    </>
  );
}
