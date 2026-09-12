"use client";

import { useModels, useProviders } from "@/hooks/useRegistry";
import { useUsage } from "@/hooks/useChat";
import { useChatStore } from "@/store/chat";
import { Select } from "@/components/ui";

export function SelectorBar() {
  const { providerId, modelId, activeConversationId, setProvider, setModel } = useChatStore();
  const { data: providers } = useProviders();
  const { data: models } = useModels(providerId ?? undefined, undefined, { enabled: !!providerId });
  const { data: usage } = useUsage(activeConversationId);

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 p-3 dark:border-zinc-800">
      <Select
        aria-label="Provider"
        data-testid="provider-select"
        value={providerId ?? ""}
        onChange={(e) => setProvider(e.target.value || null)}
      >
        <option value="">Select provider</option>
        {(providers ?? [])
          .filter((p) => p.is_active)
          .map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.provider_type})
            </option>
          ))}
      </Select>
      <Select
        aria-label="Model"
        data-testid="model-select"
        value={modelId ?? ""}
        onChange={(e) => setModel(e.target.value || null)}
        disabled={!providerId}
      >
        <option value="">Select model</option>
        {(models ?? [])
          .filter((m) => m.is_active)
          .map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
      </Select>
      {usage && (usage.total_tokens > 0) && (
        <span className="ml-auto text-xs text-zinc-500" data-testid="usage-summary" title={`in ${usage.prompt_tokens} / out ${usage.completion_tokens}`}>
          {usage.total_tokens} tok · ${usage.total_cost}
        </span>
      )}
    </div>
  );
}
