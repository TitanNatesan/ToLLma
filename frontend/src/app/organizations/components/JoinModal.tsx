"use client";

import { useState } from "react";
import { Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { Button, Dialog, DialogContent, DialogDescription, DialogTitle, Field, Input } from "@/components/ui";
import { useOrgSearch } from "@/hooks/useOrgs";
import { parseApiError } from "@/lib/errors";

export function JoinModal({ open, onClose, onRequest }: {
  open: boolean;
  onClose: () => void;
  onRequest: (orgId: string) => Promise<unknown>;
}) {
  const [q, setQ] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const search = useOrgSearch(q);
  const results = search.data ?? [];

  async function request(orgId: string, name: string) {
    setBusyId(orgId);
    try {
      await onRequest(orgId);
      toast.success(`Join request sent to ${name}.`);
      onClose();
    } catch (e) {
      toast.error(parseApiError(e).message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(n) => { if (!n && !busyId) onClose(); }}>
      <DialogContent className="max-w-md p-4" data-testid="org-join-dialog">
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900">
            <Search className="size-4" />
          </span>
          <div>
            <DialogTitle className="text-sm font-semibold">Join organization</DialogTitle>
            <DialogDescription>Search by name or slug, then request to join. Approvers review it.</DialogDescription>
          </div>
        </div>
        <div className="mt-4 space-y-3">
          <Field label="Search organizations">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type at least 2 characters…"
              data-testid="org-join-search" maxLength={120} />
          </Field>
          <div className="max-h-64 space-y-2 overflow-y-auto" data-testid="org-join-results">
            {results.map((o) => (
              <div key={o.id} className="flex items-center gap-3 rounded-md border border-zinc-200 p-2.5 dark:border-zinc-800">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold">{o.name}</p>
                  <p className="truncate text-[11px] text-zinc-500">/{o.slug}{o.industry ? ` · ${o.industry}` : ""}</p>
                </div>
                <Button size="sm" variant="outline" disabled={busyId === o.id}
                  onClick={() => void request(o.id, o.name)} data-testid={`org-join-${o.slug}`}>
                  {busyId === o.id && <Loader2 className="size-3.5 animate-spin" />} Request
                </Button>
              </div>
            ))}
            {q.trim().length >= 2 && !search.isLoading && results.length === 0 && (
              <p className="text-xs text-zinc-500">No organizations match.</p>
            )}
          </div>
          <div className="flex justify-end">
            <Button variant="outline" size="sm" onClick={onClose}>Close</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
