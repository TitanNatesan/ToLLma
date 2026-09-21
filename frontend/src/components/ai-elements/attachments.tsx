"use client";

import {
  FileTextIcon,
  GlobeIcon,
  ImageIcon,
  Music2Icon,
  PaperclipIcon,
  VideoIcon,
  XIcon,
} from "lucide-react";
import type { ComponentProps, HTMLAttributes, ReactNode } from "react";
import { createContext, useCallback, useContext, useMemo } from "react";
import { Button } from "@/components/ui/primitives";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "./hover-card";
import { cn } from "@/lib/utils";

// ============================================================================
// Types
// ============================================================================

export type AttachmentData =
  | {
      type: "file";
      id: string;
      url?: string;
      filename?: string;
      mediaType?: string;
      size?: number;
    }
  | {
      type: "source-document";
      id: string;
      title?: string;
      filename?: string;
      mediaType?: string;
    };

export type AttachmentMediaCategory = "image" | "video" | "audio" | "document" | "source" | "unknown";

export type AttachmentVariant = "grid" | "inline" | "list";

const mediaCategoryIcons: Record<AttachmentMediaCategory, typeof ImageIcon> = {
  audio: Music2Icon,
  document: FileTextIcon,
  image: ImageIcon,
  source: GlobeIcon,
  unknown: PaperclipIcon,
  video: VideoIcon,
};

export const getMediaCategory = (data: AttachmentData): AttachmentMediaCategory => {
  if (data.type === "source-document") {
    return "source";
  }

  const mediaType = data.mediaType ?? "";

  if (mediaType.startsWith("image/")) return "image";
  if (mediaType.startsWith("video/")) return "video";
  if (mediaType.startsWith("audio/")) return "audio";
  if (mediaType.startsWith("application/") || mediaType.startsWith("text/")) return "document";
  return "unknown";
};

export const getAttachmentLabel = (data: AttachmentData): string => {
  if (data.type === "source-document") {
    return data.title || data.filename || "Source";
  }

  const category = getMediaCategory(data);
  return data.filename || (category === "image" ? "Image" : "Attachment");
};

interface AttachmentsContextValue {
  variant: AttachmentVariant;
}

const AttachmentsContext = createContext<AttachmentsContextValue | null>(null);

interface AttachmentContextValue {
  data: AttachmentData;
  mediaCategory: AttachmentMediaCategory;
  onRemove?: () => void;
  variant: AttachmentVariant;
}

const AttachmentContext = createContext<AttachmentContextValue | null>(null);

export const useAttachmentsContext = () => useContext(AttachmentsContext) ?? { variant: "grid" as const };

export const useAttachmentContext = () => {
  const ctx = useContext(AttachmentContext);
  if (!ctx) {
    throw new Error("Attachment components must be used within <Attachment>");
  }
  return ctx;
};

// ============================================================================
// Attachments - Container
// ============================================================================

export type AttachmentsProps = HTMLAttributes<HTMLDivElement> & {
  variant?: AttachmentVariant;
};

export const Attachments = ({ variant = "grid", className, children, ...props }: AttachmentsProps) => {
  const contextValue = useMemo(() => ({ variant }), [variant]);

  return (
    <AttachmentsContext.Provider value={contextValue}>
      <div
        className={cn(
          "flex items-start",
          variant === "list" ? "flex-col gap-2" : "flex-wrap gap-2",
          variant === "grid" && "ml-auto w-fit",
          className,
        )}
        {...props}
      >
        {children}
      </div>
    </AttachmentsContext.Provider>
  );
};

// ============================================================================
// Attachment - Item
// ============================================================================

export type AttachmentProps = HTMLAttributes<HTMLDivElement> & {
  data: AttachmentData;
  onRemove?: () => void;
  /** Overrides the variant provided by the enclosing <Attachments> container. */
  variant?: AttachmentVariant;
};

export const Attachment = ({
  data,
  onRemove,
  variant: variantProp,
  className,
  children,
  ...props
}: AttachmentProps) => {
  const { variant: contextVariant } = useAttachmentsContext();
  const variant = variantProp ?? contextVariant;
  const mediaCategory = getMediaCategory(data);

  const contextValue = useMemo<AttachmentContextValue>(
    () => ({ data, mediaCategory, onRemove, variant }),
    [data, mediaCategory, onRemove, variant],
  );

  return (
    <AttachmentContext.Provider value={contextValue}>
      <div
        className={cn(
          "group relative",
          variant === "grid" && "size-24 overflow-hidden rounded-lg",
          variant === "inline" &&
            "flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-zinc-200 px-1.5 text-sm font-medium transition-all hover:bg-zinc-100 select-none dark:border-zinc-700 dark:hover:bg-zinc-800",
          variant === "list" &&
            "flex w-full items-center gap-3 rounded-lg border border-zinc-200 p-3 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/50",
          className,
        )}
        {...props}
      >
        {children}
      </div>
    </AttachmentContext.Provider>
  );
};

// ============================================================================
// AttachmentPreview - Media preview
// ============================================================================

export type AttachmentPreviewProps = HTMLAttributes<HTMLDivElement> & {
  fallbackIcon?: ReactNode;
};

export const AttachmentPreview = ({ fallbackIcon, className, ...props }: AttachmentPreviewProps) => {
  const { data, mediaCategory, variant } = useAttachmentContext();

  const iconSize = variant === "inline" ? "size-3" : "size-4";

  const renderContent = () => {
    if (mediaCategory === "image" && data.type === "file" && data.url) {
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          alt={data.filename || "Image"}
          className={variant === "grid" ? "size-full object-cover" : "size-full rounded object-cover"}
          src={data.url}
        />
      );
    }

    if (mediaCategory === "video" && data.type === "file" && data.url) {
      return <video className="size-full object-cover" muted src={data.url} />;
    }

    const Icon = mediaCategoryIcons[mediaCategory];
    return fallbackIcon ?? <Icon className={cn(iconSize, "text-zinc-500 dark:text-zinc-400")} />;
  };

  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden",
        variant === "grid" && "size-full bg-zinc-100 dark:bg-zinc-800",
        variant === "inline" && "size-5 rounded bg-white dark:bg-zinc-900",
        variant === "list" && "size-12 rounded bg-zinc-100 dark:bg-zinc-800",
        className,
      )}
      {...props}
    >
      {renderContent()}
    </div>
  );
};

// ============================================================================
// AttachmentInfo - Name and type display
// ============================================================================

export type AttachmentInfoProps = HTMLAttributes<HTMLDivElement> & {
  showMediaType?: boolean;
};

export const AttachmentInfo = ({ showMediaType = false, className, ...props }: AttachmentInfoProps) => {
  const { data, variant } = useAttachmentContext();

  if (variant === "grid") {
    return null;
  }

  const label = getAttachmentLabel(data);
  const mediaType = data.type === "file" ? data.mediaType : undefined;

  return (
    <div className={cn("min-w-0 flex-1", className)} {...props}>
      <span className="block truncate">{label}</span>
      {showMediaType && mediaType && (
        <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">{mediaType}</span>
      )}
    </div>
  );
};

// ============================================================================
// AttachmentRemove - Remove button
// ============================================================================

export type AttachmentRemoveProps = ComponentProps<typeof Button> & {
  label?: string;
};

export const AttachmentRemove = ({
  label = "Remove",
  className,
  children,
  ...props
}: AttachmentRemoveProps) => {
  const { onRemove, variant } = useAttachmentContext();

  const handleClick = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation();
      onRemove?.();
    },
    [onRemove],
  );

  if (!onRemove) {
    return null;
  }

  return (
    <Button
      aria-label={label}
      className={cn(
        variant === "grid" &&
          "absolute top-2 right-2 size-6 rounded-full bg-white/80 p-0 opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100 hover:bg-white [&>svg]:size-3 dark:bg-zinc-900/80 dark:hover:bg-zinc-900",
        variant === "inline" &&
          "size-5 rounded p-0 opacity-0 transition-opacity group-hover:opacity-100 [&>svg]:size-2.5",
        variant === "list" && "size-8 shrink-0 rounded p-0 [&>svg]:size-4",
        className,
      )}
      onClick={handleClick}
      type="button"
      variant="ghost"
      {...props}
    >
      {children ?? <XIcon />}
      <span className="sr-only">{label}</span>
    </Button>
  );
};

// ============================================================================
// AttachmentHoverCard - Hover preview
// ============================================================================

export type AttachmentHoverCardProps = ComponentProps<typeof HoverCard>;

export const AttachmentHoverCard = ({ openDelay = 0, closeDelay = 0, ...props }: AttachmentHoverCardProps) => (
  <HoverCard closeDelay={closeDelay} openDelay={openDelay} {...props} />
);

export type AttachmentHoverCardTriggerProps = ComponentProps<typeof HoverCardTrigger>;

export const AttachmentHoverCardTrigger = (props: AttachmentHoverCardTriggerProps) => (
  <HoverCardTrigger {...props} />
);

export type AttachmentHoverCardContentProps = ComponentProps<typeof HoverCardContent>;

export const AttachmentHoverCardContent = ({
  align = "start",
  className,
  ...props
}: AttachmentHoverCardContentProps) => (
  <HoverCardContent align={align} className={cn("w-auto p-2", className)} {...props} />
);

// ============================================================================
// AttachmentEmpty - Empty state
// ============================================================================

export type AttachmentEmptyProps = HTMLAttributes<HTMLDivElement>;

export const AttachmentEmpty = ({ className, children, ...props }: AttachmentEmptyProps) => (
  <div
    className={cn("flex items-center justify-center p-4 text-sm text-zinc-500 dark:text-zinc-400", className)}
    {...props}
  >
    {children ?? "No attachments"}
  </div>
);
