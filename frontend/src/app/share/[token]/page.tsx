"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { Eye, Lock } from "lucide-react";
import { getPublicShare } from "@/services/api";
import { ResponseMarkdown } from "@/app/components/ResponseMarkdown";
import { cn } from "@/lib/utils";

/** Public, read-only conversation view. No auth, no user or credential data. */
export default function PublicSharePage() {
  const params = useParams<{ token: string }>();
  const token = typeof params?.token === "string" ? params.token : "";

  const { data, isLoading, isError } = useQuery({
    queryKey: ["public-share", token],
    queryFn: () => getPublicShare(token),
    enabled: Boolean(token),
    retry: false,
  });

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <span className="text-sm font-semibold tracking-tight">ToLLma</span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-zinc-100 px-2.5 py-1 text-[10px] text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
            <Lock className="size-3" /> Read-only shared conversation
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8" data-testid="public-share-page">
        {isLoading && <p className="text-sm text-zinc-400">Loading conversation…</p>}
        {isError && (
          <div className="rounded-xl border border-zinc-200 bg-white p-6 text-center dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-sm font-medium" data-testid="public-share-error">
              This share link is no longer available.
            </p>
            <p className="mt-1 text-xs text-zinc-500">
              It may have been disabled, regenerated, or expired.
            </p>
          </div>
        )}

        {data && (
          <>
            <h1 className="text-2xl font-semibold tracking-tight" data-testid="public-share-title">
              {data.title}
            </h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[11px] text-zinc-400">
              <span>{new Date(data.created_at).toLocaleString()}</span>
              {data.model_name && <span>· {data.model_name}</span>}
              {data.provider_name && <span>· {data.provider_name}</span>}
              <span className="inline-flex items-center gap-1">
                <Eye className="size-3" /> {data.view_count}
              </span>
            </div>

            <div className="mt-6 space-y-5">
              {data.messages.map((message, index) => (
                <article
                  className={cn(
                    "rounded-2xl border px-4 py-3",
                    message.role === "user"
                      ? "ml-auto max-w-[85%] border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-800"
                      : "max-w-[92%] border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900",
                  )}
                  data-testid={`public-message-${message.role}`}
                  key={index}
                >
                  <header className="mb-1.5 text-[10px] font-semibold tracking-wide text-zinc-400 uppercase">
                    {message.role === "user" ? "User" : "Assistant"}
                  </header>
                  <ResponseMarkdown content={message.content} />
                </article>
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
