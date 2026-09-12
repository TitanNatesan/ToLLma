"use client";

import { useModels, useProviders } from "@/hooks/useRegistry";
import { useUsage } from "@/hooks/useChat";
import { useChatStore } from "@/store/chat";
import { Badge, Field, Select } from "@/components/ui";

const CAPS: Array<[string, string, string]> = [
  ["supports_text", "text", "Text"],
  ["supports_vision", "vision", "Vision"],
  ["supports_audio_input", "audio-in", "Audio input"],
  ["supports_audio_output", "audio-out", "Audio output"],
  ["supports_image_generation", "img-gen", "Image generation"],
  ["supports_tool_calling", "tools", "Tool calling"],
  ["supports_reasoning", "reasoning", "Reasoning"],
  ["supports_streaming", "streaming", "Streaming"],
];

export function ChatSettingsPanel() {
  const { providerId, modelId, activeConversationId, setProvider, setModel } = useChatStore();
  const { data: providers } = useProviders();
  const { data: models } = useModels(providerId ?? undefined, undefined, { enabled: !!providerId });
  const { data: usage } = useUsage(activeConversationId);
  const model = (models ?? []).find((m) => m.id === modelId);

  return (
    <aside className="flex w-72 shrink-0 flex-col gap-4 overflow-y-auto border-l border-zinc-200 p-3 dark:border-zinc-800" aria-label="Chat settings" data-testid="chat-settings">
      <Field label="Provider">
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
      </Field>
      <Field label="Model">
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
      </Field>
      {model && (
        <section className="flex flex-col gap-2 text-sm" aria-label="Model details" data-testid="model-details">
          <h3 className="font-medium" data-testid="model-details-name">{model.name}</h3>
          <div className="flex gap-4 text-xs text-zinc-500">
            <span title="Context window">ctx {model.context_window ?? "—"}</span>
            <span title="Max output tokens">max out {model.max_output_tokens ?? "—"}</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {CAPS.filter(([key]) => (model as unknown as Record<string, boolean>)[key]).map(([, k, label]) => (
              <Badge key={k} title={label}>
                {k}
              </Badge>
            ))}
          </div>
          <p className="text-xs text-zinc-500" data-testid="model-pricing">
            in ${model.input_price}/1M · out ${model.output_price}/1M
          </p>
        </section>
      )}
      {usage && usage.total_tokens > 0 && (
        <section className="flex flex-col gap-1 text-sm" aria-label="Conversation usage" data-testid="usage-summary">
          <h3 className="font-medium">Usage</h3>
          <dl className="grid grid-cols-2 gap-x-2 text-xs text-zinc-500">
            <dt>Prompt</dt>
            <dd data-testid="usage-prompt">{usage.prompt_tokens}</dd>
            <dt>Completion</dt>
            <dd data-testid="usage-completion">{usage.completion_tokens}</dd>
            <dt>Total</dt>
            <dd data-testid="usage-total">{usage.total_tokens} tok</dd>
            <dt>Cost</dt>
            <dd data-testid="usage-cost">${usage.total_cost}</dd>
          </dl>
          <p className="text-xs text-zinc-500" title={`in $${usage.input_cost} / out $${usage.output_cost}`}>
            in ${usage.input_cost} · out ${usage.output_cost}
          </p>
        </section>
      )}
    </aside>
  );
}
