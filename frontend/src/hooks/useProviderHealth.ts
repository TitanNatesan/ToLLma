"use client";

import { useState } from "react";
import { toast } from "@/lib/notify";
import { parseApiError } from "@/lib/errors";
import { useProviderMutations } from "@/hooks/useRegistry";

/**
 * Shared provider health actions (validate credentials + refresh discovered
 * models). The personal providers page and the org providers section render
 * the same buttons, so the busy key format (`validate:<id>` /
 * `discover:<id>`) and toast copy live here once. `track` covers one-off
 * actions (e.g. org enable/disable) that need the same busy slot.
 */
export function useProviderHealthActions(opts?: {
  onDiscovered?: (id: string, message: string) => void;
}) {
  const pm = useProviderMutations();
  const [busy, setBusy] = useState<string | null>(null);

  async function track(key: string, fn: () => Promise<void>) {
    setBusy(key);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  }

  async function runValidate(id: string) {
    await track(`validate:${id}`, async () => {
      try {
        const r = await pm.validate.mutateAsync(id);
        if (r.valid) {
          toast.success("Credentials valid", { description: `${r.latency_ms.toFixed(0)}ms` });
        } else {
          toast.error("Credentials invalid", { description: r.message });
        }
      } catch (e) {
        toast.error(parseApiError(e).message);
      }
    });
  }

  async function runDiscover(id: string) {
    await track(`discover:${id}`, async () => {
      try {
        const d = await pm.discover.mutateAsync(id);
        opts?.onDiscovered?.(id, d.message);
        toast.success("Model discovery finished", { description: d.message });
      } catch (e) {
        toast.error(parseApiError(e).message);
      }
    });
  }

  return { busy, runValidate, runDiscover, track };
}
