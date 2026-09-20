"use client";

import { memo } from "react";
import { ArrowDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ScrollToBottomProps {
  visible: boolean;
  onClick: () => void;
  className?: string;
}

/**
 * AI SDK Elements Conversation Scroll-to-Bottom Button.
 *
 * Floating affordance that appears when user scrolls away from latest message.
 */
function ScrollToBottomInner({ visible, onClick, className }: ScrollToBottomProps) {
  if (!visible) return null;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Scroll to latest message"
      data-testid="scroll-to-bottom"
      className={cn(
        "absolute bottom-3 left-1/2 z-10 flex size-8 -translate-x-1/2 items-center justify-center rounded-full",
        "border border-zinc-200 bg-white text-zinc-500 shadow-md transition-all",
        "hover:bg-zinc-50 hover:text-zinc-700 active:scale-95",
        "dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200",
        "animate-in fade-in-0 zoom-in-90 duration-150",
        className,
      )}
    >
      <ArrowDown className="size-4" />
    </button>
  );
}

export const ScrollToBottom = memo(ScrollToBottomInner);
