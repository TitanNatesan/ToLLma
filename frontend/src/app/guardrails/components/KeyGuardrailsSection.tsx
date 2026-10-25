"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui";
import { GuardrailPicker } from "@/components/GuardrailPicker";
import { toast } from "@/lib/notify";
import { parseApiError } from "@/lib/errors";
import { attachKeyToGuardrails, detachKeyFromGuardrails } from "@/services/guardrails";
import { GUARDRAILS_KEYS, useEffectiveGuardrails, useGuardrails } from "@/hooks/useGuardrails";
import { isPolicyLocked, resolveKeyAssignments, toggleAssignment } from "./policyLogic";

/**
 * Guardrail assignment for API keys. Two modes:
 * - select (no keyId yet, e.g. create flow): controlled id set, the caller
 *   persists it after the key exists. Locked policies render locked.
 * - manage (keyId set, edit drawers): self-contained — diffs are PATCHed
 *   onto each policy's `assignments`. Never touches the key secret.
 */
export function KeyGuardrailsSection({
  orgId,
  keyId,
  selectedIds,
  onSelectionChange,
  disabled,
}: {
  orgId?: string;
  keyId?: string;
  selectedIds?: Set<string>;
  onSelectionChange?: (ids: Set<string>) => void;
  disabled?: boolean;
}) {
  const qc = useQueryClient();
  const policiesQuery = useGuardrails(orgId);
  const effectiveQuery = useEffectiveGuardrails({ key_id: keyId, org_id: orgId ?? undefined }, !!keyId);
  const [localIds, setLocalIds] = useState<Set<string> | null>(null);
  const [saving, setSaving] = useState(false);

  const policies = useMemo(() => policiesQuery.data ?? [], [policiesQuery.data]);
  const ownKeyIds = useMemo(
    () => new Set(policies.filter((p) => keyId && (p.assignments ?? []).some((a) => a.scope_type === "key" && a.api_key_id === keyId)).map((p) => p.id)),
    [policies, keyId],
  );
  const inherited = useMemo(() => {
    if (!keyId) return policies.filter(isPolicyLocked);
    return (effectiveQuery.data?.policies ?? []).filter((p) => !ownKeyIds.has(p.id));
  }, [keyId, effectiveQuery.data, policies, ownKeyIds]);
  const deciding = effectiveQuery.data?.deciding_policy_id;

  const initialAssigned = ownKeyIds;
  const assigned = selectedIds ?? localIds ?? initialAssigned;
  const setAssigned = onSelectionChange ?? setLocalIds;

  const resolved = useMemo(
    () => resolveKeyAssignments({ inherited, assignable: policies, assignedIds: [...assigned] }),
    [inherited, policies, assigned],
  );

  const dirty = useMemo(() => {
    if (!keyId || selectedIds) return false;
    if (assigned.size !== initialAssigned.size) return true;
    for (const id of assigned) if (!initialAssigned.has(id)) return true;
    return false;
  }, [keyId, selectedIds, assigned, initialAssigned]);

  function toggle(id: string) {
    setAssigned(toggleAssignment(assigned, resolved.lockedIds, id));
  }

  async function save() {
    if (!keyId) return;
    setSaving(true);
    try {
      const toAdd = policies.filter((p) => assigned.has(p.id) && !ownKeyIds.has(p.id) && !resolved.lockedIds.has(p.id)).map((p) => p.id);
      const toRemove = policies.filter((p) => !assigned.has(p.id) && ownKeyIds.has(p.id) && !resolved.lockedIds.has(p.id)).map((p) => p.id);
      await Promise.all([
        attachKeyToGuardrails(toAdd, keyId, orgId),
        detachKeyFromGuardrails(toRemove, keyId, orgId),
      ]);
      await qc.invalidateQueries({ queryKey: GUARDRAILS_KEYS.all });
      setLocalIds(null);
      toast.success("Key guardrails updated.");
    } catch (e) {
      toast.error(parseApiError(e).message);
    } finally {
      setSaving(false);
    }
  }

  if (policiesQuery.isPending) return <p className="text-xs text-zinc-400">Loading guardrails…</p>;
  if (policiesQuery.error) {
    return (
      <p className="text-xs text-zinc-400">
        Guardrails are unavailable. <Link href="/guardrails">Manage guardrails</Link>
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {keyId && deciding && (
        <p className="text-[11px] text-zinc-400" data-testid="key-guardrail-deciding">
          Deciding policy: {(policies.find((p) => p.id === deciding) ?? inherited.find((p) => p.id === deciding))?.name ?? deciding}
        </p>
      )}
      <GuardrailPicker
        inherited={inherited}
        assignable={policies.filter((p) => !inherited.some((i) => i.id === p.id))}
        mandatoryIds={resolved.lockedIds}
        assignedIds={assigned}
        onToggle={toggle}
        disabled={disabled || saving}
      />
      {keyId && !selectedIds && (
        <div className="flex justify-end">
          <Button type="button" size="sm" variant="outline" onClick={() => void save()} disabled={saving || !dirty} data-testid="key-guardrails-save">
            {saving ? "Saving…" : "Save guardrails"}
          </Button>
        </div>
      )}
      {!keyId && (
        <p className="flex items-center gap-1 text-[11px] text-zinc-400">
          <ShieldCheck className="size-3" aria-hidden />
          Mandatory organization policies apply automatically and cannot be removed.
        </p>
      )}
    </div>
  );
}
