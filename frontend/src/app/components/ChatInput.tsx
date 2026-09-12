"use client";

import { useState } from "react";
import { Button, GhostButton, Textarea } from "@/components/ui";

interface ChatInputProps {
  streaming: boolean;
  disabled: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
}

export function ChatInput({ streaming, disabled, onSend, onStop }: ChatInputProps) {
  const [text, setText] = useState("");
  return (
    <form
      className="flex gap-2 border-t border-zinc-200 p-3 dark:border-zinc-800"
      onSubmit={(e) => {
        e.preventDefault();
        if (!text.trim() || streaming || disabled) return;
        onSend(text.trim());
        setText("");
      }}
    >
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={disabled ? "Select a provider and model first" : "Type a message… (Enter to send)"}
        rows={2}
        aria-label="Chat input"
        data-testid="chat-input"
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            (e.target as HTMLTextAreaElement).form?.requestSubmit();
          }
        }}
      />
      {streaming ? (
        <GhostButton type="button" onClick={onStop} data-testid="stop-button">
          Stop
        </GhostButton>
      ) : (
        <Button type="submit" disabled={disabled || !text.trim()} data-testid="send-button">
          Send
        </Button>
      )}
    </form>
  );
}
