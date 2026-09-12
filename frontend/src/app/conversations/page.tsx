"use client";

import Link from "next/link";
import { useState } from "react";
import { Card, GhostButton, Input } from "@/components/ui";
import { useConversationMutations, useConversations, useUsage } from "@/hooks/useChat";
import { useChatStore } from "@/store/chat";

function UsageLine({ id }: { id: string }) {
  const { data } = useUsage(id);
  if (!data || data.total_tokens === 0) return null;
  return (
    <span className="text-xs text-zinc-500">
      {data.total_tokens} tok · ${data.total_cost}
    </span>
  );
}

export default function ConversationsPage() {
  const [search, setSearch] = useState("");
  const { data } = useConversations(search);
  const mutations = useConversationMutations();
  const { setConversation } = useChatStore();

  return (
    <main className="flex flex-1 flex-col gap-4 p-4">
      <h1 className="text-xl font-semibold">Conversations</h1>
      <Input
        placeholder="Search conversations"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-72"
        aria-label="Search conversations"
      />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {(data ?? []).map((c) => (
          <Card key={c.id}>
            <Link
              href="/"
              onClick={() => setConversation(c.id)}
              className="font-semibold hover:underline"
            >
              {c.title}
            </Link>
            <p className="text-xs text-zinc-500">Updated {new Date(c.updated_at).toLocaleString()}</p>
            <div className="mt-1">
              <UsageLine id={c.id} />
            </div>
            <div className="mt-3 flex gap-2">
              <GhostButton
                onClick={() => {
                  const title = prompt("Rename conversation", c.title);
                  if (title?.trim()) mutations.rename.mutate({ id: c.id, title: title.trim() });
                }}
              >
                Rename
              </GhostButton>
              <GhostButton onClick={() => mutations.remove.mutate(c.id)}>Delete</GhostButton>
            </div>
          </Card>
        ))}
      </div>
    </main>
  );
}
