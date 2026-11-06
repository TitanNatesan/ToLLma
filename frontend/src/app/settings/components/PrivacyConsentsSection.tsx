"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, ErrorState, LoadingState, SettingItem, Switch } from "@/components/ui";
import { toast } from "@/lib/notify";
import { toastApiError } from "@/lib/errors";
import { listConsents, setConsent } from "@/services/trust";
import type { ConsentCategory } from "@/types/trust";

const CATEGORIES: Array<{ category: ConsentCategory; label: string; description: string; locked?: boolean }> = [
  { category: "functional", label: "Functional", description: "Required for sign-in, sessions, and core service. Always on.", locked: true },
  { category: "analytics", label: "Analytics", description: "Aggregated usage telemetry. No message content." },
  { category: "prompt_logging", label: "Prompt logging", description: "Keep message bodies per your retention policy." },
  { category: "marketing", label: "Marketing", description: "Product updates and outreach. Reserved — off by default." },
  { category: "third_party_sharing", label: "Third-party sharing", description: "Sharing beyond processors. Reserved — needs DPA text." },
];

export function consentQueryKey() {
  return ["trust", "privacy", "consents"] as const;
}

/** F4 consent toggles. Functional is shown locked; everything else writes through. */
export function PrivacyConsentsSection() {
  const queryClient = useQueryClient();
  const consents = useQuery({ queryKey: consentQueryKey(), queryFn: listConsents, retry: false });
  const update = useMutation({
    mutationFn: ({ category, granted }: { category: ConsentCategory; granted: boolean }) =>
      setConsent(category, granted),
    onSuccess: () => {
      toast.success("Preference saved");
      void queryClient.invalidateQueries({ queryKey: consentQueryKey() });
    },
    onError: (e) => {
      toastApiError(e, { title: "Could not save preference" });
    },
  });

  if (consents.isPending) return <LoadingState message="Loading privacy preferences…" />;
  if (consents.isError) {
    return (
      <ErrorState
        title="Could not load privacy preferences"
        message="The privacy service is unavailable."
        onRetry={() => void consents.refetch()}
      />
    );
  }
  // An empty list is normal (nothing recorded yet) — toggling a category
  // creates its first grant. Defaults render off except functional.
  const rows = consents.data ?? [];
  const granted = new Map(rows.map((row) => [row.category, row.status === "granted"]));

  return (
    <div data-testid="privacy-consents">
      {CATEGORIES.map(({ category, label, description, locked }) => (
        <SettingItem key={category} label={label} description={description}>
          {locked ? (
            <Badge variant="secondary" data-testid={`consent-locked-${category}`}>Required</Badge>
          ) : (
            <Switch
              checked={granted.get(category) ?? false}
              disabled={update.isPending}
              onCheckedChange={(next) => update.mutate({ category, granted: next })}
              aria-label={label}
              data-testid={`consent-toggle-${category}`}
            />
          )}
        </SettingItem>
      ))}
    </div>
  );
}
