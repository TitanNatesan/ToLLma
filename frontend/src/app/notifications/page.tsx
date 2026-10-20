"use client";

import { useMemo } from "react";
import { Bell, BellOff, Check } from "lucide-react";
import { toast } from "sonner";
import {
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  ErrorState,
  LoadingState,
  PageContainer,
  PageHeader,
} from "@/components/ui";
import { cn } from "@/lib/utils";
import { parseApiError } from "@/lib/errors";
import { useNotifications, useOrgMutations, useOrgs } from "@/hooks/useOrgs";
import type { Notification } from "@/types/orgs";

function timeLabel(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function NotificationCard({
  notification,
  onMarkRead,
  pending,
}: {
  notification: Notification;
  onMarkRead: (id: string) => void;
  pending: boolean;
}) {
  const unread = !notification.read_at;
  return (
    <Card
      data-testid={`notification-${notification.id}`}
      className={cn(unread && "border-zinc-400 dark:border-zinc-600")}
    >
      <CardContent className="flex items-start gap-2 p-3">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-1.5 text-xs font-semibold">
            {notification.title}
            {unread && (
              <Badge variant="secondary" className="text-[9px]" data-testid={`notification-unread-${notification.id}`}>
                Unread
              </Badge>
            )}
          </p>
          {notification.body && <p className="mt-0.5 text-xs text-zinc-500">{notification.body}</p>}
          <p className="mt-1 font-mono text-[10px] text-zinc-400">
            {notification.kind} · {timeLabel(notification.created_at)}
          </p>
        </div>
        {unread && (
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => onMarkRead(notification.id)}
            data-testid={`notification-read-${notification.id}`}
          >
            <Check className="size-3.5" aria-hidden /> Mark read
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

/** Personal inbox plus one group per organization. Empty states per group. */
export default function NotificationsPage() {
  const notifications = useNotifications();
  const orgs = useOrgs();
  const mut = useOrgMutations();
  const pending = mut.markRead.isPending || mut.markAllRead.isPending;

  const orgName = useMemo(() => {
    const map = new Map<string, string>();
    for (const org of orgs.data ?? []) map.set(org.id, org.name);
    return map;
  }, [orgs.data]);

  const { personal, orgGroups } = useMemo(() => {
    const items = notifications.data ?? [];
    const personal = items.filter((n) => !n.org_id);
    const byOrg = new Map<string, Notification[]>();
    for (const n of items) {
      if (!n.org_id) continue;
      const list = byOrg.get(n.org_id) ?? [];
      list.push(n);
      byOrg.set(n.org_id, list);
    }
    return {
      personal,
      orgGroups: [...byOrg.entries()].sort((a, b) =>
        (orgName.get(a[0]) ?? a[0]).localeCompare(orgName.get(b[0]) ?? b[0]),
      ),
    };
  }, [notifications.data, orgName]);

  const unreadCount = (items: Notification[]) => items.filter((n) => !n.read_at).length;
  const totalUnread = unreadCount(notifications.data ?? []);

  async function markRead(id: string) {
    try {
      await mut.markRead.mutateAsync(id);
    } catch (e) {
      toast.error(parseApiError(e).message);
    }
  }

  async function markAllRead() {
    try {
      await mut.markAllRead.mutateAsync();
      toast.success("All notifications marked as read.");
    } catch (e) {
      toast.error(parseApiError(e).message);
    }
  }

  return (
    <PageContainer
      header={
        <PageHeader
          title="Notifications"
          subtitle="Invitations, requests and workspace activity."
          badges={
            totalUnread > 0 ? (
              <Badge variant="secondary" className="text-[10px]" data-testid="notifications-unread-badge">
                {totalUnread} unread
              </Badge>
            ) : undefined
          }
          actions={
            <Button
              size="sm"
              variant="outline"
              disabled={pending || totalUnread === 0}
              onClick={() => void markAllRead()}
              data-testid="notifications-mark-all-read"
            >
              <Check className="size-3.5" aria-hidden /> Mark all read
            </Button>
          }
        />
      }
      testId="notifications-page"
    >
      {notifications.isPending && <LoadingState message="Loading notifications…" className="py-16" />}
      {notifications.isError && (
        <ErrorState
          title="Could not load notifications"
          message={parseApiError(notifications.error).message}
          onRetry={() => void notifications.refetch()}
        />
      )}
      {!notifications.isPending && !notifications.isError && (
        <div className="flex flex-col gap-6">
          <section aria-label="Personal notifications">
            <h2 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500">
              <Bell className="size-3.5" aria-hidden /> Personal
              {unreadCount(personal) > 0 && (
                <Badge variant="secondary" className="text-[9px]" data-testid="notifications-unread-personal">
                  {unreadCount(personal)} unread
                </Badge>
              )}
            </h2>
            {personal.length === 0 ? (
              <EmptyState
                icon={BellOff}
                title="No personal notifications"
                description="Account-level updates will appear here."
                testId="notifications-empty-personal"
              />
            ) : (
              <div className="flex flex-col gap-2">
                {personal.map((n) => (
                  <NotificationCard key={n.id} notification={n} onMarkRead={(id) => void markRead(id)} pending={pending} />
                ))}
              </div>
            )}
          </section>

          {orgGroups.map(([orgId, items]) => (
            <section key={orgId} aria-label={`Notifications for ${orgName.get(orgId) ?? orgId}`}>
              <h2 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                <Bell className="size-3.5" aria-hidden /> {orgName.get(orgId) ?? orgId}
                {unreadCount(items) > 0 && (
                  <Badge variant="secondary" className="text-[9px]" data-testid={`notifications-unread-org-${orgId}`}>
                    {unreadCount(items)} unread
                  </Badge>
                )}
              </h2>
              {items.length === 0 ? (
                <EmptyState
                  icon={BellOff}
                  title="No notifications"
                  description={`Nothing for ${orgName.get(orgId) ?? "this organization"} yet.`}
                  testId={`notifications-empty-org-${orgId}`}
                />
              ) : (
                <div className="flex flex-col gap-2">
                  {items.map((n) => (
                    <NotificationCard key={n.id} notification={n} onMarkRead={(id) => void markRead(id)} pending={pending} />
                  ))}
                </div>
              )}
            </section>
          ))}

          {personal.length === 0 && orgGroups.length === 0 && (
            <EmptyState
              icon={BellOff}
              title="You're all caught up"
              description="No notifications across your account and organizations."
              testId="notifications-empty-all"
            />
          )}
        </div>
      )}
    </PageContainer>
  );
}
