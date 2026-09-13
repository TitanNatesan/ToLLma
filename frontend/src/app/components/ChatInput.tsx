"use client";

import { useCallback, useEffect, useRef } from "react";
import { useChatStore } from "@/store/chat";
import { useModels, useProviders } from "@/hooks/useRegistry";
import {
  Button,
  Badge,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
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

function ProviderSelector({ providers }: { providers: Provider[] }) {
  const { providerId, setProvider } = useChatStore();
  const active = providers.find((p) => p.id === providerId);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            "flex h-7 items-center gap-1.5 rounded-md px-2 text-xs transition-colors",
            "border border-zinc-200 hover:border-zinc-300 hover:bg-zinc-50",
            "dark:border-zinc-700 dark:hover:border-zinc-600 dark:hover:bg-zinc-800",
            !active && "text-zinc-400",
          )}
          data-testid="provider-selector"
          aria-label="Select provider"
        >
          <Cpu className="size-3 text-zinc-500" />
          <span className="max-w-24 truncate font-medium">
            {active ? active.name : "Provider"}
          </span>
          <ChevronDown className="size-3 text-zinc-400" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>Provider</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {providers.filter((p) => p.is_active).map((p) => (
          <DropdownMenuItem
            key={p.id}
            onClick={() => setProvider(p.id)}
            data-testid={`provider-option-${p.id}`}
            className={cn(providerId === p.id && "bg-zinc-100 dark:bg-zinc-800")}
          >
            <span className="flex-1 font-medium">{p.name}</span>
            <Badge variant="outline" className="text-[10px]">{p.provider_type}</Badge>
          </DropdownMenuItem>
        ))}
        {providers.filter((p) => p.is_active).length === 0 && (
          <DropdownMenuItem disabled>No active providers</DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ModelSelector({ models }: { models: AIModel[] }) {
  const { modelId, setModel } = useChatStore();
  const active = models.find((m) => m.id === modelId);
  const caps = active
    ? Object.entries(CAP_ICONS)
        .filter(([k]) => (active as unknown as Record<string, boolean>)[k])
        .map(([, item]) => item)
    : [];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            "flex h-7 items-center gap-1.5 rounded-md px-2 text-xs transition-colors",
            "border border-zinc-200 hover:border-zinc-300 hover:bg-zinc-50",
            "dark:border-zinc-700 dark:hover:border-zinc-600 dark:hover:bg-zinc-800",
            !active && "text-zinc-400",
          )}
          data-testid="model-selector"
          aria-label="Select model"
          disabled={!models.length}
        >
          <Bot className="size-3 text-zinc-500" />
          <span className="max-w-36 truncate font-medium">
            {active ? active.name : "Model"}
          </span>
          {caps.length > 0 && (
            <span className="hidden items-center gap-1 sm:flex">
              {caps.slice(0, 3).map(({ icon: Icon, label }) => (
                <Icon key={label} className="size-2.5 text-zinc-400" />
              ))}
            </span>
          )}
          <ChevronDown className="size-3 text-zinc-400" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-64">
        <DropdownMenuLabel>Model</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {models.filter((m) => m.is_active).map((m) => {
          const mCaps = Object.entries(CAP_ICONS)
            .filter(([k]) => (m as unknown as Record<string, boolean>)[k])
            .map(([, item]) => item);
          return (
            <DropdownMenuItem
              key={m.id}
              onClick={() => setModel(m.id)}
              data-testid={`model-option-${m.id}`}
              className={cn(modelId === m.id && "bg-zinc-100 dark:bg-zinc-800")}
            >
              <div className="flex flex-1 flex-col gap-0.5 overflow-hidden">
                <span className="truncate font-medium">{m.name}</span>
                <span className="text-[10px] text-zinc-400">
                  {m.context_window ? `ctx ${m.context_window.toLocaleString()}` : ""}
                  {m.input_price !== "0.000000" ? ` · $${m.input_price}/1M in` : ""}
                </span>
              </div>
              <span className="flex shrink-0 items-center gap-1">
                {mCaps.slice(0, 4).map(({ icon: Icon, label }) => (
                  <Icon key={label} className="size-3 text-zinc-400" />
                ))}
              </span>
            </DropdownMenuItem>
          );
        })}
        {models.filter((m) => m.is_active).length === 0 && (
          <DropdownMenuItem disabled>No models for this provider</DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ChatComposer({ streaming, disabled = false, onSend, onStop }: ChatComposerProps) {
  const { providerId, modelId, draft, setDraft } = useChatStore();
  const { data: providers = [] } = useProviders();
  const { data: models = [] } = useModels(providerId ?? undefined, undefined, { enabled: !!providerId });
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
          !providerId
            ? "Select a provider first…"
            : !modelId
              ? "Select a model first…"
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
          "focus:outline-none focus:ring-2 focus:ring-zinc-400 dark:border-zinc-700 dark:bg-zinc-900",
          "placeholder:text-zinc-400 disabled:opacity-50",
          "transition-all duration-150",
        )}
        style={{ minHeight: 44, maxHeight: 200, overflow: "auto" }}
      />

      {/* Toolbar */}
      <div className="mt-2 flex items-center gap-2">
        {/* Selectors */}
        <ProviderSelector providers={providers} />
        <ModelSelector models={models} />

        {/* Spacer */}
        <div className="flex-1" />

        {/* Send / Stop */}
        {streaming ? (
          <Button
            variant="outline"
            size="sm"
            onClick={onStop}
            data-testid="stop-button"
            className="gap-1.5"
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
            className="gap-1.5"
          >
            Send
            <CornerDownLeft className="size-3 opacity-60" />
          </Button>
        )}
      </div>
    </div>
  );
}
