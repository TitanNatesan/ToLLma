"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ScrollText } from "lucide-react";
import { EmptyState, LoadingState, PageContainer, PageHeader } from "@/components/ui";
import { useOrgs } from "@/hooks/useOrgs";
import { useOrgStore } from "@/store/org";
import { usePromptLoggingSettings } from "@/hooks/usePromptLogs";
import { resolvePromptLogPerms, tabFromParam, type PromptLogTab } from "./components/promptLogLogic";
import { PromptLogsPanel } from "./components/PromptLogsPanel";
import { PromptLogsSettings } from "./components/PromptLogsSettings";

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
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [tab, setTab] = useState<PromptLogTab>(() => tabFromParam(searchParams.get("tab")));

  // Keep the active tab in the URL (replace: no history spam, no scroll jump).
  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    if ((params.get("tab") ?? "logs") !== tab) {
      if (tab === "logs") params.delete("tab");
      else params.set("tab", tab);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    }
  }, [tab, pathname, router, searchParams]);

  if (isOrg && !orgs.isPending && !perms.canRead) {
    return (
      <PageContainer data-testid="prompt-logs-page">
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
    <PageContainer data-testid="prompt-logs-page">
      <PageHeader
        title="Prompt Logs"
        subtitle={isOrg ? `Organization logs · ${orgEntry?.name ?? ""}` : "Personal logs"}
      />
      <div className="flex gap-1 border-b border-zinc-200 px-4 dark:border-zinc-800" role="tablist" aria-label="Prompt log views" data-testid="prompt-logs-tabs">
        {(["logs", "settings"] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            data-testid={`tab-${t}`}
            className={`px-3 py-2 text-xs font-medium capitalize ${tab === t ? "border-b-2 border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-100" : "text-zinc-500"}`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "logs" && (
        <PromptLogsPanel
          orgId={orgId}
          perms={perms}
          loggingEnabled={settings.data?.enabled ?? true}
          settingsLoaded={!settings.isPending && !settings.error}
        />
      )}
      {tab === "settings" && (
        <PromptLogsSettings orgId={orgId} isOrg={isOrg} canManage={perms.canManage} />
      )}

      <p className="px-4 pb-4 text-[11px] text-zinc-400">
        Need to call the API directly? <Link href="/docs">API docs</Link> cover the prompt-log endpoints.
      </p>
    </PageContainer>
  );
}

export default function PromptLogsPage() {
  // useSearchParams needs a Suspense boundary or the production build fails
  // (the filter/tab state below reads the URL on mount).
  return (
    <Suspense fallback={<LoadingState message="Loading prompt logs…" className="py-12" />}>
      <PromptLogsPageInner />
    </Suspense>
  );
}
