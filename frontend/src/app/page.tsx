"use client";

import { useCallback, useEffect, useRef } from "react";
import Link from "next/link";
import { AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { ChatComposer } from "@/app/components/ChatInput";
import { IntelligencePanel } from "@/app/components/ChatSettingsPanel";
import { MessageView } from "@/app/components/MessageView";
import { ChatHeader } from "@/app/components/ChatHeader";
import { Button } from "@/components/ui";
import { useConversation, useConversationMutations } from "@/hooks/useChat";
import { streamChat } from "@/services/api";
import { useChatStore } from "@/store/chat";
import { RotateCcw, Sparkles } from "lucide-react";
import type { ChatMessage } from "@/types";

export default function Home() {
  const {
    providerId,
    modelId,
    activeConversationId,
    streaming,
    optimisticMessages,
    setConversation,
    setStreaming,
    addOptimistic,
    updateOptimisticStreaming,
    clearOptimistic,
  } = useChatStore();

  const { data: conversation, error: convError } = useConversation(activeConversationId);
  const mutations = useConversationMutations();
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  useEffect(() => {
    if (!convError) return;
    const status = (convError as { status?: number })?.status;
    if (status === 404 || convError.message?.includes(" 404 ")) {
      setConversation(null);
    }
  }, [convError, setConversation]);

  const persistedMessages: ChatMessage[] = conversation?.messages ?? [];
  const allMessages = [...persistedMessages, ...optimisticMessages] as ChatMessage[];

  // Auto-scroll to bottom on message updates
  useEffect(() => {
    if (stickRef.current) {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }
  }, [allMessages.length, optimisticMessages]);

  const send = useCallback((text: string, conversationId: string | null) => {
    if (!providerId || !modelId) return;

    const ts = Date.now();
    const userMsgId = `opt-user-${ts}`;
    const assistantMsgId = `opt-assistant-${ts + 1}`;

    // Optimistic user message
    addOptimistic({
      id: userMsgId,
      role: "user",
      content: text,
      created_at: new Date(ts).toISOString(),
    });
    // Optimistic assistant placeholder
    addOptimistic({
      id: assistantMsgId,
      role: "assistant",
      content: "",
      isStreaming: true,
      created_at: new Date(ts + 1).toISOString(),
    });

    setStreaming(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    let convId = conversationId;

    void streamChat(
      { provider_id: providerId, model_id: modelId, conversation_id: conversationId, message: text },
      {
        signal: ctrl.signal,
        onMeta: (id) => {
          convId = id;
          setConversation(id);
        },
        onDelta: (d) => {
          updateOptimisticStreaming(assistantMsgId, d);
        },
        onDone: (_done) => {
          setStreaming(false);
          clearOptimistic();
          mutations.refresh(convId);
        },
        onError: (m) => {
          setStreaming(false);
          clearOptimistic();
          toast.error("Chat failed", { description: m });
          mutations.refresh(convId);
        },
      },
    );
  }, [
    providerId,
    modelId,
    addOptimistic,
    setStreaming,
    setConversation,
    updateOptimisticStreaming,
    clearOptimistic,
    mutations,
  ]);

  const lastUser = [...persistedMessages].reverse().find((m) => m.role === "user");
  const ready = !!providerId && !!modelId;

  return (
    <div className="flex h-full flex-1 overflow-hidden">
      {/* Center Chat Panel */}
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-white dark:bg-zinc-950">
        {/* Chat Header */}
        <ChatHeader />

        {/* Messages area */}
        <div
          ref={scrollRef}
          className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-6"
          data-testid="message-list"
          onScroll={(e) => {
            const el = e.currentTarget;
            stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
          }}
        >
          {allMessages.length === 0 && !streaming && (
            <div className="m-auto flex max-w-md flex-col items-center gap-4 text-center">
              <div className="flex size-14 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-600 shadow-sm dark:bg-zinc-800 dark:text-zinc-300">
                <Sparkles className="size-7" />
              </div>
              <h1 className="text-xl font-semibold text-zinc-800 dark:text-zinc-200">
                Start a conversation
              </h1>
              <p className="text-sm text-zinc-500">
                Select a provider and model in the composer below, then type your message.
                {!ready && (
                  <span>
                    {" "}
                    <Link href="/providers" className="text-tollma-600 underline hover:text-tollma-700 dark:text-tollma-400 dark:hover:text-tollma-300">
                      Set up a provider
                    </Link>{" "}
                    to get started.
                  </span>
                )}
              </p>
              <p className="text-xs text-zinc-400">
                Press <kbd className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">Ctrl+K</kbd> to open the command palette
              </p>
            </div>
          )}

          <AnimatePresence initial={false}>
            {allMessages.map((m) => {
              const isOpt = m.id.startsWith("opt-");
              const isStreaming = isOpt && (m as { isStreaming?: boolean }).isStreaming && streaming;
              return (
                <MessageView
                  key={m.id}
                  message={m}
                  isStreaming={isStreaming}
                  onRegenerate={
                    !isOpt && m.role === "assistant" && lastUser
                      ? () => send(lastUser.content, activeConversationId)
                      : undefined
                  }
                />
              );
            })}
          </AnimatePresence>
        </div>

        {/* Regenerate button (persisted messages only) */}
        {persistedMessages.length > 0 && !streaming && lastUser && (
          <div className="flex gap-2 px-4 pb-1">
            <Button
              variant="ghost"
              size="sm"
              data-testid="regenerate-button"
              onClick={() => send(lastUser.content, activeConversationId)}
              disabled={!ready}
              className="gap-1.5 text-xs text-zinc-600 dark:text-zinc-400"
            >
              <RotateCcw className="size-3.5" />
              Regenerate
            </Button>
          </div>
        )}

        {/* Composer */}
        <ChatComposer
          streaming={streaming}
          onSend={(t) => send(t, activeConversationId)}
          onStop={() => abortRef.current?.abort()}
        />
      </main>

      {/* Right Intelligence Panel */}
      <IntelligencePanel />
    </div>
  );
}
