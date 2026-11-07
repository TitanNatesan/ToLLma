"use client";

import { useQuery } from "@tanstack/react-query";
import { ServerCog } from "lucide-react";
import { Card, CardContent, DataTable, EmptyState, ErrorState, LoadingState, PageContainer, PageHeader, type DataTableColumn } from "@/components/ui";
import { isNotBuiltError, listSubprocessors } from "@/services/trust";
import type { Subprocessor } from "@/types/trust";

const SUBPROCESSOR_COLUMNS: Array<DataTableColumn<Subprocessor>> = [
  { key: "name", header: "Subprocessor", render: (row) => row.name },
  { key: "purpose", header: "Purpose", render: (row) => row.purpose },
  { key: "location", header: "Location", render: (row) => row.location },
  { key: "status", header: "Status", render: (row) => row.status },
];

/**
 * Subprocessor registry (F10 public shape only). Backend-absent renders an
 * honest EmptyState — no seed, no fabricated vendors.
 */
export default function TrustSubprocessorsPage() {
  const registry = useQuery({
    queryKey: ["trust", "subprocessors"],
    queryFn: listSubprocessors,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
  const rows = registry.data ?? [];

  return (
    <PageContainer
      header={
        <PageHeader
          hideMenu
          title="Subprocessors"
          subtitle="Third parties that process customer data on our behalf."
        />
      }
      testId="trust-subprocessors-page"
      maxWidth="max-w-3xl"
    >
      <Card surface="solid">
        <CardContent className="pt-4" data-testid="trust-subprocessors">
          {registry.isPending ? (
            <LoadingState message="Loading subprocessor registry…" />
          ) : registry.isError && isNotBuiltError(registry.error) ? (
            <EmptyState
              icon={ServerCog}
              title="Subprocessor registry pending"
              description="The registry is not published yet (Agent F, Wave 3). No data is hidden — there is nothing to show yet."
              testId="trust-subprocessors-empty"
            />
          ) : registry.isError ? (
            <ErrorState
              title="Could not load the subprocessor registry"
              message="The service is unavailable."
              onRetry={() => void registry.refetch()}
            />
          ) : rows.length === 0 ? (
            <EmptyState
              icon={ServerCog}
              title="No subprocessors listed"
              description="The registry is empty."
              testId="trust-subprocessors-empty"
            />
          ) : (
            <DataTable columns={SUBPROCESSOR_COLUMNS} rows={rows} rowKey={(row) => row.name} testId="trust-subprocessors-table" />
          )}
        </CardContent>
      </Card>
    </PageContainer>
  );
}
