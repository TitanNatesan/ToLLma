"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ChatInput } from "@/app/components/ChatInput";
import { ChatSettingsPanel } from "@/app/components/ChatSettingsPanel";
import { MessageView } from "@/app/components/MessageView";
import { Sidebar } from "@/app/components/Sidebar";
import { Button, Card, GhostButton } from "@/components/ui";
import { useConversation, useConversationMutations } from "@/hooks/useChat";
import { useModels, useProviders } from "@/hooks/useRegistry";
import { streamChat } from "@/services/api";
import { useChatStore } from "@/store/chat";
import type { ChatMessage } from "@/types";

export default function Home() {
  const { providerId, modelId, activeConversationId, streaming, setConversation, setStreaming } = useChatStore();
  const { data: conversation, error: convError } = useConversation(activeConversationId);
  const { data: providers, isLoading: providersLoading } = useProviders();
  const { data: allModels } = useModels();
  const mutations = useConversationMutations();
  const [streamingText, setStreamingText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);

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
          toast.error("Chat failed", { description: m });
          mutations.refresh(convId);
        },
      },
    );
  }

  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const ready = !!providerId && !!modelId;

  return (
    <div className="flex flex-1 overflow-hidden">
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-zinc-200 p-2 dark:border-zinc-800">
          <h1 className="px-2 text-sm font-semibold">Chat</h1>
          <Button variant="outline" size="sm" className="ml-auto" onClick={() => setPanelOpen((v) => !v)} aria-expanded={panelOpen} data-testid="settings-toggle">
            {panelOpen ? "Hide settings" : "Show settings"}
          </Button>
        </div>
        <div className="flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col">
            {providersLoading ? (
              <p className="m-auto text-sm text-zinc-500">Loading…</p>
            ) : (providers ?? []).length === 0 ? (
              <Card className="m-auto max-w-md text-center" data-testid="empty-no-providers">
                <h2 className="font-semibold">No providers yet</h2>
                <p className="mt-1 text-sm text-zinc-500">Add an AI provider to start chatting.</p>
                <Button asChild className="mt-3">
                  <Link href="/providers">Go to Providers</Link>
                </Button>
              </Card>
            ) : (allModels ?? []).length === 0 ? (
              <Card className="m-auto max-w-md text-center" data-testid="empty-no-models">
                <h2 className="font-semibold">No models yet</h2>
                <p className="mt-1 text-sm text-zinc-500">Discover models from a provider or add one manually.</p>
                <Button asChild className="mt-3">
                  <Link href="/providers">Set up models</Link>
                </Button>
              </Card>
            ) : (
              <>
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
                    <p className="m-auto text-sm text-zinc-500">Start a conversation — pick a provider and model on the right.</p>
                  )}
                  {error && <p className="text-sm text-red-600" data-testid="chat-error">{error} <button className="underline" onClick={() => lastUser && send(lastUser.content, activeConversationId)}>Retry</button></p>}
                </div>
                {messages.length > 0 && !streaming && lastUser && (
                  <div className="flex gap-2 px-4 pb-1">
                    <GhostButton
                      data-testid="regenerate-button"
                      onClick={() => send(lastUser.content, activeConversationId)}
                      disabled={!ready}
                    >
                      Regenerate
                    </GhostButton>
                  </div>
                )}
                <ChatInput
                  streaming={streaming}
                  disabled={!ready}
                  onSend={(t) => send(t, activeConversationId)}
                  onStop={() => abortRef.current?.abort()}
                />
              </>
            )}
          </div>
          {panelOpen && <ChatSettingsPanel />}
        </div>
      </main>
    </div>
  );
}
