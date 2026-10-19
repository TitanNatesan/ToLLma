"use client";

import { useState } from "react";
import { Building2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button, Dialog, DialogContent, DialogDescription, DialogTitle, Field, Input } from "@/components/ui";
import { parseApiError } from "@/lib/errors";

export function CreateOrgModal({ open, onClose, onCreate }: {
  open: boolean;
  onClose: () => void;
  onCreate: (payload: {
    name: string;
    description?: string;
    website?: string;
    industry?: string;
    location?: string;
    size?: string;
  }) => Promise<unknown>;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [website, setWebsite] = useState("");
  const [industry, setIndustry] = useState("");
  const [location, setLocation] = useState("");
  const [size, setSize] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await onCreate({
        name: name.trim(),
        description: description.trim() || undefined,
        website: website.trim() || undefined,
        industry: industry.trim() || undefined,
        location: location.trim() || undefined,
        size: size.trim() || undefined,
      });
      setName("");
      setDescription("");
      setWebsite("");
      setIndustry("");
      setLocation("");
      setSize("");
      onClose();
      toast.success("Organization created — you are the root.");
    } catch (e) {
      setError(parseApiError(e).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(n) => { if (!n && !busy) onClose(); }}>
      <DialogContent className="max-w-md p-4" data-testid="org-create-dialog">
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900">
            <Building2 className="size-4" />
          </span>
          <div>
            <DialogTitle className="text-sm font-semibold">Create organization</DialogTitle>
            <DialogDescription>You become the root with full permissions.</DialogDescription>
          </div>
        </div>
        <div className="mt-4 space-y-3">
          <Field label="Organization name">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Corp"
              data-testid="org-create-name" maxLength={120} />
          </Field>
          <Field label="Description (optional)">
            <Input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500}
              data-testid="org-create-description" placeholder="What does your team do?" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Website (optional)">
              <Input value={website} onChange={(e) => setWebsite(e.target.value)} maxLength={255}
                placeholder="https://…" data-testid="org-create-website" />
            </Field>
            <Field label="Industry (optional)">
              <Input value={industry} onChange={(e) => setIndustry(e.target.value)} maxLength={80}
                data-testid="org-create-industry" />
            </Field>
            <Field label="Location (optional)">
              <Input value={location} onChange={(e) => setLocation(e.target.value)} maxLength={120}
                data-testid="org-create-location" />
            </Field>
            <Field label="Size (optional)">
              <Input value={size} onChange={(e) => setSize(e.target.value)} maxLength={32}
                placeholder="1-10" data-testid="org-create-size" />
            </Field>
          </div>
          {error && (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button size="sm" onClick={() => void submit()} disabled={busy || name.trim().length < 2}
              data-testid="org-create-submit">
              {busy && <Loader2 className="size-3.5 animate-spin" />} Create
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
