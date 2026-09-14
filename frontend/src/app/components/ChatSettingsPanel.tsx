"use client";

import { motion } from "framer-motion";
import { useModels, useProviders } from "@/hooks/useRegistry";
import { useConversation, useUsage } from "@/hooks/useChat";
import { useChatStore } from "@/store/chat";
import {
  Badge,
  Button,
  CapabilityBadge,
  CostCard,
  Tooltip,
  UsageCard,
} from "@/components/ui";
import {
  Bot,
  Brain,
  Cpu,
  Database,
  FileCode2,
  HelpCircle,
  Layers,
  PanelRightClose,
  Sparkles,
  Workflow,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";

function Section({
  title,
  icon: Icon,
  badge,
  children,
}: {
  title: string;
  icon?: typeof Bot;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900/40 shadow-xs">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
          {Icon && <Icon className="size-3 text-zinc-400" />}
          <span>{title}</span>
        </div>
        {badge}
      </div>
      {children}
    </section>
  );
}

function StatRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-0.5">
      <span className="shrink-0 text-xs text-zinc-500">{label}</span>
      <span
        className={cn(
          "truncate text-right text-xs font-medium text-zinc-800 dark:text-zinc-200",
          mono && "font-mono",
        )}
      >
        {value}
      </span>
    </div>
  );
}

const ALL_CAPS = [
  "supports_text",
  "supports_vision",
  "supports_audio_input",
  "supports_audio_output",
  "supports_image_generation",
  "supports_tool_calling",
  "supports_reasoning",
  "supports_streaming",
  "supports_embeddings",
] as const;

export function IntelligencePanel() {
  const {
    providerId,
    modelId,
    activeConversationId,
    rightSidebarOpen,
    setRightSidebar,
  } = useChatStore();

  const { data: providers = [] } = useProviders();
  const { data: models = [] } = useModels();
  const { data: usage } = useUsage(activeConversationId);
  const { data: conv } = useConversation(activeConversationId);

  const provider = providers.find((p) => p.id === providerId);
  const model = models.find((m) => m.id === modelId);

  function formatCost(val: string): string {
    const n = parseFloat(val);
    if (!n) return "$0";
    return n < 0.0001 ? `$${n.toExponential(2)}` : `$${n.toFixed(4)}`;
  }

  const messageCount = conv?.messages?.length ?? 0;

  return (
    <>
      <motion.aside
        animate={{ width: rightSidebarOpen ? 256 : 0 }}
        transition={{ duration: 0.25, ease: "easeInOut" }}
        className="relative flex shrink-0 flex-col overflow-hidden border-l border-zinc-200 bg-zinc-50/40 dark:border-zinc-800 dark:bg-zinc-950/40"
        aria-label="Intelligence panel"
        data-testid="right-sidebar"
        style={{ width: rightSidebarOpen ? 256 : 0 }}
      >
        <div className="flex h-full w-64 flex-col overflow-hidden">
          {/* Panel Header */}
          <div className="flex items-center justify-between border-b border-zinc-200 px-3.5 py-3 dark:border-zinc-800 bg-white/70 dark:bg-zinc-950/70">
            <div className="flex items-center gap-1.5">
              <Sparkles className="size-3.5 text-zinc-500" />
              <h2 className="text-xs font-semibold text-zinc-800 dark:text-zinc-200 uppercase tracking-wider">
                Model Intelligence
              </h2>
            </div>
            <div className="flex items-center gap-1.5">
              {model && (
                <Badge variant="outline" className="text-[9px] font-mono px-1 py-0">
                  {model.endpoint_type}
                </Badge>
              )}
              <Tooltip content="Hide Intelligence">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0 text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                  onClick={() => setRightSidebar(false)}
                  aria-label="Close intelligence panel"
                  data-testid="right-sidebar-toggle"
                >
                  <PanelRightClose className="size-3.5" />
                </Button>
              </Tooltip>
            </div>
          </div>

          {/* Scrollable Content */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {/* 1. Model Info */}
            {model ? (
              <Section title="Model" icon={Bot}>
                <div className="flex flex-col gap-1">
                  <p
                    className="truncate text-xs font-bold text-zinc-900 dark:text-zinc-100"
                    data-testid="model-details-name"
                  >
                    {model.name}
                  </p>
                  <p className="text-[10px] text-zinc-400 font-mono truncate">
                    {model.model_id}
                  </p>
                  {provider && (
                    <StatRow label="Provider" value={provider.name} />
                  )}
                  <StatRow label="Endpoint" value={model.endpoint_type} mono />
                </div>
              </Section>
            ) : (
              <Section title="Model" icon={Bot}>
                <p className="text-xs text-zinc-400 py-2">No model selected</p>
              </Section>
            )}

            {/* 2. Capabilities */}
            {model && (
              <Section title="Capabilities" icon={Zap}>
                <div className="flex flex-wrap gap-1">
                  {ALL_CAPS.filter((k) => (model as unknown as Record<string, boolean>)[k]).map(
                    (cap) => (
                      <CapabilityBadge key={cap} capability={cap} compact />
                    ),
                  )}
                </div>
              </Section>
            )}

            {/* 3. Limits */}
            {model && (
              <Section title="Limits" icon={Layers}>
                <div className="flex flex-col gap-0.5">
                  <StatRow
                    label="Context Window"
                    value={
                      model.context_window
                        ? `${(model.context_window / 1000).toFixed(0)}k tokens`
                        : "—"
                    }
                    mono
                  />
                  <StatRow
                    label="Max Output"
                    value={
                      model.max_output_tokens
                        ? `${(model.max_output_tokens / 1000).toFixed(0)}k tokens`
                        : "—"
                    }
                    mono
                  />
                </div>
              </Section>
            )}

            {/* 4. Pricing */}
            {model && (
              <Section title="Pricing (/1M Tokens)" icon={Cpu}>
                <div className="flex flex-col gap-0.5 font-mono">
                  <StatRow label="Input Price" value={`$${model.input_price}`} mono />
                  <StatRow label="Output Price" value={`$${model.output_price}`} mono />
                  {model.cache_read_price !== "0.000000" && (
                    <StatRow label="Cache Read" value={`$${model.cache_read_price}`} mono />
                  )}
                  {model.cache_write_price !== "0.000000" && (
                    <StatRow label="Cache Write" value={`$${model.cache_write_price}`} mono />
                  )}
                </div>
              </Section>
            )}

            {/* 5. Current Conversation Telemetry */}
            {usage && usage.total_tokens > 0 && (
              <Section title="Current Conversation" icon={Workflow}>
                <div className="flex flex-col gap-1" data-testid="usage-summary">
                  <StatRow
                    label="Prompt"
                    value={<span data-testid="usage-prompt">{usage.prompt_tokens.toLocaleString()}</span>}
                    mono
                  />
                  <StatRow
                    label="Completion"
                    value={<span data-testid="usage-completion">{usage.completion_tokens.toLocaleString()}</span>}
                    mono
                  />
                  <StatRow
                    label="Total"
                    value={<span data-testid="usage-total">{usage.total_tokens.toLocaleString()} tok</span>}
                    mono
                  />
                  <StatRow
                    label="Total Cost"
                    value={<span data-testid="usage-cost" className="text-emerald-600 dark:text-emerald-400 font-bold">{formatCost(usage.total_cost)}</span>}
                    mono
                  />
                  <StatRow label="Messages" value={messageCount} mono />
                </div>

                {/* By provider breakdown */}
                {usage.by_provider.length > 0 && (
                  <div className="mt-2 border-t border-zinc-100 pt-1.5 dark:border-zinc-800" data-testid="usage-by-provider">
                    <p className="text-[9px] font-semibold uppercase text-zinc-400 mb-1">
                      By Provider
                    </p>
                    {usage.by_provider.map((b) => (
                      <StatRow
                        key={b.provider_id ?? "unknown"}
                        label={b.provider_name ?? "unknown"}
                        value={`${b.total_tokens.toLocaleString()} tok · ${formatCost(b.total_cost)}`}
                        mono
                      />
                    ))}
                  </div>
                )}

                {/* By model breakdown */}
                {usage.by_model.length > 0 && (
                  <div className="mt-2 border-t border-zinc-100 pt-1.5 dark:border-zinc-800" data-testid="usage-by-model">
                    <p className="text-[9px] font-semibold uppercase text-zinc-400 mb-1">
                      By Model
                    </p>
                    {usage.by_model.map((b) => (
                      <StatRow
                        key={b.model_id ?? "unknown"}
                        label={b.model_name ?? "unknown"}
                        value={`${b.total_tokens.toLocaleString()} tok · ${formatCost(b.total_cost)}`}
                        mono
                      />
                    ))}
                  </div>
                )}
              </Section>
            )}

            {/* 6. Future Ready Reserved Sections */}
            <Section
              title="Reasoning & Tooling"
              icon={Brain}
              badge={
                <span className="text-[9px] text-zinc-400 rounded bg-zinc-100 dark:bg-zinc-800 px-1">
                  Ready
                </span>
              }
            >
              <div className="space-y-1.5 text-[11px] text-zinc-500">
                <div className="flex items-center justify-between">
                  <span>Chain-of-Thought:</span>
                  <span className="text-zinc-400">Supported (&lt;think&gt;)</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Diagrams:</span>
                  <span className="text-emerald-500 font-medium">Mermaid SVG</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Tool Calls &amp; Citations:</span>
                  <span className="text-zinc-400">Telemetry Ready</span>
                </div>
              </div>
            </Section>

            {!provider && !model && (
              <p className="text-xs text-zinc-400 p-2">
                Select a provider and model in the chat composer to see details here.
              </p>
            )}
          </div>
        </div>
      </motion.aside>
    </>
  );
}
