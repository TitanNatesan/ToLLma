"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui";
import { createConversation } from "@/services/api";

/**
 * `/` is the "new chat" entry point: create a conversation once, then replace
 * the URL with its permanent home `/c/{id}`. No landing screen.
 */
export default function Home() {
  const router = useRouter();
  const [error, setError] = useState(false);
  // StrictMode double-invokes effects in dev; the ref keeps creation single.
  const started = useRef(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const create = useCallback(() => {
    setError(false);
    createConversation({})
      .then((conv) => {
        // The user may have navigated away while the request was in flight.
        if (alive.current) router.replace(`/c/${conv.id}`);
      })
      .catch(() => {
        if (alive.current) setError(true);
      });
  }, [router]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    create();
  }, [create]);

  if (error) {
    return (
      <div
        className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center"
        data-testid="new-chat-error"
      >
        <p className="text-sm text-zinc-500">Could not start a new chat.</p>
        <Button size="sm" variant="outline" onClick={create}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-1 items-center justify-center" data-testid="new-chat-loading">
      <Loader2 className="size-6 animate-spin text-zinc-400" />
    </div>
  );
}
