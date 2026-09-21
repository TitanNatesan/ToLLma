"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { ChatComposer, type ChatSendPayload } from "@/app/components/chat/ChatComposer";
import { IntelligencePanel } from "@/app/components/ChatSettingsPanel";
import { MessageView } from "@/app/components/MessageView";
import { ChatHeader } from "@/app/components/ChatHeader";
import { useConversation } from "@/hooks/useChat";
import {
  cancelGeneration,
  getActiveGeneration,
  getGeneration,
  getGenerationByClientKey,
  streamChat,
  streamGeneration,
  type StreamCallbacks,
} from "@/services/api";
import { perfDelta, perfDone, perfSend, perfSnapshot } from "@/lib/perf";
import { useChatStore } from "@/store/chat";
import { useSettingsStore } from "@/store/settings";
import { SearchModal } from "@/components/ui/SearchModal";
import { ShareDialog } from "@/components/ui/ShareDialog";
import { useIntelligenceMutations } from "@/hooks/useIntelligence";
import {
  activateGeneration,
  createBranch,
  deleteMessage,
  editMessage,
  regenerateMessage,
} from "@/services/api";
import { toastApiError } from "@/lib/errors";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Sparkles } from "lucide-react";
import type { ActiveGeneration, ChatMessage, MessageStatus, SearchResult } from "@/types";

const PENDING_SEND_KEY = "tollma-pending-send";

function readPendingSend(): { key: string; ts: number } | null {
  try {
    const raw = sessionStorage.getItem(PENDING_SEND_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { key?: string; ts?: number };
    if (typeof parsed.key !== "string" || typeof parsed.ts !== "number") return null;
    return { key: parsed.key, ts: parsed.ts };
  } catch {
    return null;
  }
}

function clearPendingSend(): void {
  try {
    sessionStorage.removeItem(PENDING_SEND_KEY);
  } catch {
    // storage unavailable — idempotency degrades, nothing breaks
  }
}

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
    removeOptimistic,
    clearOptimistic,
    setActiveGeneration,
  } = useChatStore();

  const { data: conversation, error: convError } = useConversation(activeConversationId);
  const qc = useQueryClient();
  // Stable refresh (useConversationMutations returns a new object per render,
  // which would churn every callback/effect below — queryClient is stable).
  const refreshAll = useCallback((id: string | null) => {
    if (!id) return;
    void qc.invalidateQueries({ queryKey: ["conversation", id] });
    void qc.invalidateQueries({ queryKey: ["usage", id] });
    void qc.invalidateQueries({ queryKey: ["conversations"] });
  }, [qc]);
  const abortRef = useRef<AbortController | null>(null);

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

  // Follow-new-messages preference: AI Elements Conversation (stick-to-bottom)
  // when on, a plain scroll container when the user opted out.
  const autoScroll = useSettingsStore((s) => s.autoScroll);

  /** Terminal state for any watched stream: drop local overlays, reload truth. */
  const finishGeneration = useCallback((convId: string | null, status?: MessageStatus | null, error?: string | null) => {
    setStreaming(false);
    setActiveGeneration(null);
    clearOptimistic();
    clearPendingSend();
    refreshAll(convId);
    perfDone(status);
    if (status === "failed") {
      toast.error("Generation failed", { description: error ?? undefined });
    }
  }, [
    setStreaming,
    setActiveGeneration,
    clearOptimistic,
    refreshAll,
  ]);

  /** Callbacks shared by fresh sends and refresh-reattach subscriptions. */
  const streamCallbacks = useCallback((ctrl: AbortController): StreamCallbacks => ({
    signal: ctrl.signal,
    onMeta: (meta) => {
      // Adopted an already-terminal generation (same-key retry race):
      // nothing to watch, just reload truth.
      if (meta.status && meta.status !== "running" && meta.status !== "queued") {
        finishGeneration(meta.conversation_id, meta.status);
        return;
      }
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
      perfSnapshot(content.length);
      const mid = useChatStore.getState().activeGeneration?.messageId;
      if (mid) setOptimisticContent(mid, content);
    },
    onDelta: (d) => {
      perfDelta();
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
      clearPendingSend();
      perfDone("error");
      toast.error("Chat failed", { description: m });
      refreshAll(convId);
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
    refreshAll,
  ]);

  /**
   * Subscribe to a backend generation the UI doesn't own yet (refresh
   * recovery, conflict adoption, pending-key boot). Exactly one subscriber
   * per generation per tab: callers funnel through here and the recovery
   * effect's recoveredFor guard, so deltas can never double-apply.
   * Stable (all deps are stable), so effects can depend on it safely.
   */
  const attachToGeneration = useCallback((
    convId: string,
    active: ActiveGeneration,
    ctrl: AbortController,
    onSettled?: () => void,
  ) => {
    setConversation(convId);
    setStreaming(true);
    setActiveGeneration({ id: active.generation_id, messageId: active.message_id });
    addOptimistic({
      id: active.message_id,
      role: "assistant",
      content: active.current_content,
      isStreaming: true,
      created_at: new Date().toISOString(),
    });
    perfSend();
    const cbs = streamCallbacks(ctrl);
    const prevDone = cbs.onDone;
    const prevError = cbs.onError;
    void streamGeneration(active.generation_id, {
      ...cbs,
      onDone: (done) => {
        onSettled?.();
        prevDone(done);
      },
      onError: (m) => {
        onSettled?.();
        prevError(m);
      },
    }).catch(() => {});
  }, [
    setConversation,
    setStreaming,
    setActiveGeneration,
    addOptimistic,
    streamCallbacks,
  ]);

  const send = useCallback((payload: ChatSendPayload, conversationId: string | null) => {
    if (!providerId || !modelId) return;
    // Single-flight: the composer already guards, this kills programmatic
    // double-sends (double-clicked regenerate) before a second POST exists.
    if (useChatStore.getState().streaming) return;
    const text = payload.text;

    const ts = Date.now();
    const userMsgId = `opt-user-${ts}`;
    // Idempotency key: a lost response (refresh before meta) retries with the
    // same key and adopts the existing generation instead of duplicating.
    const clientKey = crypto.randomUUID();
    try {
      sessionStorage.setItem(PENDING_SEND_KEY, JSON.stringify({ key: clientKey, ts }));
    } catch {
      // storage unavailable — idempotency degrades, nothing breaks
    }

    // Optimistic user echo only — the assistant row is created by the backend
    // and arrives via stream meta (never invented client-side).
    addOptimistic({
      id: userMsgId,
      role: "user",
      content: text,
      created_at: new Date(ts).toISOString(),
    });

    setStreaming(true);
    perfSend();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const cbs = streamCallbacks(ctrl);
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
        client_key: clientKey,
      },
      {
        ...cbs,
        onConflict: () => {
          // Another generation owns this conversation: drop the unpersisted
          // echo and adopt the live generation — never reset, never duplicate.
          removeOptimistic(userMsgId);
          const convId = conversationId ?? useChatStore.getState().activeConversationId;
          void (async () => {
            const live = convId ? await getActiveGeneration(convId).catch(() => null) : null;
            if (live && (live.status === "running" || live.status === "queued") && convId) {
              const adoptCtrl = new AbortController();
              abortRef.current = adoptCtrl;
              attachToGeneration(convId, live, adoptCtrl);
            } else {
              setStreaming(false);
              setActiveGeneration(null);
              clearPendingSend();
              refreshAll(convId);
            }
          })();
        },
      },
    );
  }, [
    providerId,
    modelId,
    addOptimistic,
    removeOptimistic,
    setStreaming,
    streamCallbacks,
    attachToGeneration,
    setActiveGeneration,
    refreshAll,
  ]);

  const lastUser = [...persistedMessages].reverse().find((m) => m.role === "user");
  const lastAssistantId = [...persistedMessages].reverse().find((m) => m.role === "assistant")?.id;
  const ready = !!providerId && !!modelId;

  /** User stop: cancel the backend generation, then reload truth.
   *  Cancel is fired before the local abort so it reaches the provider even
   *  if anything below throws; the abort only drops this tab's subscription. */
  const stop = useCallback(() => {
    const gen = useChatStore.getState().activeGeneration;
    const cancelReq = gen ? cancelGeneration(gen.id).catch(() => null) : null;
    abortRef.current?.abort();
    setStreaming(false);
    const settle = () => {
      setActiveGeneration(null);
      clearOptimistic();
      refreshAll(useChatStore.getState().activeConversationId);
    };
    if (!gen) {
      settle();
      return;
    }
    void (async () => {
      await cancelReq;
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
    refreshAll,
  ]);

  // Global shortcut actions dispatched by useGlobalShortcuts (Alt+R / Alt+X).
  useEffect(() => {
    function regenerateShortcut() {
      if (useChatStore.getState().streaming || !lastUser || !lastAssistantId) return;
      send(
        { text: lastUser.content, reasoningLevel: null, attachments: [] },
        useChatStore.getState().activeConversationId,
      );
    }
    function stopShortcut() {
      if (useChatStore.getState().streaming) stop();
    }
    window.addEventListener("tollma:regenerate", regenerateShortcut);
    window.addEventListener("tollma:stop", stopShortcut);
    return () => {
      window.removeEventListener("tollma:regenerate", regenerateShortcut);
      window.removeEventListener("tollma:stop", stopShortcut);
    };
  }, [lastUser, lastAssistantId, send, stop]);

  // Refresh recovery (single-subscriber, single path):
  // - known conversation -> probe active-generation, reattach if running.
  // - unknown conversation + pending send key -> adopt the orphaned send
  //   by client key (refresh lost the response, not the generation).
  const recoveredFor = useRef<string | null>(null);
  const pendingChecked = useRef(false);
  useEffect(() => {
    if (useChatStore.getState().streaming) return;
    if (activeConversationId) {
      if (recoveredFor.current === activeConversationId) return;
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
        attachToGeneration(activeConversationId, active, ctrl, () => {
          settled = true;
        });
      })().catch(() => {});
      return () => {
        if (!settled) {
          recoveredFor.current = null;
          ctrl.abort();
        }
      };
    }
    // No conversation learned (refresh before meta): adopt by idempotency key.
    const pending = readPendingSend();
    if (!pending || pendingChecked.current) return;
    if (Date.now() - pending.ts > 10 * 60 * 1000) {
      clearPendingSend();
      pendingChecked.current = true;
      return;
    }
    pendingChecked.current = true;
    void (async () => {
      const found = await getGenerationByClientKey(pending.key).catch(() => null);
      if (!found) {
        clearPendingSend();
        return;
      }
      if (found.status === "running" || found.status === "queued") {
        const ctrl = new AbortController();
        abortRef.current = ctrl;
        recoveredFor.current = found.conversation_id;
        attachToGeneration(found.conversation_id, found, ctrl);
      } else {
        clearPendingSend();
        setConversation(found.conversation_id);
        refreshAll(found.conversation_id);
      }
    })().catch(() => {});
  }, [activeConversationId, attachToGeneration, refreshAll, setConversation]);

  const [searchOpen, setSearchOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const intelligence = useIntelligenceMutations(activeConversationId);
  const { edit: editMutation, regenerate: regenerateMutation, branch: branchMutation, activate: activateMutation } = intelligence;

  const attachRegeneration = useCallback(
    (conversationId: string, messageId: string, generationId: string) => {
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      attachToGeneration(
        conversationId,
        {
          generation_id: generationId,
          message_id: messageId,
          conversation_id: conversationId,
          status: "running",
          current_content: "",
          started_at: null,
        },
        ctrl,
      );
    },
    [attachToGeneration],
  );

  const handleEdit = useCallback(
    (messageId: string, content: string) => {
      const onSuccess = (result: Awaited<ReturnType<typeof editMessage>>) => {
        const conversationId = result.message.conversation_id ?? activeConversationId;
        if (result.regeneration_started && result.regenerating_message_id && conversationId) {
          attachRegeneration(conversationId, result.regenerating_message_id, result.regenerating_message_id);
        } else {
          refreshAll(conversationId);
        }
      };
      editMutation.mutate(
        { messageId, content },
        {
          onSuccess,
          onError: (error) =>
            toastApiError(error, {
              title: "Edit failed",
              onRetry: () => editMutation.mutate({ messageId, content }, { onSuccess }),
            }),
        },
      );
    },
    [activeConversationId, attachRegeneration, editMutation, refreshAll],
  );

  const handleRegenerate = useCallback(
    (messageId: string) => {
      const onSuccess = (started: Awaited<ReturnType<typeof regenerateMessage>>) => {
        attachRegeneration(started.conversation_id, started.message_id, started.generation_id);
      };
      regenerateMutation.mutate(messageId, {
        onSuccess,
        onError: (error) =>
          toastApiError(error, {
            title: "Regenerate failed",
            onRetry: () => regenerateMutation.mutate(messageId, { onSuccess }),
          }),
      });
    },
    [attachRegeneration, regenerateMutation],
  );

  const handleBranch = useCallback(
    (messageId: string) => {
      if (!activeConversationId) return;
      branchMutation.mutate(
        { conversationId: activeConversationId, messageId },
        {
          onSuccess: (branch) => {
            setConversation(branch.conversation_id);
            toast.success("Branch created", { description: branch.branch_name ?? undefined });
          },
          onError: (error) => toastApiError(error, { title: "Could not create branch" }),
        },
      );
    },
    [activeConversationId, branchMutation, setConversation],
  );

  const handleActivateGeneration = useCallback(
    (messageId: string, runId: string) => {
      activateMutation.mutate(
        { messageId, runId },
        {
          onSuccess: () => refreshAll(activeConversationId),
          onError: (error) => toastApiError(error, { title: "Could not switch response" }),
        },
      );
    },
    [activeConversationId, activateMutation, refreshAll],
  );

  const handleDeleteMessage = useCallback(
    (messageId: string) => {
      void deleteMessage(messageId)
        .then(() => refreshAll(activeConversationId))
        .catch((error) => toastApiError(error, { title: "Could not delete message" }));
    },
    [activeConversationId, refreshAll],
  );

  const handleSearchSelect = useCallback(
    (result: SearchResult) => {
      setConversation(result.conversation_id);
      setHighlightId(result.message_id);
    },
    [setConversation],
  );

  // Global search shortcut (Ctrl+Shift+F) reuses the registered command.
  useEffect(() => {
    const openSearch = () => setSearchOpen(true);
    window.addEventListener("tollma:focus-conversation-search", openSearch);
    return () => window.removeEventListener("tollma:focus-conversation-search", openSearch);
  }, []);

  // Scroll to + briefly highlight the message a search result points at.
  useEffect(() => {
    if (!highlightId) return;
    const element = document.getElementById(highlightId);
    if (!element) return;
    element.scrollIntoView({ behavior: "smooth", block: "center" });
    element.classList.add("ring-2", "ring-tollma-400", "rounded-2xl");
    const timer = setTimeout(() => {
      element.classList.remove("ring-2", "ring-tollma-400", "rounded-2xl");
      setHighlightId(null);
    }, 2400);
    return () => clearTimeout(timer);
  }, [highlightId, allMessages.length]);

  const messageList = (
    <>
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
          // Live state: the optimistic overlay (keyed by backend id) or a
          // persisted RUNNING row, while the store says we're streaming.
          const optStreaming = Boolean((m as { isStreaming?: boolean }).isStreaming);
          const backendRunning = !isOpt && (m as ChatMessage).status === "running";
          const isStreaming = streaming && (optStreaming || backendRunning);
          return (
            <MessageView
              key={m.id}
              message={m}
              isStreaming={isStreaming}
              onActivateGeneration={handleActivateGeneration}
              onBranch={!isOpt ? handleBranch : undefined}
              onDelete={!isOpt ? handleDeleteMessage : undefined}
              onEdit={!isOpt && m.role === "user" ? handleEdit : undefined}
              onRegenerate={!isOpt && m.role === "assistant" ? handleRegenerate : undefined}
              onShare={!isOpt && m.role === "assistant" ? () => setShareOpen(true) : undefined}
            />
          );
        })}
      </AnimatePresence>
    </>
  );

  return (
    <div className="flex h-full flex-1 overflow-hidden">
      {/* Center Chat Panel */}
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-white dark:bg-zinc-950">
        {/* Chat Header */}
        <ChatHeader />

        {/* Messages area — AI Elements Conversation (stick-to-bottom) */}
        <div className="relative flex min-h-0 flex-1 flex-col">
          {autoScroll ? (
            <Conversation scrollTestId="message-list">
              <ConversationContent className="mx-auto min-h-full w-full max-w-[1200px] px-4 py-6">
                {messageList}
              </ConversationContent>
              <ConversationScrollButton />
            </Conversation>
          ) : (
            <div className="flex flex-1 flex-col overflow-y-auto" data-testid="message-list">
              <div className="mx-auto flex min-h-full w-full max-w-[1200px] flex-col gap-3 px-4 py-6">
                {messageList}
              </div>
            </div>
          )}
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

      <SearchModal onOpenChange={setSearchOpen} onSelect={handleSearchSelect} open={searchOpen} />
      <ShareDialog conversationId={activeConversationId} onOpenChange={setShareOpen} open={shareOpen} />
    </div>
  );
}
