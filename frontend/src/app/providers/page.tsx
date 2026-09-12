"use client";

import { useState } from "react";
import { CREDENTIAL_FIELDS, PROVIDER_TYPES } from "@/app/providers/fields";
import { Badge, Button, Card, Field, GhostButton, Input, Select, Textarea } from "@/components/ui";
import { useProviderMutations, useProviders } from "@/hooks/useRegistry";
import type { Provider, ProviderType, ValidationResult } from "@/types";

function CredentialInputs({
  type,
  values,
  onChange,
}: {
  type: ProviderType;
  values: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
}) {
  return (
    <>
      {CREDENTIAL_FIELDS[type].map(([name, spec]) => (
        <Field key={name} label={spec.label + (spec.optional ? " (optional)" : "")}>
          {spec.multiline ? (
            <Textarea
              rows={3}
              value={values[name] ?? ""}
              onChange={(e) => onChange({ ...values, [name]: e.target.value })}
              data-testid={`cred-${name}`}
            />
          ) : (
            <Input
              type={spec.secret ? "password" : "text"}
              value={values[name] ?? ""}
              onChange={(e) => onChange({ ...values, [name]: e.target.value })}
              data-testid={`cred-${name}`}
            />
          )}
        </Field>
      ))}
    </>
  );
}

export default function ProvidersPage() {
  const { data, isLoading } = useProviders();
  const mutations = useProviderMutations();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Provider | null>(null);
  const [name, setName] = useState("");
  const [type, setType] = useState<ProviderType>("CUSTOM");
  const [creds, setCreds] = useState<Record<string, string>>({});
  const [results, setResults] = useState<Record<string, ValidationResult>>({});
  const [checking, setChecking] = useState<string | null>(null);

  function openCreate() {
    setEditing(null);
    setName("");
    setType("CUSTOM");
    setCreds({});
    setShowForm(true);
  }

  function openEdit(p: Provider) {
    setEditing(p);
    setName(p.name);
    setType(p.provider_type);
    setCreds({});
    setShowForm(true);
  }

  async function save() {
    const credentials = Object.fromEntries(Object.entries(creds).filter(([, v]) => v !== ""));
    if (editing) {
      await mutations.update.mutateAsync({ id: editing.id, body: { name, ...(Object.keys(credentials).length ? { credentials } : {}) } });
    } else {
      await mutations.create.mutateAsync({ name, provider_type: type, credentials });
    }
    setShowForm(false);
  }

  async function check(id: string) {
    setChecking(id);
    try {
      const r = await mutations.validate.mutateAsync(id);
      setResults((s) => ({ ...s, [id]: r }));
    } finally {
      setChecking(null);
    }
  }

  return (
    <main className="flex flex-1 flex-col gap-4 p-4">
      <div className="flex items-center gap-2">
        <h1 className="text-xl font-semibold">Providers</h1>
        <Button className="ml-auto" onClick={openCreate} data-testid="add-provider">
          Add provider
        </Button>
      </div>
      {showForm && (
        <Card className="flex max-w-xl flex-col gap-3" data-testid="provider-form">
          <h2 className="font-semibold">{editing ? "Edit provider" : "Add provider"}</h2>
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} data-testid="provider-name" />
          </Field>
          {!editing && (
            <Field label="Type">
              <Select value={type} onChange={(e) => setType(e.target.value as ProviderType)} data-testid="provider-type">
                {PROVIDER_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <CredentialInputs type={editing?.provider_type ?? type} values={creds} onChange={setCreds} />
          <div className="flex gap-2">
            <Button onClick={save} disabled={!name.trim()} data-testid="save-provider">
              Save
            </Button>
            <GhostButton onClick={() => setShowForm(false)}>Cancel</GhostButton>
          </div>
        </Card>
      )}
      {isLoading && <p className="text-sm text-zinc-500">Loading…</p>}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {(data ?? []).map((p) => {
          const r = results[p.id];
          return (
            <Card key={p.id} data-testid={`provider-card-${p.id}`}>
              <div className="flex items-center gap-2">
                <h2 className="font-semibold">{p.name}</h2>
                <Badge>{p.provider_type}</Badge>
                {!p.is_active && <Badge>Inactive</Badge>}
              </div>
              <dl className="mt-2 text-xs text-zinc-500">
                {Object.entries(p.credentials_masked).map(([k, v]) => (
                  <div key={k} className="flex gap-2">
                    <dt>{k}:</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
              {r && (
                <p className={r.valid ? "text-sm text-green-600" : "text-sm text-red-600"} data-testid={`validation-${p.id}`}>
                  {r.valid ? "✓ Valid" : `✗ ${r.message}`} ({r.latency_ms.toFixed(0)}ms)
                </p>
              )}
              <div className="mt-3 flex gap-2">
                <GhostButton onClick={() => check(p.id)} disabled={checking === p.id} data-testid={`validate-${p.id}`}>
                  {checking === p.id ? "Checking…" : "Validate"}
                </GhostButton>
                <GhostButton onClick={() => openEdit(p)}>Edit</GhostButton>
                <GhostButton onClick={() => mutations.remove.mutate(p.id)}>Delete</GhostButton>
              </div>
            </Card>
          );
        })}
      </div>
    </main>
  );
}
