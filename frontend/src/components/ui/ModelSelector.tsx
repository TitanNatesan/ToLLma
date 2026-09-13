"use client";

import { useState } from "react";
import { useChatStore } from "@/store/chat";
import { useModels, useProviders } from "@/hooks/useRegistry";
import {
  Badge,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "./primitives";
import { SearchInput } from "./SearchInput";
import { CapabilityBadge } from "./CapabilityBadge";
import { Bot, ChevronDown, Cpu } from "lucide-react";
import type { AIModel, Provider } from "@/types";
import { cn } from "@/lib/utils";

export interface ModelSelectorProps {
  providers?: Provider[];
  models?: AIModel[];
  className?: string;
}

export function ModelSelector({
  providers: propProviders,
  models: propModels,
  className,
}: ModelSelectorProps) {
  const { providerId, modelId, setProvider, setModel } = useChatStore();
  const { data: queriedProviders = [] } = useProviders();
  const { data: queriedModels = [] } = useModels();

  const providers = propProviders ?? queriedProviders;
  const models = propModels ?? queriedModels;

  const [search, setSearch] = useState("");

  const activeProvider = providers.find((p) => p.id === providerId);
  const activeModel = models.find((m) => m.id === modelId);

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
            "flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs transition-colors",
            "border border-zinc-200 hover:border-zinc-300 hover:bg-zinc-50 bg-white",
            "dark:border-zinc-700 dark:hover:border-zinc-600 dark:hover:bg-zinc-800 dark:bg-zinc-900",
            !activeModel && "text-zinc-400",
            className,
          )}
          data-testid="model-selector"
          aria-label="Select model"
        >
          <Bot className="size-3.5 text-zinc-500 shrink-0" />
          <span className="max-w-44 truncate font-medium text-zinc-800 dark:text-zinc-200">
            {activeModel ? activeModel.name : "Select model"}
          </span>
          {activeProvider && (
            <span className="hidden sm:inline-flex rounded bg-zinc-100 dark:bg-zinc-800 px-1 py-0.2 text-[10px] text-zinc-500 dark:text-zinc-400 font-normal">
              {activeProvider.name}
            </span>
          )}
          <ChevronDown className="size-3 text-zinc-400 shrink-0 ml-0.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-80 p-0 overflow-hidden shadow-xl">
        {/* Search Header */}
        <div className="border-b border-zinc-200 p-2 dark:border-zinc-800">
          <SearchInput
            placeholder="Search models or providers…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onClear={() => setSearch("")}
            autoFocus
          />
        </div>

        {/* Scrollable list with defined min and max heights */}
        <div className="min-h-[220px] max-h-[380px] overflow-y-auto p-1.5 space-y-2">
          {totalMatchingModels === 0 ? (
            <div className="flex h-[200px] flex-col items-center justify-center gap-1 text-xs text-zinc-400">
              <Bot className="size-6 opacity-30" />
              <span>No models found</span>
            </div>
          ) : (
            groups.map(({ provider, models: pModels }) => (
              <div key={provider.id} className="space-y-1">
                {/* Provider Header */}
                <div className="sticky top-0 z-10 flex items-center justify-between rounded bg-zinc-100/95 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-600 backdrop-blur-sm dark:bg-zinc-900/95 dark:text-zinc-400">
                  <span className="flex items-center gap-1.5 truncate">
                    <Cpu className="size-3 text-zinc-400" />
                    <span className="truncate">{provider.name}</span>
                  </span>
                  <Badge variant="outline" className="text-[9px] px-1 py-0 shrink-0 font-normal">
                    {provider.provider_type}
                  </Badge>
                </div>

                {/* Model items */}
                <div className="space-y-0.5">
                  {pModels.map((m) => {
                    const isSelected = modelId === m.id;
                    return (
                      <DropdownMenuItem
                        key={m.id}
                        onClick={() => {
                          setProvider(m.provider_id);
                          setModel(m.id);
                        }}
                        data-testid={`model-option-${m.id}`}
                        className={cn(
                          "flex cursor-pointer items-center justify-between rounded-md px-2 py-1.5 text-xs transition-colors",
                          isSelected
                            ? "bg-zinc-200 font-semibold text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
                            : "hover:bg-zinc-100 dark:hover:bg-zinc-800/60",
                        )}
                      >
                        <div className="flex flex-1 flex-col gap-0.5 overflow-hidden pr-2">
                          <span className="truncate font-medium">{m.name}</span>
                          <span className="text-[10px] text-zinc-400 font-mono">
                            {m.context_window ? `ctx ${(m.context_window / 1000).toFixed(0)}k` : ""}
                            {m.input_price !== "0.000000" ? ` · $${m.input_price}/1M in` : ""}
                          </span>
                        </div>
                        {m.supports_vision && (
                          <CapabilityBadge capability="supports_vision" compact showLabel={false} />
                        )}
                        {m.supports_reasoning && (
                          <CapabilityBadge capability="supports_reasoning" compact showLabel={false} />
                        )}
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
