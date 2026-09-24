"use client";

import { ChatWorkspace } from "@/app/components/ChatWorkspace";

/**
 * `/` is the draft chat: no conversation row until the first message is sent.
 * The workspace mints the conversation and adopts `/c/{id}` on send.
 */
export default function Home() {
  return <ChatWorkspace conversationId={null} />;
}
