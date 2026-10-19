"use client";

import { useEffect, useRef, useState, type ComponentType } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useModels, useProviders } from "@/hooks/useRegistry";
import { useConversation, useUsage } from "@/hooks/useChat";
import { useChatStore } from "@/store/chat";
import { Badge, Button, Tooltip } from "@/components/ui";
import {
  Brain,
  Check,
  Cpu,
  Database,
  Layers,
  MessageSquarePlus,
  PanelRightClose,
  Sparkles,
  Workflow,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtCompactTokens, fmtCost, fmtPrice, fmtTokens } from "@/lib/utils";
import { getModelCapabilities, mediaRates } from "@/app/components/chat/capabilities";
import { endpointLabel } from "@/app/providers/fields";
import { logoForProviderType } from "@/services/catalog";
import { ProviderLogo } from "@/components/ui/ProviderLogo";

export const INTELLIGENCE_MIN_WIDTH = 320;
export const INTELLIGENCE_MAX_WIDTH = 700;
export const INTELLIGENCE_DEFAULT_WIDTH = 380;

function Section({
  title,
  icon: Icon,
  badge,
  testid,
  children,
}: {
  title: string;
  icon?: ComponentType<{ className?: string }>;
  badge?: React.ReactNode;
  testid?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900/40 shadow-xs"
      data-testid={testid}
    >
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

function CapabilityChip({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-tollma-500/30 bg-tollma-50 px-1.5 py-px text-[10px] font-medium text-tollma-700 dark:border-tollma-500/30 dark:bg-tollma-950 dark:text-tollma-300">
      <Check className="size-2.5" aria-hidden />
      {label}
    </span>
  );
}

function ContextUsageBar({ used, limit }: { used: number; limit: number }) {
  const pct = Math.min(100, Math.max(0, (used / Math.max(limit, 1)) * 100));
  const nearCap = pct >= 85;
  return (
    <div className="pt-1.5" data-testid="intelligence-context-usage">
      <div className="h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800" role="progressbar"
        aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}
        aria-label={`Context usage ${fmtTokens(used)} of ${fmtCompactTokens(limit)} tokens`}>
        <div
          className={`h-full rounded-full transition-[width] ${nearCap ? "bg-amber-500" : "bg-tollma-500"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-1 text-[10px] text-zinc-500 dark:text-zinc-400">
        <span className="font-mono">{fmtTokens(used)}</span> of{" "}
        <span className="font-mono">{fmtCompactTokens(limit)}</span> context used
      </p>
    </div>
  );
}

function SupportValue({ on }: { on: boolean }) {
  return (
    <span className={on ? "text-tollma-600 font-medium dark:text-tollma-400" : "text-zinc-400"}>
      {on ? "Supported" : "—"}
    </span>
  );
}

export function IntelligencePanel() {
  const {
    providerId,
    modelId,
    activeConversationId,
    rightSidebarOpen,
    rightSidebarWidth,
    setRightSidebar,
    setRightSidebarWidth,
  } = useChatStore();

  const { data: providers = [] } = useProviders();
  const { data: models = [] } = useModels();
  const { data: usage } = useUsage(activeConversationId);
  const { data: conv } = useConversation(activeConversationId);

  const provider = providers.find((p) => p.id === providerId);
  const model = models.find((m) => m.id === modelId);
  const caps = getModelCapabilities(model);
  const rates = mediaRates(model);
  const cacheSavings = parseFloat(usage?.cache_savings ?? "0") || 0;
  const cacheActive =
    (usage?.cache_read_tokens ?? 0) > 0 || (usage?.cache_write_tokens ?? 0) > 0;

  const messageCount = conv?.messages?.length ?? 0;
  const width = Math.min(
    Math.max(rightSidebarWidth || INTELLIGENCE_DEFAULT_WIDTH, INTELLIGENCE_MIN_WIDTH),
    INTELLIGENCE_MAX_WIDTH,
  );

  // Resizing state (mirrors the conversation sidebar handle)
  const [isResizing, setIsResizing] = useState(false);

  // Below md the panel becomes an overlay drawer (it overlays content).
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!isResizing) return;
    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = Math.min(
        Math.max(window.innerWidth - e.clientX, INTELLIGENCE_MIN_WIDTH),
        INTELLIGENCE_MAX_WIDTH,
      );
      setRightSidebarWidth(newWidth);
    };
    const handleMouseUp = () => setIsResizing(false);
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizing, setRightSidebarWidth]);

  // Close-on-navigate: switching conversations dismisses the mobile overlay
  // (tracked via ref so the initial mount never closes the panel).
  const prevConversationRef = useRef(activeConversationId);
  useEffect(() => {
    if (prevConversationRef.current !== activeConversationId) {
      prevConversationRef.current = activeConversationId;
      if (isMobile) setRightSidebar(false);
    }
  }, [activeConversationId, isMobile, setRightSidebar]);

  // Escape dismisses the mobile overlay.
  useEffect(() => {
    if (!isMobile || !rightSidebarOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setRightSidebar(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isMobile, rightSidebarOpen, setRightSidebar]);

  const panelInner = (
    <div
      className="flex h-full flex-col overflow-hidden"
      style={isMobile ? { width: "100%" } : { width }}
    >
          {/* Panel Header */}
          <div className="flex items-center justify-between border-b border-zinc-200 px-3.5 py-3 dark:border-zinc-800 bg-white/70 dark:bg-zinc-950/70">
            <div className="flex items-center gap-1.5">
              <Sparkles className="size-3.5 text-zinc-500" />
              <h2 className="text-xs font-semibold text-zinc-800 dark:text-zinc-200 uppercase tracking-wider">
                Model Intelligence
              </h2>
            </div>
            <div className="flex items-center gap-1.5">
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

          {/* Scrollable Content — starts with Current Conversation */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {/* 0. Selected model hero */}
            {model && (
              <section
                aria-label="Selected model"
                data-testid="intelligence-model"
                className="rounded-lg border border-zinc-200 bg-gradient-to-b from-zinc-50 to-white p-3 dark:border-zinc-800 dark:from-zinc-900/60 dark:to-transparent"
              >
                <div className="flex items-center gap-2.5">
                  <ProviderLogo
                    logoUrl={logoForProviderType(provider?.provider_type ?? null)}
                    name={model.name}
                    size="md"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100" title={model.name}>
                      {model.name}
                    </p>
                    <p className="truncate text-[11px] text-zinc-500 dark:text-zinc-400">
                      {provider?.name ?? "Unknown provider"}
                    </p>
                  </div>
                  <Badge variant="outline" className="shrink-0 text-[9px] px-1 py-0">
                    {endpointLabel(model.primary_endpoint ?? model.endpoint_type)}
                  </Badge>
                </div>
                {(caps.supportsReasoning || caps.supportsVision || caps.supportsToolCalling || caps.supportsStreaming || caps.supportsAudioInput || caps.supportsFiles) && (
                  <div className="mt-2 flex flex-wrap gap-1" data-testid="intelligence-caps">
                    {caps.supportsReasoning && <CapabilityChip label="Reasoning" />}
                    {caps.supportsToolCalling && <CapabilityChip label="Tools" />}
                    {caps.supportsStreaming && <CapabilityChip label="Streaming" />}
                    {caps.supportsVision && <CapabilityChip label="Vision" />}
                    {caps.supportsAudioInput && <CapabilityChip label="Audio" />}
                    {caps.supportsFiles && <CapabilityChip label="Files" />}
                  </div>
                )}
                {caps.supportsReasoning && caps.reasoningLevels.length > 0 && (
                  <p className="mt-1.5 text-[10px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                    Thinking: <span className="font-medium capitalize text-zinc-700 dark:text-zinc-300">{caps.reasoningLevels.join(" · ")}</span>
                  </p>
                )}
              </section>
            )}
            {/* 1. Current Conversation — top priority */}
            <Section title="Current Conversation" icon={Workflow} testid="intelligence-conversation">
              <div className="flex flex-col gap-1" data-testid="usage-summary">
                <StatRow
                  label="Prompt Tokens"
                  value={<span data-testid="usage-prompt">{fmtTokens(usage?.prompt_tokens ?? 0)}</span>}
                  mono
                />
                <StatRow
                  label="Completion Tokens"
                  value={<span data-testid="usage-completion">{fmtTokens(usage?.completion_tokens ?? 0)}</span>}
                  mono
                />
                <StatRow
                  label="Total Tokens"
                  value={<span data-testid="usage-total">{fmtTokens(usage?.total_tokens ?? 0)} tok</span>}
                  mono
                />
                <StatRow label="Messages" value={fmtTokens(messageCount)} mono />
                <StatRow
                  label="Cost"
                  value={<span data-testid="usage-cost" className="text-tollma-600 dark:text-tollma-400 font-bold">{fmtCost(usage?.total_cost)}</span>}
                  mono
                />
                {model?.context_window ? (
                  <ContextUsageBar
                    used={usage?.total_tokens ?? 0}
                    limit={model.context_window}
                  />
                ) : null}
              </div>

              {/* By provider breakdown */}
              {(usage?.by_provider.length ?? 0) > 0 && (
                <div className="mt-2 border-t border-zinc-100 pt-1.5 dark:border-zinc-800" data-testid="usage-by-provider">
                  <p className="text-[9px] font-semibold uppercase text-zinc-400 mb-1">
                    By Provider
                  </p>
                  {usage!.by_provider.map((b) => (
                    <StatRow
                      key={b.provider_id ?? "unknown"}
                      label={b.provider_name ?? "unknown"}
                      value={`${fmtTokens(b.total_tokens)} tok · ${fmtCost(b.total_cost)}`}
                      mono
                    />
                  ))}
                </div>
              )}

              {/* By model breakdown */}
              {(usage?.by_model.length ?? 0) > 0 && (
                <div className="mt-2 border-t border-zinc-100 pt-1.5 dark:border-zinc-800" data-testid="usage-by-model">
                  <p className="text-[9px] font-semibold uppercase text-zinc-400 mb-1">
                    By Model
                  </p>
                  {usage!.by_model.map((b) => (
                    <StatRow
                      key={b.model_id ?? "unknown"}
                      label={b.model_name ?? "unknown"}
                      value={`${fmtTokens(b.total_tokens)} tok · ${fmtCost(b.total_cost)}`}
                      mono
                    />
                  ))}
                </div>
              )}
            </Section>

            {/* 2. Limits */}
            {model && (
              <Section title="Limits" icon={Layers} testid="intelligence-limits">
                <div className="flex flex-col gap-0.5">
                  <StatRow
                    label="Context Window"
                    value={
                      model.context_window
                        ? `${fmtCompactTokens(model.context_window)} tokens`
                        : "—"
                    }
                    mono
                  />
                  <StatRow
                    label="Max Output Tokens"
                    value={
                      model.max_output_tokens
                        ? `${fmtCompactTokens(model.max_output_tokens)} tokens`
                        : "—"
                    }
                    mono
                  />
                </div>
              </Section>
            )}

            {/* 3. Pricing (/1M Tokens) */}
            {model && (
              <Section title="Pricing (/1M Tokens)" icon={Cpu} testid="intelligence-pricing">
                <div className="flex flex-col gap-0.5 font-mono">
                  <StatRow label="Input Price" value={fmtPrice(model.input_price)} mono />
                  <StatRow label="Output Price" value={fmtPrice(model.output_price)} mono />
                  <StatRow label="Cache Read" value={fmtPrice(model.cache_read_price)} mono />
                  <StatRow label="Cache Write" value={fmtPrice(model.cache_write_price)} mono />
                  {(rates.imageLow || rates.imageMedium || rates.imageHigh) && (
                    <div
                      className="mt-1 border-t border-zinc-100 pt-1 dark:border-zinc-800"
                      data-testid="intelligence-media-pricing"
                    >
                      <p className="mb-1 text-[9px] font-semibold uppercase text-zinc-400">
                        Media (/image)
                      </p>
                      {rates.imageLow && <StatRow label="Image · low" value={fmtCost(rates.imageLow)} mono />}
                      {rates.imageMedium && (
                        <StatRow label="Image · medium" value={fmtCost(rates.imageMedium)} mono />
                      )}
                      {rates.imageHigh && (
                        <StatRow label="Image · high" value={fmtCost(rates.imageHigh)} mono />
                      )}
                    </div>
                  )}
                  {rates.videoPerSecond && (
                    <div className="mt-1 border-t border-zinc-100 pt-1 dark:border-zinc-800">
                      <StatRow
                        label="Video · per second"
                        value={fmtCost(rates.videoPerSecond)}
                        mono
                      />
                    </div>
                  )}
                </div>
              </Section>
            )}

            {/* 3b. Prompt Cache — capability + live cache metrics */}
            <Section
              title="Prompt Cache"
              icon={Database}
              testid="intelligence-cache"
              badge={
                caps.supportsPromptCaching ? (
                  <span className="text-[9px] text-tollma-600 rounded bg-tollma-100 dark:bg-tollma-900 dark:text-tollma-300 px-1">
                    ✓ Enabled
                  </span>
                ) : (
                  <span className="text-[9px] text-zinc-400 rounded bg-zinc-100 dark:bg-zinc-800 px-1">
                    Not Supported
                  </span>
                )
              }
            >
              <div className="flex flex-col gap-0.5">
                <StatRow
                  label="Prompt Cache"
                  value={
                    caps.supportsPromptCaching ? (
                      <span className="text-tollma-600 dark:text-tollma-400">✓ Enabled</span>
                    ) : (
                      <span className="text-zinc-400">Not Supported</span>
                    )
                  }
                />
                {cacheActive && (
                  <>
                    <StatRow
                      label="Cached Tokens"
                      value={<span data-testid="cache-read-tokens">{fmtTokens(usage?.cache_read_tokens ?? 0)}</span>}
                      mono
                    />
                    {(usage?.cache_write_tokens ?? 0) > 0 && (
                      <StatRow
                        label="Cache Write Tokens"
                        value={fmtTokens(usage?.cache_write_tokens ?? 0)}
                        mono
                      />
                    )}
                    {cacheSavings > 0 && (
                      <StatRow
                        label="Cache Savings"
                        value={
                          <span
                            className="text-tollma-600 dark:text-tollma-400"
                            data-testid="cache-savings"
                          >
                            {fmtCost(cacheSavings)}
                          </span>
                        }
                        mono
                      />
                    )}
                    <p className="mt-0.5 text-[9px] text-zinc-400">
                      Estimated savings vs. full input price
                    </p>
                  </>
                )}
                {!cacheActive && caps.supportsPromptCaching && (
                  <p className="text-[10px] text-zinc-400">
                    No cached requests yet in this conversation.
                  </p>
                )}
              </div>
            </Section>

            {/* 4. Reasoning & Tooling — single home for capability info */}
            <Section
              title="Reasoning & Tooling"
              icon={Brain}
              testid="intelligence-reasoning"
              badge={
                model && caps.supportsReasoning ? (
                  <span className="text-[9px] text-tollma-600 rounded bg-tollma-100 dark:bg-tollma-900 dark:text-tollma-300 px-1">
                    Ready
                  </span>
                ) : undefined
              }
            >
              <div className="flex flex-col gap-0.5">
                <StatRow label="Reasoning" value={<SupportValue on={caps.supportsReasoning} />} />
                {caps.supportsReasoning && caps.reasoningLevels.length > 0 && (
                  <StatRow
                    label="Thinking"
                    value={<span className="capitalize">{caps.reasoningLevels.join(" · ")}</span>}
                    mono
                  />
                )}
                <StatRow label="Tool Calling" value={<SupportValue on={caps.supportsToolCalling} />} />
                <StatRow label="Streaming" value={<SupportValue on={caps.supportsStreaming} />} />
                <StatRow label="Vision" value={<SupportValue on={caps.supportsVision} />} />
                <StatRow label="Audio" value={<SupportValue on={caps.supportsAudioInput} />} />
                <StatRow label="Video" value={<SupportValue on={caps.supportsVideoInput} />} />
                <StatRow label="Files" value={<SupportValue on={caps.supportsFiles} />} />
                <StatRow
                  label="Image Generation"
                  value={<SupportValue on={caps.supportsImageGeneration} />}
                />
                <StatRow
                  label="Image Editing"
                  value={<SupportValue on={caps.supportsImageEditing} />}
                />
                <StatRow
                  label="Video Generation"
                  value={<SupportValue on={caps.supportsVideoGeneration} />}
                />
                <StatRow
                  label="Diagrams"
                  value={<span className="text-tollma-500 font-medium">Mermaid SVG</span>}
                />
                <StatRow label="Citations" value={<span className="text-zinc-400">Telemetry Ready</span>} />
              </div>
            </Section>

            {!provider && !model && (
              <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-zinc-300 px-4 py-6 text-center dark:border-zinc-800">
                <span className="flex size-9 items-center justify-center rounded-full bg-zinc-100 text-zinc-400 dark:bg-zinc-800">
                  <MessageSquarePlus className="size-4" aria-hidden />
                </span>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Select a provider and model in the chat composer to see details here.
                </p>
              </div>
            )}
          </div>
        </div>
  );

  // Below md the panel renders as an overlay drawer (backdrop + slide-in) so
  // the composer keeps the full viewport width instead of being squeezed.
  if (isMobile) {
    return (
      <>
        <AnimatePresence>
          {rightSidebarOpen && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 z-40 bg-black/40 md:hidden"
              onClick={() => setRightSidebar(false)}
              aria-hidden="true"
              data-testid="intelligence-backdrop"
            />
          )}
        </AnimatePresence>
        <AnimatePresence>
          {rightSidebarOpen && (
            <motion.aside
              initial={{ x: "100%", opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: "100%", opacity: 0 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="fixed inset-y-0 right-0 z-50 flex w-[min(92vw,380px)] flex-col overflow-hidden border-l border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 md:hidden"
              aria-label="Intelligence panel"
              data-testid="right-sidebar"
            >
              {panelInner}
            </motion.aside>
          )}
        </AnimatePresence>
      </>
    );
  }

  return (
    <>
      <motion.aside
        animate={{ width: rightSidebarOpen ? width : 0 }}
        transition={{ duration: isResizing ? 0 : 0.25, ease: "easeInOut" }}
        className="relative flex shrink-0 flex-col overflow-hidden border-l border-zinc-200 bg-zinc-50/40 dark:border-zinc-800 dark:bg-zinc-950/40"
        aria-label="Intelligence panel"
        data-testid="right-sidebar"
        style={{ width: rightSidebarOpen ? width : 0 }}
      >
        {panelInner}

        {/* Resizer Handle */}
        <div
          data-testid="intelligence-resizer"
          onMouseDown={() => setIsResizing(true)}
          className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-zinc-400/50 active:bg-zinc-500 transition-colors z-10"
        />
      </motion.aside>
    </>
  );
}
