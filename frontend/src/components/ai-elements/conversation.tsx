"use client";

import { ArrowDownIcon, DownloadIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
} from "react";
import {
  StickToBottom,
  useStickToBottomContext,
  type StickToBottomContext,
} from "use-stick-to-bottom";
import { Button } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

export type ConversationProps = ComponentProps<typeof StickToBottom> & {
  /** Forwarded to the element that actually scrolls (StickToBottom.scrollRef). */
  scrollTestId?: string;
};

/**
 * AI Elements Conversation. StickToBottom owns the scrollable element
 * (`scrollRef`), so `scrollTestId` is forwarded there to keep the ToLLma test
 * contract on the element that actually scrolls.
 */
export const Conversation = ({
  className,
  scrollTestId,
  children,
  ...props
}: ConversationProps) => {
  const contextRef = useRef<StickToBottomContext>(null);

  useEffect(() => {
    const scroller = contextRef.current?.scrollRef.current;
    if (scroller && scrollTestId) {
      scroller.setAttribute("data-testid", scrollTestId);
    }
  });

  const anchored =
    typeof children === "function"
      ? (context: StickToBottomContext) => (
          <>
            <ResizeAnchor />
            {children(context)}
          </>
        )
      : (
          <>
            <ResizeAnchor />
            {children}
          </>
        );

  return (
    <StickToBottom
      className={cn("relative flex-1 overflow-y-hidden", className)}
      contextRef={contextRef}
      initial="smooth"
      resize="smooth"
      role="log"
      {...props}
    >
      {anchored}
    </StickToBottom>
  );
};

/**
 * Re-pins the list to the bottom when the scroll container itself resizes
 * (window resize, sidebar toggle, panel open) while the user was already at
 * the bottom. The stick-to-bottom library only reacts to content growth, so a
 * shrinking viewport used to leave the latest message off-screen.
 */
function ResizeAnchor() {
  const { scrollRef, scrollToBottom } = useStickToBottomContext();
  const pinned = useRef(true);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const updatePinned = () => {
      pinned.current = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 24;
    };
    updatePinned();
    scroller.addEventListener("scroll", updatePinned, { passive: true });
    const observer = new ResizeObserver(() => {
      if (pinned.current) void scrollToBottom("instant");
    });
    observer.observe(scroller);
    return () => {
      scroller.removeEventListener("scroll", updatePinned);
      observer.disconnect();
    };
  }, [scrollRef, scrollToBottom]);

  return null;
}

export type ConversationContentProps = ComponentProps<typeof StickToBottom.Content>;

export const ConversationContent = ({ className, ...props }: ConversationContentProps) => (
  <StickToBottom.Content
    className={cn("flex flex-col gap-4 p-4", className)}
    {...props}
  />
);

export type ConversationEmptyStateProps = ComponentProps<"div"> & {
  title?: string;
  description?: string;
  icon?: React.ReactNode;
};

export const ConversationEmptyState = ({
  className,
  title = "No messages yet",
  description = "Start a conversation to see messages here",
  icon,
  children,
  ...props
}: ConversationEmptyStateProps) => (
  <div
    className={cn(
      "flex size-full flex-col items-center justify-center gap-3 p-8 text-center",
      className,
    )}
    {...props}
  >
    {children ?? (
      <>
        {icon && <div className="text-zinc-400">{icon}</div>}
        <div className="space-y-1">
          <h3 className="text-sm font-medium">{title}</h3>
          {description && <p className="text-sm text-zinc-500">{description}</p>}
        </div>
      </>
    )}
  </div>
);

export type ConversationScrollButtonProps = ComponentProps<typeof Button>;

export const ConversationScrollButton = ({
  className,
  ...props
}: ConversationScrollButtonProps) => {
  const { scrollRef, scrollToBottom } = useStickToBottomContext();
  const [isAtBottom, setIsAtBottom] = useState(true);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const handleScroll = () => {
      const distance = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
      setIsAtBottom(distance < 24);
    };
    handleScroll();
    scroller.addEventListener("scroll", handleScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", handleScroll);
  }, [scrollRef]);

  const handleScrollToBottom = useCallback(() => {
    void scrollToBottom();
  }, [scrollToBottom]);

  if (isAtBottom) return null;

  return (
    <Button
      className={cn(
        "absolute bottom-4 left-[50%] translate-x-[-50%] rounded-full shadow-md",
        className,
      )}
      onClick={handleScrollToBottom}
      size="icon"
      type="button"
      variant="outline"
      data-testid="scroll-to-bottom"
      {...props}
    >
      <ArrowDownIcon className="size-4" />
    </Button>
  );
};

export interface ConversationMessageLike {
  role: string;
  content: string;
}

const defaultFormatMessage = (message: ConversationMessageLike): string => {
  const roleLabel = message.role.charAt(0).toUpperCase() + message.role.slice(1);
  return `**${roleLabel}:** ${message.content}`;
};

export const messagesToMarkdown = (
  messages: ConversationMessageLike[],
  formatMessage: (message: ConversationMessageLike, index: number) => string = defaultFormatMessage,
): string => messages.map((message, i) => formatMessage(message, i)).join("\n\n");

export type ConversationDownloadProps = Omit<ComponentProps<typeof Button>, "onClick"> & {
  messages: ConversationMessageLike[];
  filename?: string;
  formatMessage?: (message: ConversationMessageLike, index: number) => string;
};

export const ConversationDownload = ({
  messages,
  filename = "conversation.md",
  formatMessage = defaultFormatMessage,
  className,
  children,
  ...props
}: ConversationDownloadProps) => {
  const handleDownload = useCallback(() => {
    const markdown = messagesToMarkdown(messages, formatMessage);
    const blob = new Blob([markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }, [messages, filename, formatMessage]);

  return (
    <Button
      className={cn("rounded-full", className)}
      onClick={handleDownload}
      size="icon"
      type="button"
      variant="outline"
      {...props}
    >
      {children ?? <DownloadIcon className="size-4" />}
    </Button>
  );
};
