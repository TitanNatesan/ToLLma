"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useChatStore } from "@/store/chat";
import { useModels, useProviders } from "@/hooks/useRegistry";
import {
  Button,
  Badge,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui";
import { cn } from "@/lib/utils";
import type { AIModel, Provider } from "@/types";

import type { ComponentType } from "react";
import {
  Bot,
  Brain,
  ChevronDown,
  CornerDownLeft,
  Cpu,
  Eye,
  Image as ImageIcon,
  Mic,
  Search,
  Square,
  Wrench,
  Zap,
} from "lucide-react";

interface ChatComposerProps {
  streaming: boolean;
  disabled?: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
}

const CAP_ICONS: Record<string, { icon: ComponentType<{ className?: string }>; label: string }> = {
  supports_vision: { icon: Eye, label: "Vision" },
  supports_reasoning: { icon: Brain, label: "Reasoning" },
  supports_tool_calling: { icon: Wrench, label: "Tool calling" },
  supports_streaming: { icon: Zap, label: "Streaming" },
  supports_audio_input: { icon: Mic, label: "Audio input" },
  supports_image_generation: { icon: ImageIcon, label: "Image generation" },
};

function UnifiedModelSelector({
  providers,
  models,
}: {
  providers: Provider[];
  models: AIModel[];
}) {
  const { providerId, modelId, setProvider, setModel } = useChatStore();
  const [search, setSearch] = useState("");

  const activeProvider = providers.find((p) => p.id === providerId);
  const activeModel = models.find((m) => m.id === modelId);

  const caps = activeModel
    ? Object.entries(CAP_ICONS)
        .filter(([k]) => (activeModel as unknown as Record<string, boolean>)[k])
        .map(([, item]) => item)
    : [];

  const q = search.trim().toLowerCase();

  const activeProviders = providers.filter((p) => p.is_active);
  const activeModels = models.filter((m) => m.is_active);

  const groups = activeProviders
    .map((p) => {
      const pModels = activeModels.filter(
        (m) =>
          m.provider_id === p.id &&
          (!q ||
            m.name.toLowerCase().includes(q) ||
            m.model_id.toLowerCase().includes(q) ||
            p.name.toLowerCase().includes(q)),
      );
      return { provider: p, models: pModels };
    })
    .filter((g) => g.models.length > 0 || (q && g.provider.name.toLowerCase().includes(q)));

  const totalMatchingModels = groups.reduce((acc, g) => acc + g.models.length, 0);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            "flex h-7 items-center gap-1.5 rounded-md px-2 text-xs transition-colors",
            "border border-zinc-200 hover:border-zinc-300 hover:bg-zinc-50",
            "dark:border-zinc-700 dark:hover:border-zinc-600 dark:hover:bg-zinc-800",
            !activeModel && "text-zinc-400",
          )}
          data-testid="model-selector"
          aria-label="Select model"
        >
          <Bot className="size-3 text-zinc-500" />
          <span className="max-w-44 truncate font-medium">
            {activeModel ? activeModel.name : "Select model"}
          </span>
          {activeProvider && (
            <span className="hidden sm:inline-flex rounded bg-zinc-100 dark:bg-zinc-800 px-1 py-0.2 text-[9px] text-zinc-500 dark:text-zinc-400 font-normal">
              {activeProvider.name}
            </span>
          )}
          {caps.length > 0 && (
            <span className="hidden items-center gap-1 md:flex">
              {caps.slice(0, 3).map(({ icon: Icon, label }) => (
                <Icon key={label} className="size-2.5 text-zinc-400" />
              ))}
            </span>
          )}
          <ChevronDown className="size-3 text-zinc-400" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-80 p-0 overflow-hidden">
        {/* Search input */}
        <div className="border-b border-zinc-200 p-2 dark:border-zinc-800">
          <div className="relative flex items-center">
            <Search className="absolute left-2 size-3.5 text-zinc-400 pointer-events-none" />
            <input
              type="text"
              placeholder="Search models or providers…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-7 w-full rounded border border-zinc-200 bg-transparent pl-7 pr-2 text-xs outline-none focus:border-zinc-400 dark:border-zinc-700 dark:focus:border-zinc-500"
              autoFocus
            />
          </div>
        </div>

        {/* Scrollable list with min-height and max-height */}
        <div className="min-h-[220px] max-h-[380px] overflow-y-auto p-1.5">
          {totalMatchingModels === 0 ? (
            <div className="flex h-[200px] flex-col items-center justify-center gap-1 text-xs text-zinc-400">
              <Bot className="size-5 opacity-40" />
              <span>No models found</span>
            </div>
          ) : (
            groups.map(({ provider, models: pModels }) => (
              <div key={provider.id} className="mb-2 last:mb-0">
                {/* Provider group header */}
                <div className="sticky top-0 z-10 flex items-center justify-between rounded bg-zinc-100/95 px-2 py-1 text-[11px] font-semibold text-zinc-600 backdrop-blur-sm dark:bg-zinc-900/95 dark:text-zinc-400">
                  <span className="flex items-center gap-1.5 truncate">
                    <Cpu className="size-3 text-zinc-400" />
                    <span className="truncate">{provider.name}</span>
                  </span>
                  <Badge variant="outline" className="text-[9px] px-1 py-0 shrink-0 font-normal">
                    {provider.provider_type}
                  </Badge>
                </div>

                {/* Models in provider */}
                <div className="mt-0.5 space-y-0.5">
                  {pModels.map((m) => {
                    const isSelected = modelId === m.id;
                    const mCaps = Object.entries(CAP_ICONS)
                      .filter(([k]) => (m as unknown as Record<string, boolean>)[k])
                      .map(([, item]) => item);

                    return (
                      <DropdownMenuItem
                        key={m.id}
                        onClick={() => {
                          setProvider(m.provider_id);
                          setModel(m.id);
                        }}
                        data-testid={`model-option-${m.id}`}
                        className={cn(
                          "flex cursor-pointer items-center justify-between rounded px-2 py-1.5 text-xs transition-colors",
                          isSelected
                            ? "bg-tollma-100 font-medium text-tollma-900 dark:bg-tollma-900 dark:text-tollma-100"
                            : "hover:bg-zinc-100 dark:hover:bg-zinc-800/60",
                        )}
                      >
                        <div className="flex flex-1 flex-col gap-0.5 overflow-hidden pr-2">
                          <span className="truncate">{m.name}</span>
                          <span className="text-[10px] text-zinc-400">
                            {m.context_window ? `ctx ${m.context_window.toLocaleString()}` : ""}
                            {m.input_price !== "0.000000" ? ` · $${m.input_price}/1M in` : ""}
                          </span>
                        </div>
                        <span className="flex shrink-0 items-center gap-1">
                          {mCaps.slice(0, 3).map(({ icon: Icon, label }) => (
                            <Icon key={label} className="size-3 text-zinc-400" />
                          ))}
                        </span>
                      </DropdownMenuItem>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ChatComposer({ streaming, disabled = false, onSend, onStop }: ChatComposerProps) {
  const { providerId, modelId, draft, setDraft } = useChatStore();
  const { data: providers = [] } = useProviders();
  const { data: models = [] } = useModels();
  const activeModel = models.find((m) => m.id === modelId);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const ready = !!providerId && !!modelId && !disabled;

  // Auto-resize textarea
  const resize = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  }, []);

  useEffect(() => {
    resize();
  }, [draft, resize]);

  // Focus on mount
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  function handleSend() {
    const text = draft.trim();
    if (!text || streaming || !ready) return;
    onSend(text);
    setDraft("");
    // Reset height
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }

  return (
    <div
      className="border-t border-zinc-200 bg-white px-3 pb-3 pt-2 dark:border-zinc-800 dark:bg-zinc-950"
      data-testid="chat-composer"
    >
      {/* Textarea */}
      <textarea
        ref={textareaRef}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          resize();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSend();
          }
        }}
        placeholder={
          !modelId
            ? "Select a model to start chatting…"
            : streaming
              ? "Generating response…"
              : "Message… (Enter to send, Shift+Enter for newline)"
        }
        rows={1}
        disabled={disabled && !streaming}
        aria-label="Chat input"
        data-testid="chat-input"
        className={cn(
          "w-full resize-none rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm leading-relaxed",
          "focus:outline-none focus:ring-2 focus:ring-tollma-500/50 focus:border-tollma-500 dark:border-zinc-700 dark:bg-zinc-900",
          "placeholder:text-zinc-400 disabled:opacity-50",
          "transition-all duration-150",
        )}
        style={{ minHeight: 44, maxHeight: 200, overflow: "auto" }}
      />

      {/* Toolbar */}
      <div className="mt-2 flex items-center gap-2">
        {/* Unified Model & Provider Selector */}
        <UnifiedModelSelector providers={providers} models={models} />

        {/* Context and Pricing Info */}
        {activeModel && (
          <div className="hidden sm:flex items-center gap-2 text-[10px] text-zinc-400 font-mono">
            {activeModel.context_window && (
              <span>ctx {(activeModel.context_window / 1000).toFixed(0)}k</span>
            )}
            {activeModel.input_price !== "0.000000" && (
              <span>· ${activeModel.input_price}/1M</span>
            )}
          </div>
        )}

        {/* Right side: Send / Stop button */}
        <div className="ml-auto flex items-center gap-2">
          {streaming ? (
            <Button
              size="sm"
              variant="outline"
              onClick={onStop}
              data-testid="stop-button"
              className="gap-1.5 text-xs text-red-600 hover:text-red-700 border-red-200 dark:border-red-900"
            >
              <Square className="size-3 fill-current" />
              Stop
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={handleSend}
              disabled={!ready || !draft.trim()}
              data-testid="send-button"
              className="gap-1.5 text-xs"
            >
              <span>Send</span>
              <CornerDownLeft className="size-3" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
