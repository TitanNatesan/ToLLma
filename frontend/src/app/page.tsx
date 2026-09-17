"use client";

import { useCallback, useEffect, useRef } from "react";
import Link from "next/link";
import { AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { ChatComposer, type ChatSendPayload } from "@/app/components/chat/ChatComposer";
import { IntelligencePanel } from "@/app/components/ChatSettingsPanel";
import { MessageView } from "@/app/components/MessageView";
import { ChatHeader } from "@/app/components/ChatHeader";
import { useConversation, useConversationMutations } from "@/hooks/useChat";
import {
  cancelGeneration,
  getActiveGeneration,
  getGeneration,
  streamChat,
  streamGeneration,
  type StreamCallbacks,
} from "@/services/api";
import { useChatStore } from "@/store/chat";
import { Sparkles } from "lucide-react";
import type { ChatMessage, MessageStatus } from "@/types";

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
    setOptimisticContent,
    clearOptimistic,
    setActiveGeneration,
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
  // Optimistic entries carry backend-issued ids: they replace (never duplicate)
  // the persisted rows. History itself always comes from the backend.
  const optimisticIds = new Set(optimisticMessages.map((m) => m.id));
  const allMessages = [
    ...persistedMessages.filter((m) => !optimisticIds.has(m.id)),
    ...optimisticMessages,
  ] as ChatMessage[];

  // Auto-scroll to bottom on message updates
  useEffect(() => {
    if (stickRef.current) {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }
  }, [allMessages.length, optimisticMessages]);

  /** Terminal state for any watched stream: drop local overlays, reload truth. */
  const finishGeneration = useCallback((convId: string | null, status?: MessageStatus | null, error?: string | null) => {
    setStreaming(false);
    setActiveGeneration(null);
    clearOptimistic();
    mutations.refresh(convId);
    if (status === "failed") {
      toast.error("Generation failed", { description: error ?? undefined });
    }
  }, [
    setStreaming,
    setActiveGeneration,
    clearOptimistic,
    mutations,
  ]);

  /** Callbacks shared by fresh sends and refresh-reattach subscriptions. */
  const streamCallbacks = useCallback((ctrl: AbortController): StreamCallbacks => ({
    signal: ctrl.signal,
    onMeta: (meta) => {
      setConversation(meta.conversation_id);
      const genId = meta.generation_id;
      const msgId = meta.message_id ?? genId;
      if (genId && msgId) {
        setActiveGeneration({ id: genId, messageId: msgId });
        addOptimistic({
          id: msgId,
          role: "assistant",
          content: "",
          isStreaming: true,
          created_at: new Date().toISOString(),
        });
      }
    },
    onSnapshot: (content) => {
      const mid = useChatStore.getState().activeGeneration?.messageId;
      if (mid) setOptimisticContent(mid, content);
    },
    onDelta: (d) => {
      const mid = useChatStore.getState().activeGeneration?.messageId;
      if (mid) updateOptimisticStreaming(mid, d);
    },
    onDone: (done) => {
      finishGeneration(useChatStore.getState().activeConversationId, done.status, done.error);
    },
    onError: (m) => {
      const convId = useChatStore.getState().activeConversationId;
      setStreaming(false);
      setActiveGeneration(null);
      clearOptimistic();
      toast.error("Chat failed", { description: m });
      mutations.refresh(convId);
    },
  }), [
    setConversation,
    setActiveGeneration,
    addOptimistic,
    setOptimisticContent,
    updateOptimisticStreaming,
    finishGeneration,
    setStreaming,
    clearOptimistic,
    mutations,
  ]);

  const send = useCallback((payload: ChatSendPayload, conversationId: string | null) => {
    if (!providerId || !modelId) return;
    const text = payload.text;

    const ts = Date.now();
    const userMsgId = `opt-user-${ts}`;

    // Optimistic user echo only — the assistant row is created by the backend
    // and arrives via stream meta (never invented client-side).
    addOptimistic({
      id: userMsgId,
      role: "user",
      content: text,
      created_at: new Date(ts).toISOString(),
    });

    setStreaming(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    void streamChat(
      {
        provider_id: providerId,
        model_id: modelId,
        conversation_id: conversationId,
        message: text,
        reasoning_level: payload.reasoningLevel,
        attachment_ids: payload.attachments
          .map((a) => a.attachmentId)
          .filter((id): id is string => !!id),
      },
      streamCallbacks(ctrl),
    );
  }, [
    providerId,
    modelId,
    addOptimistic,
    setStreaming,
    streamCallbacks,
  ]);

  const lastUser = [...persistedMessages].reverse().find((m) => m.role === "user");
  const lastAssistantId = [...persistedMessages].reverse().find((m) => m.role === "assistant")?.id;
  const ready = !!providerId && !!modelId;

  /** User stop: cancel the backend generation, then reload truth.
   *  The local SSE abort only drops this tab's subscription. */
  const stop = useCallback(() => {
    const gen = useChatStore.getState().activeGeneration;
    abortRef.current?.abort();
    setStreaming(false);
    const settle = () => {
      setActiveGeneration(null);
      clearOptimistic();
      mutations.refresh(useChatStore.getState().activeConversationId);
    };
    if (!gen) {
      settle();
      return;
    }
    void (async () => {
      try {
        await cancelGeneration(gen.id);
      } catch {
        // Cancel is best-effort; the refresh below still shows backend truth.
      }
      // Wait for the terminal state so the refresh never shows stale running.
      for (let i = 0; i < 30; i++) {
        try {
          const current = await getGeneration(gen.id);
          if (current.status !== "running" && current.status !== "queued") break;
        } catch {
          break;
        }
        await new Promise((r) => setTimeout(r, 500));
      }
      settle();
    })();
  }, [
    setStreaming,
    setActiveGeneration,
    clearOptimistic,
    mutations,
  ]);

  // Refresh recovery: a generation running on the backend (started here or
  // in another tab before reload) reattaches its stream automatically.
  // NOTE: callbacks go through a ref — their identity churns with renders
  // and must never re-trigger (or abort) this effect. Same for `streaming`:
  // the subscription itself flips it, so it is read via ref and kept out
  // of deps (its presence there aborted recovery on the first re-render).
  const streamCallbacksRef = useRef(streamCallbacks);
  useEffect(() => {
    streamCallbacksRef.current = streamCallbacks;
  });
  const streamingRef = useRef(streaming);
  useEffect(() => {
    streamingRef.current = streaming;
  });
  const recoveredFor = useRef<string | null>(null);
  useEffect(() => {
    if (!activeConversationId || streamingRef.current || recoveredFor.current === activeConversationId) return;
    recoveredFor.current = activeConversationId;
    let settled = false;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    void (async () => {
      let active = null;
      try {
        active = await getActiveGeneration(activeConversationId);
      } catch {
        active = null;
      }
      if (!active || (active.status !== "running" && active.status !== "queued")) {
        recoveredFor.current = null;
        return;
      }
      setStreaming(true);
      setActiveGeneration({ id: active.generation_id, messageId: active.message_id });
      addOptimistic({
        id: active.message_id,
        role: "assistant",
        content: active.current_content,
        isStreaming: true,
        created_at: new Date().toISOString(),
      });
      const cbs = streamCallbacksRef.current(ctrl);
      const prevDone = cbs.onDone;
      await streamGeneration(active.generation_id, {
        ...cbs,
        onDone: (done) => {
          settled = true;
          prevDone(done);
        },
        onError: (m) => {
          settled = true;
          cbs.onError(m);
        },
      });
    })().catch(() => {});
    return () => {
      if (!settled) {
        recoveredFor.current = null;
        ctrl.abort();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConversationId]);

  return (
    <div className="flex h-full flex-1 overflow-hidden">
      {/* Center Chat Panel */}
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-white dark:bg-zinc-950">
        {/* Chat Header */}
        <ChatHeader />

        {/* Messages area */}
        <div
          ref={scrollRef}
          className="flex flex-1 flex-col overflow-y-auto"
          data-testid="message-list"
          onScroll={(e) => {
            const el = e.currentTarget;
            stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
          }}
        >
          <div className="mx-auto flex min-h-full w-full max-w-[1200px] flex-col gap-3 px-4 py-6">
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
              // Backend running rows stream too (recovery window before the
              // optimistic overlay with the same id arrives and replaces them).
              const backendRunning = !isOpt && (m as ChatMessage).status === "running";
              const isStreaming = (isOpt && (m as { isStreaming?: boolean }).isStreaming && streaming) || (backendRunning && streaming);
              return (
                <MessageView
                  key={m.id}
                  message={m}
                  isStreaming={isStreaming}
                  onRegenerate={
                    !isOpt && m.role === "assistant" && m.id === lastAssistantId && lastUser
                      ? () => send({ text: lastUser.content, reasoningLevel: null, attachments: [] }, activeConversationId)
                      : undefined
                  }
                />
              );
            })}
          </AnimatePresence>
          </div>
        </div>

        {/* Composer */}
        <div className="mx-auto w-full max-w-[1200px] px-4">
        <ChatComposer
          streaming={streaming}
          onSend={(t) => send(t, activeConversationId)}
          onStop={stop}
        />
        </div>
      </main>

      {/* Right Intelligence Panel */}
      <IntelligencePanel />
    </div>
  );
}
