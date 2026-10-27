"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/services/api";
import type { SearchGroupHit, SearchResponse } from "@/types";
import { useDebouncedValue } from "./useDebouncedValue";

export interface WorkspaceHit {
  /** Stable key: `${kind}:${id}`. */
  id: string;
  kind: string;
  title: string;
  subtitle?: string;
  href: string;
  testId: string;
}

export interface WorkspaceGroup {
  kind: string;
  label: string;
  hits: WorkspaceHit[];
}

const GROUP_LABELS: Record<string, string> = {
  members: "Members",
  teams: "Teams",
  providers: "Providers",
  guardrails: "Guardrails",
  keys: "API Keys",
  sets: "Permission Sets",
  prompt_logs: "Prompt Logs",
  audit: "Audit Log",
  conversation: "Conversations",
};

function groupHref(kind: string, hit: SearchGroupHit, orgId: string | null): string {
  const id = encodeURIComponent(hit.id);
  switch (hit.type) {
    case "member":
      return orgId ? `/organizations/${orgId}?section=members&member=${id}` : "#";
    case "team":
      return orgId ? `/organizations/${orgId}?section=teams&team=${id}` : "#";
    case "provider":
      return `/providers?provider=${id}`;
    case "guardrail":
      return `/guardrails?policy=${id}`;
    case "api_key":
      return `/api-keys?key=${id}`;
    case "permission_set":
      return orgId ? `/organizations/${orgId}?section=sets&set=${id}` : "#";
    case "prompt_log":
      return `/prompt-logs?requestId=${id}`;
    case "audit_event":
      return orgId ? `/organizations/${orgId}?section=audit&event=${id}` : "#";
    default:
      return "#";
  }
}

/**
 * Workspace-scoped palette search. Conversations come from server FTS and
 * entity hits from the server `groups` endpoint (`GET /api/v1/search`
 * with `?types=` + `?org_id=`) — both permission-filtered server-side,
 * abortable, metadata-only (names/prefixes, never secrets).
 */
export function useWorkspaceSearch(
  query: string,
  opts: { open: boolean; orgId: string | null; can: (code: string) => boolean },
) {
  const { open, orgId, can } = opts;
  const q = useDebouncedValue(query.trim().toLowerCase(), 250);
  const active = open && q.length >= 2;
  const isOrg = orgId !== null;

  const types = useMemo(() => {
    const t: string[] = [];
    if (isOrg) {
      if (can("Members.Read")) t.push("members");
      if (can("Teams.Read")) t.push("teams");
      if (can("PermissionSets.Read")) t.push("sets");
      if (can("Keys.Read")) t.push("keys");
      if (can("Audit.Read")) t.push("audit");
      if (can("PromptLogs.Read")) t.push("prompt_logs");
    }
    if (can("Providers.Read")) t.push("providers");
    if (can("Guardrails.Read")) t.push("guardrails");
    if (!isOrg && can("Keys.Read")) t.push("keys");
    return [...new Set(t)].join(",");
  }, [isOrg, can]);

  const search = useQuery({
    queryKey: ["workspace-search", q, orgId ?? "personal", types],
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({ q, limit: "20" });
      if (types) params.set("types", types);
      if (orgId) params.set("org_id", orgId);
      return apiRequest<SearchResponse>(`/api/v1/search?${params.toString()}`, { signal });
    },
    enabled: active,
    retry: 1,
    staleTime: 30_000,
  });

  const groups = useMemo<WorkspaceGroup[]>(() => {
    if (!active) return [];
    const out: WorkspaceGroup[] = [];
    const data = search.data;
    if (!data) return out;
    const convHits: WorkspaceHit[] = (data.results ?? []).slice(0, 6).map((r) => ({
      id: `conversation:${r.conversation_id}`,
      kind: "conversation",
      title: r.conversation_title || "Untitled conversation",
      subtitle: r.snippet ? r.snippet.slice(0, 80) : undefined,
      href: `/c/${r.conversation_id}`,
      testId: `cmd-hit-conv-${r.conversation_id}`,
    }));
    if (convHits.length > 0) out.push({ kind: "conversation", label: "Conversations", hits: convHits });

    for (const [gkind, items] of Object.entries(data.groups ?? {})) {
      const hits: WorkspaceHit[] = (items ?? []).slice(0, 5).map((h) => ({
        id: `${gkind}:${h.id}`,
        kind: gkind,
        title: h.title,
        subtitle: h.subtitle ?? h.snippet ?? undefined,
        href: groupHref(gkind, h, orgId),
        testId: `cmd-hit-${gkind}-${h.id}`,
      }));
      if (hits.length > 0) {
        out.push({ kind: gkind, label: GROUP_LABELS[gkind] ?? gkind, hits });
      }
    }
    return out;
  }, [active, search.data, orgId]);

  return {
    groups,
    pending: active && search.isPending,
    error: active ? search.error : null,
    retry: () => void search.refetch(),
  };
}
