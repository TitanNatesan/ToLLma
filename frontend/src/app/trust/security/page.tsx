"use client";

import { useQuery } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { Badge, Card, CardContent, DataTable, EmptyState, ErrorState, LoadingState, PageContainer, PageHeader, SectionHeader, type DataTableColumn } from "@/components/ui";
import { isNotBuiltError, listProviderPolicies } from "@/services/trust";
import type { ProviderPolicy } from "@/types/trust";

const POLICY_COLUMNS: Array<DataTableColumn<ProviderPolicy>> = [
  { key: "provider", header: "Provider", render: (row) => row.display_name },
  { key: "training", header: "Training on inputs", render: (row) => row.training_on_inputs ?? "unknown" },
  {
    key: "dpa",
    header: "DPA",
    render: (row) =>
      row.dpa_available == null ? (
        <span className="text-zinc-400">—</span>
      ) : row.dpa_available ? (
        <Badge variant="success">available</Badge>
      ) : (
        <Badge variant="outline">unavailable</Badge>
      ),
  },
  {
    key: "reviewed",
    header: "Last reviewed",
    render: (row) => row.last_reviewed_at ?? <span className="text-zinc-400">unverified</span>,
  },
];

/**
 * Security posture page. Static commitments render always; the F8
 * provider-policy registry renders live rows when D's API lands, an
 * EmptyState on backend-absent (404/501), and ErrorState+retry otherwise.
 */
export default function TrustSecurityPage() {
  const policies = useQuery({
    queryKey: ["trust", "provider-policies"],
    queryFn: listProviderPolicies,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
  const rows = policies.data ?? [];

  return (
    <PageContainer
      header={
        <PageHeader
          title="Security"
          subtitle="How ToLLma protects the platform. Advisory until the security review (Agent C) publishes verified posture."
        />
      }
      testId="trust-security-page"
      maxWidth="max-w-3xl"
    >
      <Card>
        <CardContent className="pt-4">
          <SectionHeader title="Commitments" description="Shipped controls; verified details follow the Wave 3 audit." />
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">
            <li>Passwords hashed with argon2; JWT access (15m) + rotating refresh (30d).</li>
            <li>Provider credentials encrypted at rest (Fernet) and masked in every response.</li>
            <li>Auth rate-limiting with login lockout; tenant isolation enforced per query.</li>
            <li>Message content never appears in admin analytics or audit surfaces.</li>
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4">
          <SectionHeader
            title="Model provider policies"
            description="Advisory registry (F8). Missing upstream fields render as unverified — never fabricated."
            badge={<Badge variant="outline">advisory</Badge>}
          />
          <div className="mt-2" data-testid="trust-policies">
            {policies.isPending ? (
              <LoadingState message="Loading provider policies…" />
            ) : policies.isError && isNotBuiltError(policies.error) ? (
              <EmptyState
                icon={ShieldCheck}
                title="Provider registry pending"
                description="The provider-policy registry is not published yet. Commitments above still apply."
                testId="trust-policies-empty"
              />
            ) : policies.isError ? (
              <ErrorState
                title="Could not load provider policies"
                message="The governance service is unavailable."
                onRetry={() => void policies.refetch()}
              />
            ) : rows.length === 0 ? (
              <EmptyState
                icon={ShieldCheck}
                title="No provider policies published"
                description="The registry is empty. Check back once provider reviews are recorded."
                testId="trust-policies-empty"
              />
            ) : (
              <DataTable columns={POLICY_COLUMNS} rows={rows} rowKey={(row) => row.provider_key} testId="trust-policies-table" />
            )}
          </div>
        </CardContent>
      </Card>
    </PageContainer>
  );
}
