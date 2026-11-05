"use client";

import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "@/lib/notify";
import { Button, Checkbox, Field, Input, Select, Textarea } from "@/components/ui";
import { useOrgMutations, usePermissionCatalog } from "@/hooks/useOrgs";
import { parseApiError } from "@/lib/errors";
import { PERMISSION_GROUPS, type PermissionSet } from "@/types/orgs";

type Tab = "existing" | "custom" | "derive";

/** UNIFIED permission-set assignment: one picker for invites AND teams.
 * Snapshot semantics: custom/derived sets COPY permission codes at creation;
 * later base changes never propagate. Escalation is impossible: only
 * delegable (caller-held) permissions are selectable, and the backend
 * re-validates every grant. */
export function PermissionSetPicker({ orgId, sets, selected, onChange, myPermissions, isRoot, testIdPrefix }: {
  orgId: string;
  sets: PermissionSet[];
  selected: string[];
  onChange: (ids: string[]) => void;
  myPermissions: string[];
  isRoot: boolean;
  testIdPrefix: string;
}) {
  const [tab, setTab] = useState<Tab>("existing");
  const mine = useMemo(() => new Set(myPermissions), [myPermissions]);
  const delegableSets = useMemo(
    () => (isRoot ? sets : sets.filter((s) => s.permissions.every((c) => mine.has(c)))),
    [isRoot, sets, mine],
  );
  const hiddenSets = sets.length - delegableSets.length;

  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  }

  return (
    <div data-testid={`${testIdPrefix}-picker`}>
      <div className="flex gap-1 rounded-md bg-zinc-100 p-0.5 dark:bg-zinc-800" role="tablist"
        aria-label="Permission set source">
        {(["existing", "custom", "derive"] as const).map((t) => (
          <button key={t} type="button" role="tab" id={`${testIdPrefix}-picker-tabbtn-${t}`} aria-selected={tab === t} aria-controls={`${testIdPrefix}-picker-panel-${t}`}
            onClick={() => setTab(t)} data-testid={`${testIdPrefix}-picker-tab-${t}`}
            className={`flex-1 rounded px-2 py-1.5 text-xs font-medium transition-colors ${tab === t
              ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-950 dark:text-zinc-100"
              : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"}`}>
            {t === "existing" ? "Existing" : t === "custom" ? "Create custom" : "Derive from existing"}
          </button>
        ))}
      </div>

      {tab === "existing" && (
        <div role="tabpanel" id={`${testIdPrefix}-picker-panel-existing`} aria-labelledby={`${testIdPrefix}-picker-tabbtn-existing`} className="mt-2 max-h-48 space-y-1.5 overflow-y-auto rounded-md border border-zinc-200 p-2.5 dark:border-zinc-800">
          {delegableSets.map((s) => (
            <label key={s.id} data-testid={`${testIdPrefix}-picker-opt-${s.id}`}
              className="flex cursor-pointer items-center gap-2 text-xs">
              <Checkbox checked={selected.includes(s.id)} onChange={() => toggle(s.id)} />
              <span className="font-medium">{s.name}</span>
              {s.is_system && <span className="text-zinc-400">(system)</span>}
              <span className="ml-auto font-mono text-[10px] text-zinc-400">{s.permissions.length}</span>
            </label>
          ))}
          {delegableSets.length === 0 && <p className="text-xs text-zinc-500">No sets available.</p>}
        </div>
      )}
      {tab === "existing" && hiddenSets > 0 && (
        <p className="mt-1 text-[11px] text-zinc-400">
          {hiddenSets} set{hiddenSets === 1 ? "" : "s"} hidden — {hiddenSets === 1 ? "it grants" : "they grant"} permissions beyond yours.
        </p>
      )}

      {tab === "custom" && (
        <CustomBuilder orgId={orgId} mine={isRoot ? null : mine} sets={sets}
          onCreated={(id) => { onChange([...selected, id]); setTab("existing"); }}
          testIdPrefix={testIdPrefix} />
      )}

      {tab === "derive" && (
        <DeriveBuilder orgId={orgId} sets={delegableSets} mine={isRoot ? null : mine}
          onCreated={(id) => { onChange([...selected, id]); setTab("existing"); }}
          testIdPrefix={testIdPrefix} />
      )}
    </div>
  );
}

function useCatalogGroups() {
  const q = usePermissionCatalog();
  return q.data ?? PERMISSION_GROUPS;
}

/** Inline custom-set builder: name/desc + catalog-grouped delegable-only picks. */
function CustomBuilder({ orgId, mine, onCreated, testIdPrefix }: {
  orgId: string;
  mine: Set<string> | null;
  sets: PermissionSet[];
  onCreated: (id: string) => void;
  testIdPrefix: string;
}) {
  const groups = useCatalogGroups();
  const mut = useOrgMutations(orgId);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const grantable = (code: string) => mine === null || mine.has(code);
  const totalGrantable = groups.reduce((n, g) => n + g.permissions.filter((p) => grantable(p.code)).length, 0);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const created = await mut.createSet.mutateAsync({
        name: name.trim(),
        description: description.trim() || undefined,
        permissions: picked.filter(grantable),
      });
      toast.success(`Permission set "${created.name}" created.`);
      onCreated(created.id);
    } catch (e) {
      setError(parseApiError(e).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2 space-y-2.5" data-testid={`${testIdPrefix}-picker-custom`}>
      <Field label="Set name">
        <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80}
          placeholder="e.g. Support leads" data-testid={`${testIdPrefix}-picker-custom-name`} />
      </Field>
      <Field label="Description (optional)">
        <Input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300}
          placeholder="What is this set for?" />
      </Field>
      <div>
        <p className="mb-1 text-xs font-medium">
          Permissions <span className="font-mono font-normal text-zinc-400">({picked.length} of {totalGrantable} grantable selected)</span>
        </p>
        <div className="max-h-56 space-y-2.5 overflow-y-auto pr-1">
          {groups.map((g) => (
            <fieldset key={g.group} className="rounded-md border border-zinc-200 p-2.5 dark:border-zinc-800">
              <legend className="px-1 text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">{g.group}</legend>
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {g.permissions.map((p) => {
                  const ok = grantable(p.code);
                  return (
                    <label key={p.code} title={ok ? p.code : `${p.code} — beyond your permissions`}
                      className={`flex items-center gap-2 text-xs ${ok ? "cursor-pointer" : "cursor-not-allowed opacity-40"}`}>
                      <Checkbox checked={picked.includes(p.code)} disabled={!ok}
                        onChange={() => setPicked((v) => (v.includes(p.code) ? v.filter((x) => x !== p.code) : [...v, p.code]))} />
                      <span>{p.label}</span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          ))}
        </div>
        {mine !== null && (
          <p className="mt-1 text-[11px] text-zinc-400">Only permissions you hold are selectable — grants can never exceed your own.</p>
        )}
      </div>
      {error && <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
      <div className="flex justify-end">
        <Button size="sm" onClick={() => void submit()} disabled={busy || name.trim().length < 2}
          data-testid={`${testIdPrefix}-picker-custom-submit`}>
          {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden />} Create &amp; select ({picked.length})
        </Button>
      </div>
    </div>
  );
}

/** Derive-from-existing: base select + frozen inherited list + extra picks +
 * effective preview. Creates a SNAPSHOT COPY — later base changes do not propagate. */
function DeriveBuilder({ orgId, sets, mine, onCreated, testIdPrefix }: {
  orgId: string;
  sets: PermissionSet[];
  mine: Set<string> | null;
  onCreated: (id: string) => void;
  testIdPrefix: string;
}) {
  const groups = useCatalogGroups();
  const mut = useOrgMutations(orgId);
  const [baseId, setBaseId] = useState(sets[0]?.id ?? "");
  const [name, setName] = useState("");
  const [extra, setExtra] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const base = sets.find((s) => s.id === baseId) ?? null;
  const inherited = useMemo(() => base?.permissions ?? [], [base]);
  const grantable = (code: string) => !inherited.includes(code) && (mine === null || mine.has(code));
  const effective = useMemo(
    () => [...inherited, ...extra.filter((c) => !inherited.includes(c))],
    [inherited, extra],
  );

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const created = await mut.createSet.mutateAsync({
        name: name.trim() || `${base?.name ?? "Set"} copy`,
        description: base ? `Derived from "${base.name}" (snapshot copy).` : undefined,
        permissions: effective,
      });
      toast.success(`Permission set "${created.name}" created from "${base?.name}".`);
      onCreated(created.id);
    } catch (e) {
      setError(parseApiError(e).message);
    } finally {
      setBusy(false);
    }
  }

  if (!base) return <p className="mt-2 text-xs text-zinc-500">No sets available to derive from.</p>;

  return (
    <div className="mt-2 space-y-2.5" data-testid={`${testIdPrefix}-picker-derive`}>
      <Field label="Base set (copied once — frozen)">
        <Select value={baseId} onChange={(e) => { setBaseId(e.target.value); setExtra([]); }}
          data-testid={`${testIdPrefix}-picker-derive-base`}>
          {sets.map((s) => (
            <option key={s.id} value={s.id}>{s.name} ({s.permissions.length})</option>
          ))}
        </Select>
      </Field>
      <div className="rounded-md border border-zinc-200 p-2.5 dark:border-zinc-800">
        <p className="mb-1 text-[11px] font-semibold text-zinc-500">
          Inherited from “{base.name}” — unchangeable ({inherited.length})
        </p>
        <p className="font-mono text-[11px] leading-relaxed text-zinc-500">
          {inherited.length > 0 ? inherited.join(", ") : "no permissions"}
        </p>
      </div>
      <Field label="Additional permissions (delegable only)">
        <div className="max-h-40 space-y-2 overflow-y-auto rounded-md border border-zinc-200 p-2.5 dark:border-zinc-800">
          {groups.map((g) => {
            const opts = g.permissions.filter((p) => grantable(p.code));
            if (opts.length === 0) return null;
            return (
              <div key={g.group}>
                <p className="text-[11px] font-semibold text-zinc-500">{g.group}</p>
                {opts.map((p) => (
                  <label key={p.code} className="flex cursor-pointer items-center gap-2 text-xs">
                    <Checkbox checked={extra.includes(p.code)}
                      onChange={() => setExtra((v) => (v.includes(p.code) ? v.filter((x) => x !== p.code) : [...v, p.code]))} />
                    <span title={p.code}>{p.label}</span>
                  </label>
                ))}
              </div>
            );
          })}
        </div>
      </Field>
      <Field label="New set name">
        <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80}
          placeholder={`${base.name} copy`} data-testid={`${testIdPrefix}-picker-derive-name`} />
      </Field>
      <p className="rounded-md bg-zinc-100 px-2.5 py-2 text-[11px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
        Effective set: <strong className="font-mono">{effective.length} permissions</strong> copied now;
        later “{base.name}” changes do not propagate.
      </p>
      {error && <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
      <div className="flex justify-end">
        <Button size="sm" onClick={() => void submit()} disabled={busy}
          data-testid={`${testIdPrefix}-picker-derive-submit`}>
          {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden />} Create snapshot copy ({effective.length})
        </Button>
      </div>
    </div>
  );
}

/** Read-only review of a selection: set names + total unique permission codes. */
export function PickerReview({ sets, selected }: { sets: PermissionSet[]; selected: string[] }) {
  const picked = sets.filter((s) => selected.includes(s.id));
  const codes = new Set(picked.flatMap((s) => s.permissions));
  return (
    <div className="rounded-md border border-zinc-200 p-2.5 text-xs dark:border-zinc-800">
      {picked.length === 0 ? (
        <p className="text-zinc-500">No permission sets — the member gets base membership with no extra grants.</p>
      ) : (
        <>
          <p className="font-medium">{picked.map((s) => s.name).join(", ")}</p>
          <p className="mt-0.5 font-mono text-[11px] text-zinc-500">
            {codes.size} unique permission{codes.size === 1 ? "" : "s"} granted by reference — later edits to these sets apply to the holder.
            (Custom and derived sets are snapshot copies: their codes are frozen at creation.)
          </p>
        </>
      )}
    </div>
  );
}
