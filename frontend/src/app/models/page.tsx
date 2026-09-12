"use client";

import { useState } from "react";
import { Badge, Button, Card, Field, GhostButton, Input, Select } from "@/components/ui";
import { useModelMutations, useModels, useProviders } from "@/hooks/useRegistry";
import type { AIModel, EndpointType } from "@/types";

const ENDPOINTS: EndpointType[] = ["responses", "chat_completions", "messages", "converse"];
const CAPS: Array<[keyof AIModel, string]> = [
  ["supports_text", "text"],
  ["supports_vision", "vision"],
  ["supports_audio_input", "audio-in"],
  ["supports_audio_output", "audio-out"],
  ["supports_image_generation", "img-gen"],
  ["supports_tool_calling", "tools"],
  ["supports_reasoning", "reasoning"],
  ["supports_streaming", "streaming"],
];

function CapabilityBadges({ m }: { m: AIModel }) {
  return (
    <div className="flex flex-wrap gap-1">
      {CAPS.filter(([k]) => m[k]).map(([, label]) => (
        <Badge key={label}>{label}</Badge>
      ))}
    </div>
  );
}

export default function ModelsPage() {
  const [providerFilter, setProviderFilter] = useState("");
  const [search, setSearch] = useState("");
  const { data: providers } = useProviders();
  const { data, isLoading } = useModels(providerFilter || undefined, search || undefined);
  const mutations = useModelMutations();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<AIModel | null>(null);
  const [form, setForm] = useState({ provider_id: "", model_id: "", name: "", endpoint_type: "chat_completions" as EndpointType, input_price: "0", output_price: "0" });

  function openCreate() {
    setEditing(null);
    setForm({ provider_id: providerFilter, model_id: "", name: "", endpoint_type: "chat_completions", input_price: "0", output_price: "0" });
    setShowForm(true);
  }

  async function save() {
    if (editing) {
      await mutations.update.mutateAsync({
        id: editing.id,
        body: { name: form.name, endpoint_type: form.endpoint_type, input_price: form.input_price, output_price: form.output_price },
      });
    } else {
      await mutations.create.mutateAsync({ ...form });
    }
    setShowForm(false);
  }

  return (
    <main className="flex flex-1 flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold">Models</h1>
        <Input
          placeholder="Search models"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-52"
          aria-label="Search models"
          data-testid="model-search"
        />
        <Select value={providerFilter} onChange={(e) => setProviderFilter(e.target.value)} aria-label="Filter by provider" data-testid="model-provider-filter">
          <option value="">All providers</option>
          {(providers ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
        <Button className="ml-auto" onClick={openCreate} data-testid="add-model">
          Add model
        </Button>
      </div>
      {showForm && (
        <Card className="flex max-w-xl flex-col gap-3" data-testid="model-form">
          <h2 className="font-semibold">{editing ? "Edit model" : "Add model"}</h2>
          {!editing && (
            <Field label="Provider">
              <Select value={form.provider_id} onChange={(e) => setForm({ ...form, provider_id: e.target.value })} data-testid="model-provider">
                <option value="">Select provider</option>
                {(providers ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {!editing && (
            <Field label="Model ID (provider identifier)">
              <Input value={form.model_id} onChange={(e) => setForm({ ...form, model_id: e.target.value })} data-testid="model-model-id" />
            </Field>
          )}
          <Field label="Name">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="model-name" />
          </Field>
          <Field label="Endpoint type">
            <Select value={form.endpoint_type} onChange={(e) => setForm({ ...form, endpoint_type: e.target.value as EndpointType })} data-testid="model-endpoint">
              {ENDPOINTS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex gap-2">
            <Field label="Input $/1M">
              <Input value={form.input_price} onChange={(e) => setForm({ ...form, input_price: e.target.value })} data-testid="model-input-price" />
            </Field>
            <Field label="Output $/1M">
              <Input value={form.output_price} onChange={(e) => setForm({ ...form, output_price: e.target.value })} data-testid="model-output-price" />
            </Field>
          </div>
          <div className="flex gap-2">
            <Button onClick={save} disabled={!form.name.trim() || (!editing && (!form.provider_id || !form.model_id))} data-testid="save-model">
              Save
            </Button>
            <GhostButton onClick={() => setShowForm(false)}>Cancel</GhostButton>
          </div>
        </Card>
      )}
      {isLoading && <p className="text-sm text-zinc-500">Loading…</p>}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {(data ?? []).map((m) => (
          <Card key={m.id} data-testid={`model-card-${m.id}`}>
            <div className="flex items-center gap-2">
              <h2 className="font-semibold">{m.name}</h2>
              <Badge>{m.endpoint_type}</Badge>
            </div>
            <p className="mt-1 text-xs text-zinc-500">
              {m.model_id} · in ${m.input_price}/1M · out ${m.output_price}/1M
              {m.context_window ? ` · ctx ${m.context_window}` : ""}
            </p>
            <div className="mt-2">
              <CapabilityBadges m={m} />
            </div>
            <div className="mt-3 flex gap-2">
              <GhostButton
                onClick={() => {
                  setEditing(m);
                  setForm({ provider_id: m.provider_id, model_id: m.model_id, name: m.name, endpoint_type: m.endpoint_type, input_price: m.input_price, output_price: m.output_price });
                  setShowForm(true);
                }}
              >
                Edit
              </GhostButton>
              <GhostButton onClick={() => mutations.remove.mutate(m.id)}>Delete</GhostButton>
            </div>
          </Card>
        ))}
      </div>
    </main>
  );
}
