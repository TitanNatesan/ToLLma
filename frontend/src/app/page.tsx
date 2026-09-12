"use client";

import { useEffect, useRef, useState } from "react";
import { ChatInput } from "@/app/components/ChatInput";
import { MessageView } from "@/app/components/MessageView";
import { SelectorBar } from "@/app/components/SelectorBar";
import { Sidebar } from "@/app/components/Sidebar";
import { GhostButton } from "@/components/ui";
import { useConversation, useConversationMutations } from "@/hooks/useChat";
import { streamChat } from "@/services/api";
import { useChatStore } from "@/store/chat";
import type { ChatMessage } from "@/types";

export default function Home() {
  const { providerId, modelId, activeConversationId, streaming, setConversation, setStreaming } = useChatStore();
  const { data: conversation, error: convError } = useConversation(activeConversationId);
  const mutations = useConversationMutations();
  const [streamingText, setStreamingText] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!convError) return;
    const status = (convError as { status?: number })?.status;
    if (status === 404 || convError.message?.includes(" 404 ")) {
      setConversation(null);
    }
  }, [convError, setConversation]);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  const messages: ChatMessage[] = conversation?.messages ?? [];

  useEffect(() => {
    if (stickRef.current) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages.length, streamingText]);

  function send(text: string, conversationId: string | null) {
    if (!providerId || !modelId) return;
    setError(null);
    setStreamingText("");
    setStreaming(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    let convId = conversationId;
    let acc = "";
    void streamChat(
      { provider_id: providerId, model_id: modelId, conversation_id: conversationId, message: text },
      {
        signal: ctrl.signal,
        onMeta: (id) => {
          convId = id;
          setConversation(id);
        },
        onDelta: (d) => {
          acc += d;
          setStreamingText(acc);
        },
        onDone: () => {
          setStreaming(false);
          setStreamingText("");
          mutations.refresh(convId);
        },
        onError: (m) => {
          setStreaming(false);
          setError(m);
          mutations.refresh(convId);
        },
      },
    );
  }

  const lastUser = [...messages].reverse().find((m) => m.role === "user");

  return (
    <div className="flex flex-1 overflow-hidden">
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col">
        <SelectorBar />
        <div
          ref={scrollRef}
          className="flex flex-1 flex-col gap-3 overflow-y-auto p-4"
          data-testid="message-list"
          onScroll={(e) => {
            const el = e.currentTarget;
            stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
          }}
        >
          {messages.map((m) => (
            <MessageView key={m.id} message={m} />
          ))}
          {streamingText && (
            <MessageView
              message={{
                id: "streaming",
                role: "assistant",
                content: streamingText,
                provider_id: null,
                model_id: null,
                prompt_tokens: null,
                completion_tokens: null,
                total_tokens: null,
                input_cost: null,
                output_cost: null,
                total_cost: null,
                created_at: new Date().toISOString(),
              }}
            />
          )}
          {!messages.length && !streamingText && (
            <p className="m-auto text-sm text-zinc-500">Start a conversation — select a provider and model above.</p>
          )}
          {error && <p className="text-sm text-red-600" data-testid="chat-error">{error} <button className="underline" onClick={() => lastUser && send(lastUser.content, activeConversationId)}>Retry</button></p>}
        </div>
        {messages.length > 0 && !streaming && lastUser && (
          <div className="flex gap-2 px-4 pb-1">
            <GhostButton
              data-testid="regenerate-button"
              onClick={() => send(lastUser.content, activeConversationId)}
              disabled={!providerId || !modelId}
            >
              Regenerate
            </GhostButton>
          </div>
        )}
        <ChatInput
          streaming={streaming}
          disabled={!providerId || !modelId}
          onSend={(t) => send(t, activeConversationId)}
          onStop={() => abortRef.current?.abort()}
        />
      </main>
    </div>
  );
}
