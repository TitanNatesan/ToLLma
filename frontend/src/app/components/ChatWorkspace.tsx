"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AnimatePresence } from "framer-motion";
import { Button, ErrorState, LoadingState, Logo } from "@/components/ui";
import { toast } from "@/lib/notify";
import { useQueryClient } from "@tanstack/react-query";
import { ChatComposer, type ChatSendPayload } from "@/app/components/chat/ChatComposer";
import { IntelligencePanel } from "@/app/components/ChatSettingsPanel";
import { MessageView } from "@/app/components/MessageView";
import { ChatHeader } from "@/app/components/ChatHeader";
import { deriveSources } from "@/app/components/chat/sources/Sources";
import { useConversation } from "@/hooks/useChat";
import { useProviders } from "@/hooks/useRegistry";
import { useChatKeys } from "@/hooks/useChatKeys";
import {
  ApiError,
  cancelGeneration,
  classifyChatKeyProblem,
  createConversation,
  getActiveGeneration,
  getConversation,
  getGeneration,
  getGenerationByClientKey,
  policyDenialCopy,
  streamChat,
  streamGeneration,
  type StreamCallbacks,
} from "@/services/api";
import { useChatKeyStore } from "@/app/components/chat/chatKeyStore";
import { perfDelta, perfDone, perfSend, perfSnapshot } from "@/lib/perf";
import { useChatStore } from "@/store/chat";
import { useSettingsStore } from "@/store/settings";
import { SearchModal } from "@/components/ui/SearchModal";
import { useIntelligenceMutations } from "@/hooks/useIntelligence";
import {
  activateGeneration,
  createBranch,
  editMessage,
  regenerateMessage,
  renameConversation,
} from "@/services/api";
import { toastApiError } from "@/lib/errors";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import type { ActiveGeneration, ChatMessage, Conversation as ConversationData, MessageStatus, SearchResult, StreamDone } from "@/types";

/** Sample prompts on the empty state: one click fills the composer via the
 *  draft store + the existing focus event — no new plumbing. */
const SAMPLE_PROMPTS = [
  "Explain quantum computing in simple terms",
  "Write a haiku about the ocean",
  "Draft a friendly follow-up email",
];

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

// Draft sends learn their conversation id from the stream meta. Persisting it
// lets a reload (which can beat the URL replace) still adopt `/c/{id}`.
const PENDING_CONVERSATION_KEY = "tollma-pending-conversation";

function readPendingConversation(): string | null {
  try {
    return sessionStorage.getItem(PENDING_CONVERSATION_KEY);
  } catch {
    return null;
  }
}

function setPendingConversation(id: string): void {
  try {
    sessionStorage.setItem(PENDING_CONVERSATION_KEY, id);
  } catch {
    // storage unavailable — the URL replace still runs in the live tab
  }
}

function clearPendingConversation(): void {
  try {
    sessionStorage.removeItem(PENDING_CONVERSATION_KEY);
  } catch {
    // ignore
  }
}

/** Route id the backend can't resolve: deleted/unknown (404) or malformed (422). */
function isNotFound(error: unknown): boolean {
  if (!error) return false;
  const status = (error as { status?: number }).status;
  return status === 404 || status === 422 || (error as Error).message?.includes(" 404 ") === true;
}

/**
 * Ownership of one in-flight generation. Captured at submission so every
 * chunk routes to the originating conversation/generation — never to
 * whatever conversation is currently selected. `routeAtSend` is the route
 * the tab showed when the send started; store adoption only happens when the
 * tab hasn't moved on since.
 */
interface StreamOwner {
  convId: string | null;
  msgId: string | null;
  genId: string | null;
  routeAtSend: string | null;
}

function ownerFor(target: string | null, routeAtSend: string | null): StreamOwner {
  return { convId: target, msgId: null, genId: null, routeAtSend };
}

/**
 * Chat workspace bound to a route conversation. The URL owns identity: the
 * store is synced from `conversationId` (so header/panel/composer hooks stay
 * aligned), and every action that switches conversations navigates to
 * `/c/{id}` instead of only mutating the store.
 */
export function ChatWorkspace({ conversationId }: { conversationId: string | null }) {
  const router = useRouter();
  const {
    providerId,
    modelId,
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

  const {
    data: conversation,
    error: convError,
    isLoading: convLoading,
    refetch: refetchConversation,
  } = useConversation(conversationId);
  // A 404 on the route id falls back to the empty state (store id null) at the
  // same URL — no redirect, so a bad id can never loop through `/`.
  const notFound = isNotFound(convError);
  const activeId = notFound ? null : conversationId;
  // Non-404 fetch failure: error panel with retry instead of the empty state.
  const convFailed = !!conversationId && !!convError && !notFound;
  const routeIdRef = useRef(conversationId);
  useEffect(() => {
    routeIdRef.current = conversationId;
    // A real conversation route owns the draft send: the recovery key is only
    // needed while the URL still points at the draft.
    if (conversationId) clearPendingConversation();
  }, [conversationId]);

  // URL is authoritative on load and on every param change.
  useEffect(() => {
    setConversation(activeId);
  }, [activeId, setConversation]);

  const qc = useQueryClient();
  // Stable refresh (useConversationMutations returns a new object per render,
  // which would churn every callback/effect below — queryClient is stable).
  const refreshAll = useCallback((id: string | null) => {
    if (!id) return;
    void qc.invalidateQueries({ queryKey: ["conversation", id] });
    void qc.invalidateQueries({ queryKey: ["usage", id] });
    void qc.invalidateQueries({ queryKey: ["conversations"] });
    // Spend/eligibility changed with the generation: refresh key availability
    // too (same pattern — the composer's keyProblem effect also refreshes on
    // denial, so both paths converge without switching keys).
    void qc.invalidateQueries({ queryKey: ["chat-keys"] });
  }, [qc]);
  const abortRef = useRef<AbortController | null>(null);
  // Draft-send probe: adopts the conversation id by idempotency key when the
  // meta event is missed. Cleared whenever the send settles.
  const probeTimerRef = useRef<number | null>(null);
  const stopDraftProbe = useCallback(() => {
    if (probeTimerRef.current !== null) {
      window.clearInterval(probeTimerRef.current);
      probeTimerRef.current = null;
    }
  }, []);

  const persistedMessages: ChatMessage[] = useMemo(
    () => conversation?.messages ?? [],
    [conversation?.messages],
  );
  // Optimistic entries carry backend-issued ids: they overlay (never
  // duplicate) the persisted rows. History itself always comes from the
  // backend. While the overlay is still streaming it wins; once it settles
  // the persisted row (server truth) wins. Either way each id renders
  // exactly once — no duplicate-key crash on refresh-recovery double-invoke.
  const allMessages = useMemo(() => {
    const winner = new Map<string, ChatMessage>();
    for (const m of persistedMessages) winner.set(m.id, m);
    for (const m of optimisticMessages) {
      if (!winner.has(m.id) || m.isStreaming) winner.set(m.id, m as ChatMessage);
    }
    const emitted = new Set<string>();
    const ordered: ChatMessage[] = [];
    for (const m of persistedMessages) {
      const w = winner.get(m.id);
      if (w && !emitted.has(m.id)) {
        emitted.add(m.id);
        ordered.push(w);
      }
    }
    for (const m of optimisticMessages) {
      if (!emitted.has(m.id)) {
        emitted.add(m.id);
        ordered.push(winner.get(m.id) as ChatMessage);
      }
    }
    return ordered;
  }, [persistedMessages, optimisticMessages]);
  // Reply sources derived from the turn's attachments (stable identities so
  // MessageView memoization survives streaming re-renders).
  const sourcesByMessage = useMemo(() => deriveSources(allMessages), [allMessages]);

  // Follow-new-messages preference: AI Elements Conversation (stick-to-bottom)
  // when on, a plain scroll container when the user opted out.
  const autoScroll = useSettingsStore((s) => s.autoScroll);

  /**
   * Merge the done-envelope into the cached conversation so generated media
   * appears immediately. The message may be absent from cache (draft sends
   * never fetched it) — then this is a no-op and the refetch below provides
   * it. The refetch always overwrites with server truth, so a stale merge can
   * never win over persistence.
   */
  const mergeDoneIntoCache = useCallback((convId: string | null, done: StreamDone) => {
    if (!convId || !done.message_id) return;
    // Assistant attachments are append-only: an empty envelope list carries
    // no information, so only a non-empty list merges (never clobbers).
    const attachments = (done.attachments?.length ?? 0) > 0 ? done.attachments : undefined;
    if (attachments === undefined && done.content === undefined && done.status === undefined) return;
    qc.setQueryData<ConversationData>(["conversation", convId], (cached) => {
      if (!cached) return cached;
      const idx = cached.messages.findIndex((m) => m.id === done.message_id);
      if (idx === -1) return cached;
      const prev = cached.messages[idx];
      const next: ChatMessage = {
        ...prev,
        ...(done.content !== undefined ? { content: done.content } : null),
        ...(done.status !== undefined ? { status: done.status } : null),
        ...(attachments !== undefined ? { attachments } : null),
      };
      if (next.content === prev.content && next.status === prev.status && next.attachments === prev.attachments) {
        return cached;
      }
      const messages = [...cached.messages];
      messages[idx] = next;
      return { ...cached, messages };
    });
  }, [qc]);

  /** Terminal state for any watched stream: drop local overlays, reload truth. */
  const finishGeneration = useCallback((convId: string | null, status?: MessageStatus | null, error?: string | null) => {
    setStreaming(false);
    setActiveGeneration(null);
    clearOptimistic();
    clearPendingSend();
    clearPendingConversation();
    refreshAll(convId);
    perfDone(status);
    if (status === "failed") {
      toast.error("Generation failed", { description: error ?? undefined, contrast: true });
    }
  }, [
    setStreaming,
    setActiveGeneration,
    clearOptimistic,
    refreshAll,
  ]);

  /** Callbacks shared by fresh sends and refresh-reattach subscriptions.
   *  Every chunk routes by the captured owner — never by the currently
   *  selected conversation, so navigating mid-stream can't misroute deltas
   *  into the wrong chat. Navigating away never aborts: only an explicit
   *  cancel (stop) drops the subscription. */
  const streamCallbacks = useCallback((ctrl: AbortController, owner: StreamOwner): StreamCallbacks => ({
    signal: ctrl.signal,
    onMeta: (meta) => {
      // Adopted an already-terminal generation (same-key retry race):
      // nothing to watch, just reload truth.
      if (meta.status && meta.status !== "running" && meta.status !== "queued") {
        finishGeneration(meta.conversation_id, meta.status);
        return;
      }
      owner.convId = meta.conversation_id;
      owner.genId = meta.generation_id ?? owner.genId;
      owner.msgId = meta.message_id ?? meta.generation_id ?? owner.msgId;
      // The tab moved on (or a draft send raced a navigation): record the
      // ids for routing, but don't yank the store back to this conversation.
      if (routeIdRef.current !== owner.routeAtSend) return;
      setConversation(meta.conversation_id);
      setPendingConversation(meta.conversation_id);
      const genId = owner.genId;
      const msgId = owner.msgId;
      if (genId && msgId && !useChatStore.getState().optimisticMessages.some((m) => m.id === msgId)) {
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
      const mid = owner.msgId ?? useChatStore.getState().activeGeneration?.messageId;
      if (mid) setOptimisticContent(mid, content);
    },
    onDelta: (d) => {
      perfDelta();
      const mid = owner.msgId ?? useChatStore.getState().activeGeneration?.messageId;
      if (mid) updateOptimisticStreaming(mid, d);
    },
    onDone: (done) => {
      // Late/duplicate terminal for a conversation this send doesn't own:
      // ignore (the owning tab/owner already settled it).
      const runtimeConv = (done as unknown as { conversation_id?: string }).conversation_id;
      if (owner.convId && runtimeConv && runtimeConv !== owner.convId) return;
      // Inline attachments land in the live message immediately (no reload);
      // the refetch inside finishGeneration then confirms server truth. The
      // merge and the overlay clear batch in one tick, so the text-only
      // optimistic row can never render over the merged persisted row.
      const convId = runtimeConv ?? owner.convId ?? useChatStore.getState().activeConversationId;
      mergeDoneIntoCache(convId, done);
      finishGeneration(convId, done.status, done.error);
      // Finished while looking at another conversation: toast with a jump
      // action. Suppressed when already viewing it (normal flow needs no
      // noise) — done carries no secret, only the conversation id.
      // NOTE: compare against the live global store, not routeIdRef: this
      // closure may belong to an instance unmounted by navigation, whose
      // ref is frozen at the send-time route and would wrongly suppress.
      const viewing = useChatStore.getState().activeConversationId;
      if (convId && viewing !== convId) {
        toast.success("Response ready", {
          description: "The generation finished in another conversation.",
          action: { label: "Open conversation", onClick: () => router.push(`/c/${convId}`) },
          contrast: true,
        });
      }
    },
    onError: (m) => {
      const convId = owner.convId ?? useChatStore.getState().activeConversationId;
      setStreaming(false);
      setActiveGeneration(null);
      clearOptimistic();
      clearPendingSend();
      perfDone("error");
      toast.error("Chat failed", { description: m, contrast: true });
      refreshAll(convId);
    },
  }), [
    setConversation,
    setActiveGeneration,
    addOptimistic,
    setOptimisticContent,
    updateOptimisticStreaming,
    mergeDoneIntoCache,
    finishGeneration,
    setStreaming,
    clearOptimistic,
    refreshAll,
    router,
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
    // Idempotent: refresh recovery can double-invoke (effect re-run races
    // the first subscribe). The live overlay already exists — subscribing
    // again would double-apply deltas and duplicate the React key.
    if (useChatStore.getState().optimisticMessages.some((m) => m.id === active.message_id)) return;
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
    const owner = ownerFor(convId, routeIdRef.current);
    owner.msgId = active.message_id;
    owner.genId = active.generation_id;
    const cbs = streamCallbacks(ctrl, owner);
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

  const startSend = useCallback((payload: ChatSendPayload, targetConversationId: string | null) => {
    if (!providerId || !modelId) return;
    // Single-flight: the composer already guards, this kills programmatic
    // double-sends (double-clicked regenerate) before a second POST exists.
    if (useChatStore.getState().streaming) return;
    // The caller owns draft semantics (the `send` wrapper mints the
    // conversation first). Re-deriving "draft" here from the URL raced the
    // router commit and could create a second conversation.
    const target = targetConversationId;
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

    // Eagerly created conversations start as "New conversation" and the
    // backend only auto-titles conversations it creates itself — mirror its
    // first-message title here so the sidebar shows the same snippet.
    // (Cache-first; one lookup when the conversation isn't loaded yet.)
    void (async () => {
      if (!target) return;
      const cached = qc.getQueryData<{ title?: string }>(["conversation", target]);
      const title = cached?.title ?? (await getConversation(target).catch(() => null))?.title;
      if (title !== "New conversation") return;
      const autoTitle = (
        text.slice(0, 60) ||
        (payload.attachments[0] ? `Attachment: ${payload.attachments[0].name}` : "")
      ).slice(0, 60);
      if (!autoTitle) return;
      await renameConversation(target, autoTitle).catch(() => null);
      void qc.invalidateQueries({ queryKey: ["conversations"] });
    })();

    setStreaming(true);
    perfSend();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    // Sending from an unknown route id: the backend creates the conversation
    // and reports it in meta — adopt it in the URL (unless the user moved on).
    const routeAtSend = routeIdRef.current;
    if (!target) {
      // Draft sends must not depend on catching the meta event: probe the
      // idempotency key briefly and adopt the conversation as soon as it
      // exists. The probe stops when this send settles and never persists a
      // key after the route moved on (a stale key would hijack the next
      // New Chat).
      stopDraftProbe();
      let tries = 0;
      probeTimerRef.current = window.setInterval(() => {
        tries += 1;
        void getGenerationByClientKey(clientKey)
          .then((found) => {
            if (!found?.conversation_id) return;
            stopDraftProbe();
            if (routeIdRef.current !== routeAtSend) return;
            setPendingConversation(found.conversation_id);
            router.replace(`/c/${found.conversation_id}`);
          })
          .catch(() => null);
        if (tries >= 12) stopDraftProbe();
      }, 700);
    }
    const owner = ownerFor(target, routeAtSend);
    const cbs = streamCallbacks(ctrl, owner);
    void streamChat(
      {
        provider_id: providerId,
        model_id: modelId,
        conversation_id: target,
        message: text,
        reasoning_level: payload.reasoningLevel,
        attachment_ids: payload.attachments
          .map((a) => a.attachmentId)
          .filter((id): id is string => !!id),
        client_key: clientKey,
      },
      {
        ...cbs,
        onMeta: (meta) => {
          cbs.onMeta?.(meta);
          if (
            !target &&
            meta.conversation_id &&
            routeIdRef.current === routeAtSend
          ) {
            router.replace(`/c/${meta.conversation_id}`);
          }
        },
        onConflict: () => {
          // Another generation owns this conversation: drop the unpersisted
          // echo and adopt the live generation — never reset, never duplicate.
          removeOptimistic(userMsgId);
          const convId = target ?? useChatStore.getState().activeConversationId;
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
        onError: (m) => {
          // Base handler clears overlays and toasts the (already friendly)
          // message. Policy denial flagged by the api layer means the backend
          // created no rows, so the unpersisted echo is gone — restore it to
          // the draft so nothing is lost and history is preserved. Key/model
          // selection is untouched: no fallback key, no personal<->org switch.
          cbs.onError(m);
          if (useChatKeyStore.getState().problem) {
            useChatStore.getState().setDraft(text);
          }
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
    router,
    qc,
    stopDraftProbe,
  ]);

  /**
   * Send entry point. The first message of a draft mints the conversation
   * before streaming, so the URL adopts deterministically and the sidebar
   * shows the chat immediately — no dependency on the stream meta event or
   * the idempotency-key probe.
   */
  const send = useCallback(
    (payload: ChatSendPayload, targetConversationId: string | null) => {
      // Draft = the URL says so OR the store was cleared synchronously by
      // New chat (a send can land before the router commits the new URL).
      const onDraftRoute =
        window.location.pathname === "/" ||
        useChatStore.getState().activeConversationId === null;
      const target = onDraftRoute ? null : targetConversationId;
      if (target) {
        startSend(payload, target);
        return;
      }
      if (!providerId || !modelId) return;
      if (useChatStore.getState().streaming) return;
      const title = payload.text.slice(0, 60) || "New conversation";
      void (async () => {
        try {
          const conv = await createConversation({
            title,
            provider_id: providerId,
            model_id: modelId,
          });
          setConversation(conv.id);
          router.replace(`/c/${conv.id}`);
          startSend(payload, conv.id);
        } catch (error) {
          toastApiError(error, { title: "Could not start chat" });
        }
      })();
    },
    [providerId, modelId, startSend, setConversation, router],
  );

  const lastUser = [...persistedMessages].reverse().find((m) => m.role === "user");
  // Image continuity: only the conversation's LAST assistant message counts.
  // If it carries a generated image/video, the composer shows an informational
  // chip (backend auto-resolves the edit reference — no payload change).
  const continuityKind = useMemo<"image" | "video" | null>(() => {
    for (let i = persistedMessages.length - 1; i >= 0; i--) {
      const m = persistedMessages[i];
      if (m.role !== "assistant") continue;
      const kinds = (m.attachments ?? []).map((a) => a.kind);
      if (kinds.includes("video")) return "video";
      if (kinds.includes("image")) return "image";
      return null;
    }
    return null;
  }, [persistedMessages]);
  const lastAssistantId = [...persistedMessages].reverse().find((m) => m.role === "assistant")?.id;

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
    // Draft route with a known pending conversation (send raced the reload):
    // jump to its permanent URL; the route recovery below then reattaches.
    if (!activeId) {
      const pendingConversation = readPendingConversation();
      if (pendingConversation) {
        clearPendingConversation();
        clearPendingSend();
        router.replace(`/c/${pendingConversation}`);
        return;
      }
    }
    if (activeId) {
      if (recoveredFor.current === activeId) return;
      recoveredFor.current = activeId;
      let settled = false;
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      void (async () => {
        let active = null;
        try {
          active = await getActiveGeneration(activeId);
        } catch {
          active = null;
        }
        if (!active || (active.status !== "running" && active.status !== "queued")) {
          recoveredFor.current = null;
          return;
        }
        attachToGeneration(activeId, active, ctrl, () => {
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
    const routeAtProbe = routeIdRef.current;
    void (async () => {
      const found = await getGenerationByClientKey(pending.key).catch(() => null);
      if (!found) {
        clearPendingSend();
        return;
      }
      // The user moved to another conversation while we probed: stay put.
      if (routeIdRef.current === routeAtProbe) {
        router.replace(`/c/${found.conversation_id}`);
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
  }, [activeId, attachToGeneration, refreshAll, setConversation, router]);

  const [searchOpen, setSearchOpen] = useState(false);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const { data: providers = [], isPending: providersPending } = useProviders();
  const { data: chatKeys = [], isPending: keysPending } = useChatKeys();
  const statusLoaded = !providersPending && !keysPending;
  const intelligence = useIntelligenceMutations(activeId);
  const { edit: editMutation, regenerate: regenerateMutation, branch: branchMutation, activate: activateMutation } = intelligence;

  /**
   * Unified policy denials (403/429 with reason strings) on edit/regenerate:
   * friendly copy + key-list refresh via the composer's keyProblem effect —
   * never an assistant success, never a key fallback or scope switch. The
   * conversation stays intact; the user corrects the policy (Manage API keys
   * when the fix lives in the key console). Returns true when handled.
   */
  const handlePolicyDenial = useCallback(
    (error: unknown): boolean => {
      const status =
        error instanceof ApiError ? error.status : ((error as { status?: number } | null)?.status ?? 0);
      const data = error instanceof ApiError ? error.data : null;
      const text = error instanceof Error ? error.message : "";
      const problem = classifyChatKeyProblem(status, data ?? text);
      if (!problem) return false;
      useChatKeyStore.getState().flagProblem(problem);
      const copy = policyDenialCopy(
        problem,
        error instanceof ApiError ? error.retryAfterSeconds : null,
      );
      toast.error(copy.title, {
        description: copy.description,
        action: copy.manageKeys
          ? { label: "Manage API keys", onClick: () => router.push("/api-keys") }
          : undefined,
      });
      return true;
    },
    [router],
  );

  const attachRegeneration = useCallback(
    (convId: string, messageId: string, generationId: string) => {
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      attachToGeneration(
        convId,
        {
          generation_id: generationId,
          message_id: messageId,
          conversation_id: convId,
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
      // Message actions are disabled while a generation streams (the
      // workspace also stops passing these handlers when streaming).
      if (useChatStore.getState().streaming) return;
      const onSuccess = (result: Awaited<ReturnType<typeof editMessage>>) => {
        const convId = result.message.conversation_id ?? activeId;
        if (result.regeneration_started && result.regenerating_message_id && convId) {
          attachRegeneration(convId, result.regenerating_message_id, result.regenerating_message_id);
        } else {
          refreshAll(convId);
        }
      };
      editMutation.mutate(
        { messageId, content },
        {
          onSuccess,
          onError: (error) => {
            if (handlePolicyDenial(error)) return;
            toastApiError(error, {
              title: "Edit failed",
              onRetry: () => editMutation.mutate({ messageId, content }, { onSuccess }),
            });
          },
        },
      );
    },
    [activeId, attachRegeneration, editMutation, refreshAll, handlePolicyDenial],
  );

  const handleRegenerate = useCallback(
    (messageId: string) => {
      if (useChatStore.getState().streaming) return;
      const onSuccess = (started: Awaited<ReturnType<typeof regenerateMessage>>) => {
        attachRegeneration(started.conversation_id, started.message_id, started.generation_id);
      };
      regenerateMutation.mutate(messageId, {
        onSuccess,
        onError: (error) => {
          if (handlePolicyDenial(error)) return;
          toastApiError(error, {
            title: "Regenerate failed",
            onRetry: () => regenerateMutation.mutate(messageId, { onSuccess }),
          });
        },
      });
    },
    [attachRegeneration, regenerateMutation, handlePolicyDenial],
  );

  const handleBranch = useCallback(
    (messageId: string) => {
      if (!activeId || useChatStore.getState().streaming) return;
      branchMutation.mutate(
        { conversationId: activeId, messageId },
        {
          onSuccess: (branch) => {
            router.push(`/c/${branch.conversation_id}`);
            toast.success("Branch created", { description: branch.branch_name ?? undefined });
          },
          onError: (error) => toastApiError(error, { title: "Could not create branch" }),
        },
      );
    },
    [activeId, branchMutation, router],
  );

  const handleActivateGeneration = useCallback(
    (messageId: string, runId: string) => {
      activateMutation.mutate(
        { messageId, runId },
        {
          onSuccess: () => refreshAll(activeId),
          onError: (error) => toastApiError(error, { title: "Could not switch response" }),
        },
      );
    },
    [activeId, activateMutation, refreshAll],
  );

  const handleSearchSelect = useCallback(
    (result: SearchResult) => {
      setHighlightId(result.message_id);
      router.push(`/c/${result.conversation_id}`);
    },
    [router],
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
      {conversationId && convLoading && allMessages.length === 0 && !streaming && (
        <div className="m-auto w-full max-w-md" data-testid="conversation-loading">
          <LoadingState message="Loading conversation…" />
        </div>
      )}

      {convFailed && allMessages.length === 0 && !streaming && (
        <div className="m-auto w-full max-w-md" data-testid="conversation-error">
          <ErrorState
            title="Could not load conversation"
            message={convError instanceof Error ? convError.message : undefined}
            onRetry={() => void refetchConversation()}
          />
        </div>
      )}

      {allMessages.length === 0 && !streaming && !convLoading && !convFailed && (
        <div
          className="m-auto flex w-full max-w-md flex-col items-center gap-3 px-4 py-8 text-center"
          data-testid="empty-state"
        >
          <Logo size="lg" hideText />
          <h1 className="text-xl font-semibold text-zinc-800 dark:text-zinc-200">
            Start a conversation
          </h1>
          {statusLoaded && providers.length === 0 ? (
            <>
              <p className="text-sm text-zinc-500">
                Connect a provider to register your first model, then start chatting.
              </p>
              <Button asChild data-testid="empty-state-cta">
                <Link href="/providers">Set up a provider</Link>
              </Button>
            </>
          ) : statusLoaded && chatKeys.length === 0 ? (
            <>
              <p className="text-sm text-zinc-500">
                Your provider is ready — create an API key to start chatting.
              </p>
              <Button asChild data-testid="empty-state-cta">
                <Link href="/api-keys">Create an API key</Link>
              </Button>
            </>
          ) : (
            <>
              <p className="text-sm text-zinc-500">
                Pick a model in the composer below, then ask anything — or try one of these.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-2">
                {SAMPLE_PROMPTS.map((prompt, i) => (
                  <button
                    key={prompt}
                    type="button"
                    data-testid={`sample-prompt-${i}`}
                    onClick={() => {
                      useChatStore.getState().setDraft(prompt);
                      window.dispatchEvent(new Event("tollma:focus-input"));
                    }}
                    className="max-w-full truncate rounded-full border border-zinc-200 px-3 py-1 text-xs text-zinc-600 transition-colors hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-600 dark:hover:bg-zinc-800"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </>
          )}
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
              sources={sourcesByMessage.get(m.id)}
              onActivateGeneration={handleActivateGeneration}
              // Editing, regenerating, or branching mid-stream would race the
              // live generation: hide the actions until it settles.
              onBranch={!isOpt && !streaming ? handleBranch : undefined}
              onEdit={!isOpt && m.role === "user" && !streaming ? handleEdit : undefined}
              onRegenerate={!isOpt && m.role === "assistant" && !streaming ? handleRegenerate : undefined}
            />
          );
        })}
      </AnimatePresence>
    </>
  );

  return (
    <div className="flex h-full flex-1 overflow-hidden">
      {/* Center Chat Panel */}
      <main id="main-content" tabIndex={-1} className="flex min-w-0 flex-1 flex-col overflow-hidden bg-white dark:bg-zinc-950">
        {/* Chat Header */}
        <ChatHeader />

        {/* Messages area — AI Elements Conversation (stick-to-bottom) */}
        <div className="relative flex min-h-0 flex-1 flex-col">
          {autoScroll ? (
            <Conversation scrollTestId="message-list">
              <ConversationContent className="mx-auto min-h-full w-full max-w-[960px] px-4 py-6">
                {messageList}
              </ConversationContent>
              <ConversationScrollButton />
            </Conversation>
          ) : (
            <div className="flex flex-1 flex-col overflow-y-auto" data-testid="message-list">
              <div className="mx-auto flex min-h-full w-full max-w-[960px] flex-col gap-4 px-4 py-6">
                {messageList}
              </div>
            </div>
          )}
        </div>

        {/* Composer */}
        <div className="mx-auto w-full max-w-[960px] px-4">
        <ChatComposer
          streaming={streaming}
          continuityKind={continuityKind}
          onSend={(t) => send(t, routeIdRef.current ?? activeId)}
          onStop={stop}
        />
        </div>
      </main>

      {/* Right Intelligence Panel */}
      <IntelligencePanel />

      <SearchModal onOpenChange={setSearchOpen} onSelect={handleSearchSelect} open={searchOpen} />
    </div>
  );
}
