"use client";

import { useMemo } from "react";
import { MessageSquare, UserCheck, UserPlus, Users } from "lucide-react";
import { SearchInput } from "@/components/ui";
import { SectionCard } from "./SectionCard";
import { KpiCard } from "./KpiCard";
import { UsersTable } from "./tables";
import { fmtCompact, fmtMoney, fmtNumber, toNumber } from "./format";
import type { AdminUsers } from "@/types/admin";

interface UsersSectionProps {
  data: AdminUsers;
  search: string;
  onSearchChange: (value: string) => void;
  refreshing?: boolean;
}

/** Users tab: platform totals + searchable per-user usage table. */
export function UsersSection({ data, search, onSearchChange, refreshing = false }: UsersSectionProps) {
  const totalSpend = useMemo(
    () => data.rows.reduce((sum, row) => sum + toNumber(row.total_cost), 0),
    [data.rows],
  );
  const totalChats = useMemo(
    () => data.rows.reduce((sum, row) => sum + row.conversations, 0),
    [data.rows],
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="admin-users-kpis">
        <KpiCard
          label="Total users"
          value={fmtNumber(data.total_users)}
          icon={<Users className="size-4" />}
          testId="admin-users-total"
        />
        <KpiCard
          label="Active users"
          value={fmtNumber(data.active_users)}
          sub="With activity in range"
          icon={<UserCheck className="size-4" />}
          testId="admin-users-active"
        />
        <KpiCard
          label="New users"
          value={fmtNumber(data.new_users)}
          icon={<UserPlus className="size-4" />}
          testId="admin-users-new"
        />
        <KpiCard
          label="Chats (top rows)"
          value={fmtNumber(totalChats)}
          sub={`${fmtMoney(totalSpend)} spend across listed users`}
          icon={<MessageSquare className="size-4" />}
          testId="admin-users-chats"
        />
      </div>

      <SectionCard
        title="User breakdown"
        description="Requests, conversations, tokens and spend per user."
        testId="admin-users-table-card"
        action={
          <div className="flex items-center gap-2">
            {refreshing && <span className="text-[10px] text-zinc-400">Refreshing…</span>}
            <div className="w-52">
              <SearchInput
                value={search}
                onChange={(event) => onSearchChange(event.target.value)}
                onClear={() => onSearchChange("")}
                placeholder="Search by email"
                aria-label="Search users"
                data-testid="admin-users-search"
              />
            </div>
          </div>
        }
      >
        <UsersTable rows={data.rows} />
        {data.rows.length > 0 && (
          <p className="mt-3 text-[10px] text-zinc-400">
            Top {data.rows.length} users by usage · {fmtCompact(
              data.rows.reduce((sum, row) => sum + row.total_tokens, 0),
            )}{" "}
            tokens listed
          </p>
        )}
      </SectionCard>
    </div>
  );
}
