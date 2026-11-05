"use client";

import { useCallback, useState, type ComponentType } from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import { toast } from "@/lib/notify";
import { logout } from "@/services/api";
import { useAuthStore } from "@/store/auth";
import { Dialog, DialogContent } from "./primitives";
import { useChatStore } from "@/store/chat";
import { useConversations } from "@/hooks/useChat";
import { useProviders } from "@/hooks/useRegistry";
import { providerTypeLabel } from "@/app/providers/fields";
import {
  Command as CommandIcon,
  Cpu,
  BarChart3,
  BookOpen,
  Building2,
  CornerDownLeft,
  KeyRound,
  LogOut,
  MessageSquare,
  Pin,
  Plus,
  ScrollText,
  Search,
  Settings,
  Settings2,
  ShieldCheck,
  Sparkles,
  Users,
  UsersRound,
  Wallet,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useOrgStore } from "@/store/org";
import { useOrgProviders, useOrgs } from "@/hooks/useOrgs";
import { useWorkspaceSearch, type WorkspaceHit } from "@/hooks/useWorkspaceSearch";

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

const itemCls =
  "flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-sm outline-none transition-colors " +
  "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800/80 " +
  "data-[selected=true]:bg-tollma-50 data-[selected=true]:ring-1 data-[selected=true]:ring-inset data-[selected=true]:ring-tollma-500/30 " +
  "dark:data-[selected=true]:bg-tollma-950/40";

/** One palette row: icon tile + title/description + optional trailing hint. */
function PaletteItem({
  value,
  onSelect,
  testId,
  icon: Icon,
  iconClassName,
  title,
  description,
  hint,
}: {
  value: string;
  onSelect: () => void;
  testId?: string;
  icon: ComponentType<{ className?: string }>;
  iconClassName?: string;
  title: string;
  description?: string;
  hint?: React.ReactNode;
}) {
  return (
    <Command.Item value={value} onSelect={onSelect} className={itemCls} data-testid={testId}>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-zinc-100 dark:bg-zinc-800">
        <Icon className={cn("size-4 text-zinc-500 dark:text-zinc-400", iconClassName)} aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{title}</span>
        {description && (
          <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">{description}</span>
        )}
      </span>
      {hint}
    </Command.Item>
  );
}

const KIND_ICON: Record<string, ComponentType<{ className?: string }>> = {
  conversation: MessageSquare,
  member: Users,
  team: UsersRound,
  set: ShieldCheck,
  key: KeyRound,
  provider: Cpu,
  guardrail: ShieldCheck,
  'prompt-log': ScrollText,
  audit: ScrollText,
};

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 pb-1.5 pt-3 text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
      {children}
    </div>
  );
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const router = useRouter();
  const {
    setConversation,
    setSearch,
    setLeftSidebar,
    setAddProviderOpen,
  } = useChatStore();
  const reset = useAuthStore((s) => s.reset);

  // Mirrors SidebarNavigation SidebarLogoutNav: logout, then reset the auth
  // store, then land on the chat home.
  async function onLogout() {
    try {
      await logout();
    } finally {
      reset();
      router.push("/");
    }
    toast.success("Logged out");
    onClose();
  }
  const { data: convs = [] } = useConversations("");
  const { data: providers = [] } = useProviders();
  const [query, setQuery] = useState("");

  // Scope-aware navigation: org workspace shows org sections (permission
  // filtered, same codes as the sidebar) plus the unified pages; personal
  // workspace shows the shared pages only.
  const context = useOrgStore((s) => s.context);
  const isOrg = context.type === "org";
  const orgEntry = useOrgs().data?.find((o) => isOrg && o.id === context.orgId);
  const can = (...codes: string[]) =>
    !isOrg || (!!orgEntry && (orgEntry.is_root || codes.some((c) => orgEntry.permissions.includes(c))));
  const { data: orgProviders = [] } = useOrgProviders(isOrg ? context.orgId : "", {
    enabled: isOrg && (!!orgEntry?.is_root || !!orgEntry?.permissions.includes("Providers.Read")),
  });
  const scopeProviders = isOrg ? orgProviders : providers;

  // Workspace-scoped search: server conversation search + permission-gated
  // entity lists (members/teams/sets/keys/guardrails), debounced 250ms with
  // stale cancellation inside the hook. No secrets ever render (key hits
  // carry names only).
  const ws = useWorkspaceSearch(query, { open, orgId: isOrg ? context.orgId : null, can });
  const wsActive = query.trim().length >= 2;
  const providerHits = wsActive
    ? scopeProviders
        .filter((p) => p.name.toLowerCase().includes(query.trim().toLowerCase()))
        .slice(0, 5)
        .map((p) => ({
          id: `provider:${p.id}`,
          kind: "provider",
          title: p.name,
          subtitle: providerTypeLabel(p.provider_type),
          href: `/providers?provider=${encodeURIComponent(p.id)}`,
          testId: `cmd-hit-provider-${p.id}`,
        }) satisfies WorkspaceHit)
    : [];

  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setQuery("");
  }

  const run = useCallback(
    (fn: () => void) => {
      fn();
      onClose();
    },
    [onClose],
  );

  const filteredConvs = convs
    .filter((c) => c.title.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 6);

  const navItems: Array<{
    label: string;
    description: string;
    href: string;
    keywords: string;
    Icon: ComponentType<{ className?: string }>;
    testId: string;
  }> = [
    { label: "Chat", description: "Jump to chat", href: "/", keywords: "go to chat conversation home", Icon: MessageSquare, testId: "cmd-nav-chat" },
    { label: "Providers", description: "Browse registered providers", href: "/providers", keywords: "go to providers registry", Icon: Cpu, testId: "cmd-nav-providers" },
    { label: "API Keys", description: "Manage gateway keys", href: "/api-keys", keywords: "go to api keys tokens", Icon: KeyRound, testId: "cmd-nav-keys" },
    { label: "Analytics", description: "Usage and cost insights", href: "/analytics", keywords: "go to analytics usage costs", Icon: BarChart3, testId: "cmd-nav-analytics" },
    { label: "Guardrails", description: "Policy enforcement", href: "/guardrails", keywords: "go to guardrails policies enforcement", Icon: ShieldCheck, testId: "cmd-nav-guardrails" },
    { label: "Prompt Logs", description: "Request history", href: "/prompt-logs", keywords: "go to prompt logs requests history", Icon: ScrollText, testId: "cmd-nav-prompt-logs" },
    { label: "API Docs", description: "Integration reference", href: "/docs", keywords: "go to api docs reference", Icon: BookOpen, testId: "cmd-nav-docs" },
    ...(isOrg
      ? [
          { label: "Organization overview", description: "Org dashboard and stats", href: `/organizations/${context.orgId}`, keywords: "go to organization overview dashboard", Icon: Building2, testId: "cmd-nav-org-overview" },
          ...(can("Members.Read") ? [{ label: "Members", description: "Invite and manage members", href: `/organizations/${context.orgId}?section=members`, keywords: "go to organization members", Icon: Users, testId: "cmd-nav-org-members" }] : []),
          ...(can("Teams.Read") ? [{ label: "Teams", description: "Group members into teams", href: `/organizations/${context.orgId}?section=teams`, keywords: "go to organization teams", Icon: UsersRound, testId: "cmd-nav-org-teams" }] : []),
          ...(can("PermissionSets.Read") ? [{ label: "Permission Sets", description: "Role templates and grants", href: `/organizations/${context.orgId}?section=sets`, keywords: "go to permission sets roles", Icon: ShieldCheck, testId: "cmd-nav-org-sets" }] : []),
          ...(can("Keys.Read", "Members.Read", "Members.Invite", "Members.Approve", "Members.Update") ? [{ label: "Operations", description: "Invitations and join requests", href: `/organizations/${context.orgId}?section=operations`, keywords: "go to operations invitations requests", Icon: Settings2, testId: "cmd-nav-org-operations" }] : []),
          { label: "Budgets", description: "Spending caps and allocation", href: `/organizations/${context.orgId}?section=budgets`, keywords: "go to budgets spending caps", Icon: Wallet, testId: "cmd-nav-org-budgets" },
          ...(can("Audit.Read") ? [{ label: "Audit Logs", description: "Security and activity trail", Icon: ScrollText, keywords: "go to audit logs", href: `/organizations/${context.orgId}?section=audit`, testId: "cmd-nav-org-audit" }] : []),
          { label: "Organization settings", description: "Profile and danger zone", href: `/organizations/${context.orgId}?section=settings`, keywords: "go to organization settings", Icon: Settings, testId: "cmd-nav-org-settings" },
        ]
      : [
          { label: "Settings", description: "Workspace preferences", href: "/settings", keywords: "go to settings preferences", Icon: Settings, testId: "cmd-nav-settings" },
        ]),
  ];

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg overflow-hidden rounded-2xl p-0 shadow-2xl ring-1 ring-zinc-200 dark:ring-zinc-800">
        <Command
          className="rounded-2xl bg-white dark:bg-zinc-950"
          label="Command palette"
          data-testid="command-palette"
        >
          <div className="flex items-center gap-2 border-b border-zinc-200 px-4 dark:border-zinc-800">
            <CommandIcon className="size-4 shrink-0 text-zinc-400" aria-hidden />
            <Command.Input
              value={query}
              onValueChange={setQuery}
              placeholder="Search commands, models, or conversations…"
              className="flex-1 bg-transparent py-3.5 text-[15px] outline-none placeholder:text-zinc-400"
              data-testid="command-palette-input"
            />
            <kbd className="shrink-0 rounded-md border border-zinc-200 bg-zinc-100 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800">
              Esc
            </kbd>
          </div>

          <Command.List className="max-h-[420px] overflow-y-auto p-2">
            <Command.Empty className="flex flex-col items-center gap-1 px-4 py-10 text-center">
              <Search className="size-5 text-zinc-300 dark:text-zinc-600" aria-hidden />
              <p className="text-sm font-medium text-zinc-600 dark:text-zinc-300">No results found</p>
              <p className="text-xs text-zinc-400">Try a different search or browse the sections below.</p>
            </Command.Empty>

            {/* Core Actions */}
            <Command.Group>
              <SectionHeading>Workspace Actions</SectionHeading>
              <div className="space-y-0.5">
                <PaletteItem
                  value="new chat start conversation"
                  onSelect={() => run(() => { setConversation(null); router.push("/"); })}
                  testId="cmd-new-chat"
                  icon={Plus}
                  title="New chat"
                  description="Start a fresh conversation"
                  hint={<CornerDownLeft className="size-3.5 shrink-0 text-zinc-300 dark:text-zinc-600" aria-hidden />}
                />
                <PaletteItem
                  value="search conversations filter chats"
                  onSelect={() => run(() => { setLeftSidebar(true); setSearch(""); })}
                  testId="cmd-search-conversations"
                  icon={Search}
                  title="Search conversations"
                  description="Filter across all chats"
                />
                <PaletteItem
                  value="go to providers manage"
                  onSelect={() => run(() => router.push("/providers"))}
                  testId="cmd-providers"
                  icon={Cpu}
                  title="Manage providers"
                  description="Validate, refresh and register models"
                />
                <PaletteItem
                  value="add provider create new connection"
                  onSelect={() => run(() => { router.push("/providers"); setAddProviderOpen(true); })}
                  testId="cmd-add-provider"
                  icon={Plus}
                  iconClassName="text-tollma-500"
                  title="Add provider"
                  description="Connect a new provider"
                />
              </div>
            </Command.Group>

            {/* Workspace search results (server conversations + gated entities) */}
            {wsActive && ws.pending && (
              <Command.Group>
                <SectionHeading>Workspace results</SectionHeading>
                <p className="px-3 py-4 text-center text-xs text-zinc-400" data-testid="cmd-search-loading">
                  Searching workspace…
                </p>
              </Command.Group>
            )}
            {wsActive && ws.error && (
              <Command.Group>
                <SectionHeading>Workspace results</SectionHeading>
                <div className="flex flex-col items-center gap-1.5 px-4 py-4 text-center">
                  <p className="text-xs text-zinc-500">Workspace search failed.</p>
                  <button
                    type="button"
                    onClick={() => ws.retry()}
                    data-testid="cmd-search-retry"
                    className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  >
                    Retry
                  </button>
                </div>
              </Command.Group>
            )}
            {ws.groups.map((group) => (
              <Command.Group key={group.kind}>
                <SectionHeading>{group.label}</SectionHeading>
                <div className="space-y-0.5">
                  {group.hits.map((hit) => (
                    <PaletteItem
                      key={hit.id}
                      value={`${hit.kind} ${hit.title} ${hit.subtitle ?? ""}`}
                      onSelect={() => run(() => router.push(hit.href))}
                      testId={hit.testId}
                      icon={KIND_ICON[hit.kind] ?? Search}
                      title={hit.title}
                      description={hit.subtitle}
                    />
                  ))}
                </div>
              </Command.Group>
            ))}
            {providerHits.length > 0 && (
              <Command.Group>
                <SectionHeading>Providers</SectionHeading>
                <div className="space-y-0.5">
                  {providerHits.map((hit) => (
                    <PaletteItem
                      key={hit.id}
                      value={`provider ${hit.title} ${hit.subtitle ?? ""}`}
                      onSelect={() => run(() => router.push(hit.href))}
                      testId={hit.testId}
                      icon={Cpu}
                      title={hit.title}
                      description={hit.subtitle}
                    />
                  ))}
                </div>
              </Command.Group>
            )}

            {/* Scope-aware navigation */}
            <Command.Group>
              <SectionHeading>
                {isOrg ? `Go to · ${context.type === "org" ? context.orgName : ""}` : "Go to"}
              </SectionHeading>
              <div className="space-y-0.5">
                {navItems.map(({ label, description, href, keywords, Icon, testId }) => (
                  <PaletteItem
                    key={testId}
                    value={keywords}
                    onSelect={() => run(() => router.push(href))}
                    testId={testId}
                    icon={Icon}
                    title={label}
                    description={description}
                  />
                ))}
              </div>
            </Command.Group>

            {/* Provider Shortcuts (scope-aware) */}
            {scopeProviders.length > 0 && (
              <Command.Group>
                <SectionHeading>Configured Providers</SectionHeading>
                <div className="space-y-0.5">
                  {scopeProviders.slice(0, 5).map((p) => (
                    <PaletteItem
                      key={p.id}
                      value={`provider ${p.name} ${providerTypeLabel(p.provider_type)}`}
                      onSelect={() => run(() => { router.push("/providers"); })}
                      icon={Cpu}
                      title={p.name}
                      description={providerTypeLabel(p.provider_type)}
                    />
                  ))}
                </div>
              </Command.Group>
            )}

            {/* Session */}
            <Command.Group>
              <SectionHeading>Session</SectionHeading>
              <div className="space-y-0.5">
                <PaletteItem
                  value="log out sign out session"
                  onSelect={() => void onLogout()}
                  testId="palette-logout"
                  icon={LogOut}
                  title="Log out"
                  description="Sign out of this workspace"
                />
              </div>
            </Command.Group>

            {/* Recent Conversations (local filter; hidden while workspace search runs) */}
            {!wsActive && filteredConvs.length > 0 && (
              <Command.Group>
                <SectionHeading>Recent Conversations</SectionHeading>
                <div className="space-y-0.5">
                  {filteredConvs.map((c) => (
                    <PaletteItem
                      key={c.id}
                      value={`conversation ${c.title}`}
                      onSelect={() => run(() => router.push(`/c/${c.id}`))}
                      testId={`cmd-conv-${c.id}`}
                      icon={MessageSquare}
                      title={c.title}
                      description={c.is_pinned ? "Pinned conversation" : undefined}
                      hint={c.is_pinned ? <Pin className="size-3.5 shrink-0 text-amber-500" aria-hidden /> : undefined}
                    />
                  ))}
                </div>
              </Command.Group>
            )}
          </Command.List>

          <div className="flex items-center justify-between border-t border-zinc-200 px-4 py-2.5 dark:border-zinc-800">
            <div className="flex items-center gap-1.5 text-[11px] text-zinc-400">
              <Sparkles className="size-3 text-zinc-400" aria-hidden />
              <span>ToLLma AI Workspace{isOrg && context.type === "org" ? ` · ${context.orgName}` : ""}</span>
            </div>
            <p className="flex items-center gap-1.5 font-mono text-[10px] text-zinc-400">
              <span><kbd className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">↑↓</kbd> navigate</span>
              <span><kbd className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">Enter</kbd> select</span>
              <span><kbd className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">Esc</kbd> close</span>
            </p>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

export function useCommandPalette() {
  // Ctrl+K is owned by useGlobalShortcuts (single listener, one source of
  // truth); this hook only holds the open state for AppShell.
  const [open, setOpen] = useState(false);
  return { open, setOpen };
}
