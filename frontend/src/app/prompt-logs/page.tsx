"use client";

import { Suspense, useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ScrollText } from "lucide-react";
import { EmptyState, LoadingState, PageContainer, PageHeader } from "@/components/ui";
import { useOrgs } from "@/hooks/useOrgs";
import { useOrgStore } from "@/store/org";
import { usePromptLoggingSettings } from "@/hooks/usePromptLogs";
import { resolvePromptLogPerms } from "./components/promptLogLogic";
import { PromptLogsPanel } from "./components/PromptLogsPanel";

function PromptLogsPageInner() {
  const context = useOrgStore((st) => st.context);
  const isOrg = context.type === "org";
  const orgId = isOrg ? context.orgId : undefined;

  const orgs = useOrgs();
  const orgEntry = orgId ? (orgs.data ?? []).find((o) => o.id === orgId) : undefined;
  const perms = resolvePromptLogPerms({
    isOrg,
    isRoot: !!orgEntry?.is_root,
    permissions: orgEntry?.permissions ?? [],
  });

  const settings = usePromptLoggingSettings(orgId, perms.canRead);

  // The settings tab moved to /settings#logging (R4). Preserve old deep
  // links (?tab=settings, bookmarks) with a one-way redirect instead of
  // silently landing on logs.
  const searchParams = useSearchParams();
  const router = useRouter();
  useEffect(() => {
    if (searchParams.get("tab") === "settings") {
      router.replace("/settings#logging");
    }
  }, [searchParams, router]);

  if (isOrg && !orgs.isPending && !perms.canRead) {
    return (
      <PageContainer testId="prompt-logs-page">
        <EmptyState
          icon={ScrollText}
          title="Prompt logs"
          description="You need the PromptLogs.Read permission to view organization prompt logs."
          testId="prompt-logs-denied"
        />
      </PageContainer>
    );
  }

  return (
    <PageContainer testId="prompt-logs-page">
      <PageHeader
        title="Prompt Logs"
        subtitle={isOrg ? `Organization logs · ${orgEntry?.name ?? ""}` : "Personal logs"}
      />
      <PromptLogsPanel
        orgId={orgId}
        perms={perms}
        loggingEnabled={settings.data?.enabled ?? true}
        settingsLoaded={!settings.isPending && !settings.error}
      />

      <p className="px-4 pb-4 text-[11px] text-zinc-400">
        Need to call the API directly? <Link href="/docs">API docs</Link> cover the prompt-log endpoints.
      </p>
    </PageContainer>
  );
}

export default function PromptLogsPage() {
  // PromptLogsPanel reads the URL filter state, so the Suspense boundary stays
  // (useSearchParams requires it for a passing production build).
  return (
    <Suspense fallback={<LoadingState message="Loading prompt logs…" className="py-12" />}>
      <PromptLogsPageInner />
    </Suspense>
  );
}
