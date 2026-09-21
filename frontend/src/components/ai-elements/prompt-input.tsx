"use client";

import { ArrowUpIcon, Loader2Icon, SquareIcon } from "lucide-react";
import {
  createContext,
  useEffect,
  useRef,
  type ComponentProps,
  type HTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Tooltip,
} from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

export type PromptInputStatus = "ready" | "submitted" | "streaming" | "error";

interface PromptInputContextValue {
  status: PromptInputStatus;
}

const PromptInputContext = createContext<PromptInputContextValue>({ status: "ready" });

// ============================================================================
// PromptInput - form shell (drag & drop target lives here)
// ============================================================================

export type PromptInputProps = Omit<ComponentProps<"form">, "onSubmit"> & {
  status?: PromptInputStatus;
  onSubmit?: (event: React.FormEvent<HTMLFormElement>) => void;
};

export const PromptInput = ({
  className,
  status = "ready",
  onSubmit,
  children,
  ...props
}: PromptInputProps) => (
  <PromptInputContext.Provider value={{ status }}>
    <form
      className={cn(
        "relative w-full overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm transition-colors",
        "focus-within:border-zinc-300 dark:border-zinc-700 dark:bg-zinc-900 dark:focus-within:border-zinc-600",
        className,
      )}
      onSubmit={onSubmit}
      {...props}
    >
      {children}
    </form>
  </PromptInputContext.Provider>
);

export type PromptInputBodyProps = HTMLAttributes<HTMLDivElement>;

export const PromptInputBody = ({ className, ...props }: PromptInputBodyProps) => (
  <div className={cn("flex flex-col", className)} {...props} />
);

// ============================================================================
// PromptInputTextarea
// ============================================================================

export type PromptInputTextareaProps = ComponentProps<"textarea"> & {
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>;
};

export const PromptInputTextarea = ({
  className,
  onInput,
  textareaRef,
  ...props
}: PromptInputTextareaProps) => {
  const internalRef = useRef<HTMLTextAreaElement | null>(null);

  const resize = () => {
    const el = internalRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  };

  useEffect(() => {
    resize();
  }, [props.value]);

  return (
    <textarea
      ref={(node) => {
        internalRef.current = node;
        if (textareaRef) textareaRef.current = node;
      }}
      className={cn(
        "min-h-[52px] w-full resize-none bg-transparent px-4 pt-3.5 pb-2 text-sm outline-none",
        "placeholder:text-zinc-400 dark:placeholder:text-zinc-500",
        className,
      )}
      onInput={(event) => {
        resize();
        onInput?.(event);
      }}
      {...props}
    />
  );
};

// ============================================================================
// Header / Footer / Tools
// ============================================================================

export type PromptInputHeaderProps = HTMLAttributes<HTMLDivElement>;

export const PromptInputHeader = ({ className, ...props }: PromptInputHeaderProps) => (
  <div className={cn("flex flex-wrap items-center gap-2 px-3 pt-3", className)} {...props} />
);

export type PromptInputFooterProps = HTMLAttributes<HTMLDivElement>;

export const PromptInputFooter = ({ className, ...props }: PromptInputFooterProps) => (
  <div className={cn("flex items-center justify-between gap-2 px-3 pb-3", className)} {...props} />
);

export type PromptInputToolsProps = HTMLAttributes<HTMLDivElement>;

export const PromptInputTools = ({ className, ...props }: PromptInputToolsProps) => (
  <div className={cn("flex min-w-0 items-center gap-1", className)} {...props} />
);

// ============================================================================
// Buttons
// ============================================================================

export type PromptInputButtonProps = ComponentProps<typeof Button> & {
  tooltip?: string;
};

export const PromptInputButton = ({
  tooltip,
  className,
  children,
  variant = "ghost",
  size = "icon",
  ...props
}: PromptInputButtonProps) => {
  const button = (
    <Button
      className={cn("shrink-0 text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100", className)}
      size={size}
      type="button"
      variant={variant}
      {...props}
    >
      {children}
    </Button>
  );

  if (!tooltip) return button;

  return <Tooltip content={<p>{tooltip}</p>}>{button}</Tooltip>;
};

export type PromptInputActionMenuProps = ComponentProps<typeof DropdownMenu>;

export const PromptInputActionMenu = (props: PromptInputActionMenuProps) => <DropdownMenu {...props} />;

export type PromptInputActionMenuTriggerProps = PromptInputButtonProps;

export const PromptInputActionMenuTrigger = ({
  children,
  ...props
}: PromptInputActionMenuTriggerProps) => (
  <DropdownMenuTrigger asChild>
    <PromptInputButton {...props}>{children}</PromptInputButton>
  </DropdownMenuTrigger>
);

export type PromptInputActionMenuContentProps = ComponentProps<typeof DropdownMenuContent>;

export const PromptInputActionMenuContent = (props: PromptInputActionMenuContentProps) => (
  <DropdownMenuContent align="start" {...props} />
);

export type PromptInputActionMenuItemProps = ComponentProps<typeof DropdownMenuItem>;

export const PromptInputActionMenuItem = (props: PromptInputActionMenuItemProps) => (
  <DropdownMenuItem {...props} />
);

// ============================================================================
// Submit
// ============================================================================

export interface PromptInputSubmitProps extends Omit<ComponentProps<typeof Button>, "children"> {
  status?: PromptInputStatus;
  onStop?: () => void;
  disabled?: boolean;
  children?: ReactNode;
}

export const PromptInputSubmit = ({
  className,
  status = "ready",
  onStop,
  disabled,
  children,
  ...props
}: PromptInputSubmitProps) => {
  const isBusy = status === "submitted" || status === "streaming";

  if (isBusy) {
    return (
      <Button
        aria-label="Stop generating"
        className={cn("shrink-0 gap-1.5", children ? "rounded-lg px-2.5 text-xs" : "rounded-full", className)}
        data-testid="stop-button"
        onClick={onStop}
        size={children ? "sm" : "icon"}
        type="button"
        variant="secondary"
        {...props}
      >
        {status === "submitted" && !children ? (
          <Loader2Icon className="size-4 animate-spin" />
        ) : (
          children ?? <SquareIcon className="size-3.5 fill-current" />
        )}
      </Button>
    );
  }

  return (
    <Button
      aria-label="Send message"
      className={cn("shrink-0 gap-1.5", children ? "rounded-lg px-2.5 text-xs" : "rounded-full", className)}
      data-testid="send-button"
      disabled={disabled}
      size={children ? "sm" : "icon"}
      type="submit"
      variant="default"
      {...props}
    >
      {children ?? <ArrowUpIcon className="size-4" />}
    </Button>
  );
};

// ============================================================================
// Keyboard helper (Enter behavior honoring user preference)
// ============================================================================

export interface PromptInputKeydownOptions {
  enterSends: boolean;
  onSubmit: () => void;
}

export const handlePromptKeydown = (
  event: KeyboardEvent<HTMLTextAreaElement>,
  { enterSends, onSubmit }: PromptInputKeydownOptions,
): boolean => {
  const withModifier = event.metaKey || event.ctrlKey;
  const isEnter = event.key === "Enter";

  if (!isEnter || event.nativeEvent.isComposing) return false;

  if (enterSends ? !withModifier : withModifier) {
    event.preventDefault();
    onSubmit();
    return true;
  }

  return false;
};
