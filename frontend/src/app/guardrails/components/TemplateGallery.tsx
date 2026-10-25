"use client";

import { useState } from "react";
import { Button, Card, CardContent, EmptyState, LoadingState } from "@/components/ui";
import { toast } from "@/lib/notify";
import { toastApiError } from "@/lib/errors";
import { useGuardrailMutations, useGuardrailTemplates } from "@/hooks/useGuardrails";
import { LayoutTemplate } from "lucide-react";

/** One-click policy creation from a backend template. */
export function TemplateGallery({ orgId, canCreate = true }: { orgId?: string; canCreate?: boolean }) {
  const templates = useGuardrailTemplates(true);
  const mut = useGuardrailMutations(orgId);
  const [busy, setBusy] = useState<string | null>(null);

  if (templates.isPending) return <LoadingState message="Loading templates…" className="py-6" />;
  const items = templates.data ?? [];
  if (items.length === 0) {
    return (
      <EmptyState
        icon={LayoutTemplate}
        title="No templates"
        description="The backend publishes starter policies here when available."
        testId="no-templates"
      />
    );
  }

  async function applyTemplate(key: string, name: string) {
    setBusy(key);
    try {
      await mut.fromTemplate.mutateAsync(key);
      toast.success(`Guardrail "${name}" created from template.`);
    } catch (e) {
      toastApiError(e, { title: "Template failed" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" data-testid="template-gallery">
      {items.map((t) => (
        <Card key={t.key} className="shadow-none">
          <CardContent className="flex flex-col gap-2 p-3">
            <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">{t.name}</p>
            {t.description && <p className="text-[11px] text-zinc-500">{t.description}</p>}
            <Button
              size="sm"
              variant="outline"
              disabled={!canCreate || busy === t.key}
              title={canCreate ? undefined : "Requires Guardrails.Create"}
              onClick={() => void applyTemplate(t.key, t.name)}
              data-testid={`template-use-${t.key}`}
            >
              {busy === t.key ? "Creating…" : "Use template"}
            </Button>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
