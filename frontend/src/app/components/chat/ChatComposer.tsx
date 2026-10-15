"use client";

import { useCallback, useEffect, useRef, useState, type ComponentType } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useChatStore } from "@/store/chat";
import { useSettingsStore } from "@/store/settings";
import { useModels, useProviders } from "@/hooks/useRegistry";
import {
  Button,
  Badge,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui";
import { cn } from "@/lib/utils";
import { uploadChatAttachment } from "@/services/api";
import { providerTypeLabel } from "@/app/providers/fields";
import type { AIModel, Provider } from "@/types";

import {
  Bot,
  Brain,
  ChevronDown,
  CornerDownLeft,
  Cpu,
  Eye,
  Image as ImageIcon,
  Mic,
  Plus,
  Search,
  Square,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import { AttachmentPicker } from "./AttachmentPicker";
import { UploadPreview } from "./UploadPreview";
import { DropzoneOverlay } from "./attachments/DropzoneOverlay";
import { ReasoningSelector } from "./ReasoningSelector";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputHeader,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import { useModelCapabilities } from "./hooks/useModelCapabilities";
import { cycleReasoningLevel } from "./reasoningLevels";
import {
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_BYTES,
  combinedAccept,
  describeAttachment,
  kindForFile,
  preferredReasoningLevel,
  readyAttachments,
  suggestModels,
  unsupportedMessage,
  uploadKinds,
  type AttachmentKind,
  type ChatSendPayload,
  type ComposerAttachment,
} from "./capabilities";

export type { ChatSendPayload };

interface ChatComposerProps {
  streaming: boolean;
  disabled?: boolean;
  /** Kind of media on the conversation's last assistant message (if any).
   *  Informational only: the backend auto-resolves the edit reference, so
   *  this never touches the send payload. */
  continuityKind?: "image" | "video" | null;
  onSend: (payload: ChatSendPayload) => void;
  onStop: () => void;
}

const CAP_ICONS: Record<string, { icon: ComponentType<{ className?: string }>; label: string }> = {
  supports_vision: { icon: Eye, label: "Vision" },
  supports_reasoning: { icon: Brain, label: "Reasoning" },
  supports_tool_calling: { icon: Wrench, label: "Tool calling" },
  supports_streaming: { icon: Zap, label: "Streaming" },
  supports_audio_input: { icon: Mic, label: "Audio input" },
  supports_image_generation: { icon: ImageIcon, label: "Image generation" },
};

function UnifiedModelSelector({
  providers,
  models,
  open,
  onOpenChange,
}: {
  providers: Provider[];
  models: AIModel[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { providerId, modelId, setProvider, setModel, setAddProviderOpen } = useChatStore();
  const [search, setSearch] = useState("");
  const router = useRouter();

  const activeProvider = providers.find((p) => p.id === providerId);
  const activeModel = models.find((m) => m.id === modelId);

  const caps = activeModel
    ? Object.entries(CAP_ICONS)
        .filter(([k]) => (activeModel as unknown as Record<string, boolean>)[k])
        .map(([, item]) => item)
    : [];

  const q = search.trim().toLowerCase();

  const activeProviders = providers.filter((p) => p.is_active);
  const activeModels = models.filter((m) => m.is_active);

  const groups = activeProviders
    .map((p) => {
      const pModels = activeModels.filter(
        (m) =>
          m.provider_id === p.id &&
          (!q ||
            m.name.toLowerCase().includes(q) ||
            m.model_id.toLowerCase().includes(q) ||
            p.name.toLowerCase().includes(q)),
      );
      return { provider: p, models: pModels };
    })
    .filter((g) => g.models.length > 0 || (q && g.provider.name.toLowerCase().includes(q)));

  const totalMatchingModels = groups.reduce((acc, g) => acc + g.models.length, 0);
  // No active models at all (not just no search hit): the registry is empty
  // or everything is disabled — point at provider setup instead of a dead end.
  const registryEmpty = activeModels.length === 0;

  function handleAddProvider() {
    // The wizard modal lives on the providers page: navigate there first,
    // then open it (same pattern as the command palette's Add Provider).
    onOpenChange(false);
    router.push("/providers");
    setAddProviderOpen(true);
  }

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            "flex h-7 items-center gap-1.5 rounded-md px-2 text-xs transition-colors",
            "border border-zinc-200 hover:border-zinc-300 hover:bg-zinc-50",
            "dark:border-zinc-700 dark:hover:border-zinc-600 dark:hover:bg-zinc-800",
            !activeModel && "text-zinc-400",
          )}
          data-testid="model-selector"
          aria-label="Select model"
        >
          <Bot className="size-3 text-zinc-500" />
          <span className="max-w-44 truncate font-medium">
            {activeModel ? activeModel.name : "Select model"}
          </span>
          {activeProvider && (
            <span className="hidden sm:inline-flex rounded bg-zinc-100 dark:bg-zinc-800 px-1 py-0.2 text-[9px] text-zinc-500 dark:text-zinc-400 font-normal">
              {activeProvider.name}
            </span>
          )}
          {caps.length > 0 && (
            <span className="hidden items-center gap-1 md:flex">
              {caps.slice(0, 3).map(({ icon: Icon, label }) => (
                <Icon key={label} className="size-2.5 text-zinc-400" />
              ))}
            </span>
          )}
          <ChevronDown className="size-3 text-zinc-400" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-80 p-0 overflow-hidden">
        {/* Search input */}
        <div className="border-b border-zinc-200 p-2 dark:border-zinc-800">
          <div className="relative flex items-center">
            <Search className="absolute left-2 size-3.5 text-zinc-400 pointer-events-none" />
            <input
              type="text"
              placeholder="Search models or providers…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-7 w-full rounded border border-zinc-200 bg-transparent pl-7 pr-2 text-xs outline-none focus:border-zinc-400 dark:border-zinc-700 dark:focus:border-zinc-500"
              autoFocus
            />
          </div>
        </div>

        {/* Scrollable list with min-height and max-height */}
        <div className="min-h-[220px] max-h-[380px] overflow-y-auto p-1.5">
          {totalMatchingModels === 0 ? (
            <div className="flex h-[200px] flex-col items-center justify-center gap-1.5 px-4 text-center text-xs text-zinc-400">
              <Bot className="size-5 opacity-40" />
              {q ? (
                <>
                  <span>No models match &ldquo;{search.trim()}&rdquo;</span>
                  <button
                    type="button"
                    onClick={() => setSearch("")}
                    className="font-medium text-tollma-600 underline underline-offset-2 hover:text-tollma-700 dark:text-tollma-400 dark:hover:text-tollma-300"
                  >
                    Clear search
                  </button>
                </>
              ) : registryEmpty ? (
                <>
                  <span className="font-medium text-zinc-500 dark:text-zinc-300">No models available</span>
                  <span className="text-[11px]">
                    Add a provider to register your first model.
                  </span>
                  <Button
                    size="sm"
                    onClick={handleAddProvider}
                    data-testid="model-selector-add-provider"
                    className="mt-1 gap-1 text-[11px]"
                  >
                    <Plus className="size-3.5" />
                    Add provider
                  </Button>
                </>
              ) : (
                <span>No models found</span>
              )}
            </div>
          ) : (
            groups.map(({ provider, models: pModels }) => (
              <div key={provider.id} className="mb-2 last:mb-0">
                {/* Provider group header */}
                <div className="sticky top-0 z-10 flex items-center justify-between rounded bg-zinc-100/95 px-2 py-1 text-[11px] font-semibold text-zinc-600 backdrop-blur-sm dark:bg-zinc-900/95 dark:text-zinc-400">
                  <span className="flex items-center gap-1.5 truncate">
                    <Cpu className="size-3 text-zinc-400" />
                    <span className="truncate">{provider.name}</span>
                  </span>
                  <Badge variant="outline" className="text-[9px] px-1 py-0 shrink-0 font-normal">
                    {providerTypeLabel(provider.provider_type)}
                  </Badge>
                </div>

                {/* Models in provider */}
                <div className="mt-0.5 space-y-0.5">
                  {pModels.map((m) => {
                    const isSelected = modelId === m.id;
                    const mCaps = Object.entries(CAP_ICONS)
                      .filter(([k]) => (m as unknown as Record<string, boolean>)[k])
                      .map(([, item]) => item);

                    return (
                      <DropdownMenuItem
                        key={m.id}
                        onClick={() => {
                          setProvider(m.provider_id);
                          setModel(m.id);
                        }}
                        data-testid={`model-option-${m.id}`}
                        className={cn(
                          "flex cursor-pointer items-center justify-between rounded px-2 py-1.5 text-xs transition-colors",
                          isSelected
                            ? "bg-tollma-100 font-medium text-tollma-900 dark:bg-tollma-900 dark:text-tollma-100"
                            : "hover:bg-zinc-100 dark:hover:bg-zinc-800/60",
                        )}
                      >
                        <div className="flex flex-1 flex-col gap-0.5 overflow-hidden pr-2">
                          <span className="truncate">{m.name}</span>
                          <span className="text-[10px] text-zinc-400">
                            {m.context_window ? `ctx ${m.context_window.toLocaleString()}` : ""}
                            {m.input_price !== "0.000000" ? ` · $${m.input_price}/1M in` : ""}
                          </span>
                        </div>
                        <span className="flex shrink-0 items-center gap-1">
                          {mCaps.slice(0, 3).map(({ icon: Icon, label }) => (
                            <span key={label} title={label} className="inline-flex">
                              <Icon className="size-3 text-zinc-400" />
                            </span>
                          ))}
                        </span>
                      </DropdownMenuItem>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface Rejection {
  message: string;
  kind: AttachmentKind | null;
  suggestions: AIModel[];
}

export function ChatComposer({ streaming, disabled = false, continuityKind = null, onSend, onStop }: ChatComposerProps) {
  const {
    providerId,
    modelId,
    draft,
    setDraft,
    setProvider,
    setModel,
    activeConversationId,
  } = useChatStore();
  const { data: providers = [], isPending: providersPending } = useProviders();
  const { data: models = [] , isPending: modelsPending } = useModels();
  const { caps } = useModelCapabilities(models, modelId);
  const kinds = uploadKinds(caps);
  const enterBehavior = useSettingsStore((s) => s.enterBehavior);
  const defaultThinkingLevel = useSettingsStore((s) => s.defaultThinkingLevel);

  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [reasoningLevel, setReasoningLevel] = useState<string | null>(null);
  const [modelOpen, setModelOpen] = useState(false);
  const [rejection, setRejection] = useState<Rejection | null>(null);
  // Informational continuity chip, dismissed per conversation (local only).
  const [continuityDismissed, setContinuityDismissed] = useState<Record<string, boolean>>({});
  const continuityVisible =
    !!continuityKind && !continuityDismissed[activeConversationId ?? ""];

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const ready = !!providerId && !!modelId && !disabled;
  const uploading = attachments.some((a) => a.status === "uploading");
  const router = useRouter();

  // Stale persisted selection: the store survives provider/model deletions,
  // so validate saved ids against the registry once it loads. Clear the dead
  // reference and surface a one-time notice linking to provider setup.
  const staleNoticed = useRef(false);
  useEffect(() => {
    if (staleNoticed.current || providersPending || modelsPending) return;
    const store = useChatStore.getState();
    if (store.providerId && !providers.some((p) => p.id === store.providerId)) {
      staleNoticed.current = true;
      store.setProvider(null);
      toast.warning("Saved provider is no longer available", {
        description: "It was removed or is not registered. Pick another model to continue.",
        action: { label: "Open providers", onClick: () => router.push("/providers") },
      });
      return;
    }
    if (store.modelId && !models.some((m) => m.id === store.modelId)) {
      staleNoticed.current = true;
      store.setModel(null);
      toast.warning("Saved model is no longer available", {
        description: "It was removed or unregistered. Pick another model to continue.",
        action: { label: "Open providers", onClick: () => router.push("/providers") },
      });
    }
  }, [providersPending, modelsPending, providers, models, router]);

  // Model change: reset reasoning to the user's preferred level when the new
  // model offers it, and drop attachments its capabilities no longer support.
  const prevModelId = useRef(modelId);
  useEffect(() => {
    if (prevModelId.current === modelId) return;
    prevModelId.current = modelId;
    setReasoningLevel(preferredReasoningLevel(caps, defaultThinkingLevel));
    setRejection(null);
    setAttachments((prev) => {
      const kept = prev.filter((a) => kinds.includes(a.kind));
      for (const dropped of prev.filter((a) => !kinds.includes(a.kind))) {
        if (dropped.previewUrl) URL.revokeObjectURL(dropped.previewUrl);
      }
      return kept;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelId]);

  // Global shortcut hooks (dispatched by useGlobalShortcuts): focus, model
  // selector, model cycling, thinking cycling.
  useEffect(() => {
    function focusInput() {
      textareaRef.current?.focus();
    }
    function openSelector() {
      setModelOpen(true);
    }
    function switchModel() {
      const active = models.filter((m) => m.is_active);
      if (active.length === 0) return;
      const index = active.findIndex((m) => m.id === useChatStore.getState().modelId);
      const next = active[(index + 1 + active.length) % active.length];
      const store = useChatStore.getState();
      store.setProvider(next.provider_id);
      store.setModel(next.id);
    }
    function cycleThinking() {
      if (!caps.supportsReasoning) return;
      const current = reasoningLevel ?? preferredReasoningLevel(caps, defaultThinkingLevel);
      const next = cycleReasoningLevel(caps.reasoningLevels, current);
      if (next) setReasoningLevel(next);
    }
    window.addEventListener("tollma:focus-input", focusInput);
    window.addEventListener("tollma:open-model-selector", openSelector);
    window.addEventListener("tollma:switch-model", switchModel);
    window.addEventListener("tollma:cycle-thinking", cycleThinking);
    return () => {
      window.removeEventListener("tollma:focus-input", focusInput);
      window.removeEventListener("tollma:open-model-selector", openSelector);
      window.removeEventListener("tollma:switch-model", switchModel);
      window.removeEventListener("tollma:cycle-thinking", cycleThinking);
    };
  }, [caps, reasoningLevel, defaultThinkingLevel, models]);

  // Revoke image object URLs on unmount.
  useEffect(() => {
    const staged = attachments;
    return () => {
      for (const a of staged) {
        if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-resize textarea
  const resize = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  }, []);

  useEffect(() => {
    resize();
  }, [draft, resize]);

  // Focus on mount
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  function removeAttachment(id: string) {
    setAttachments((prev) => {
      const target = prev.find((a) => a.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((a) => a.id !== id);
    });
  }

  function updateAttachment(id: string, patch: Partial<ComposerAttachment>) {
    setAttachments((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  }

  function reject(kind: AttachmentKind | null, fileName: string) {
    const message = unsupportedMessage(kind, fileName);
    const suggestions = suggestModels(models, kind, modelId);
    setRejection({ message, kind, suggestions });
    toast.error(message);
  }

  /**
   * Single pipeline for picker, drag-drop, and clipboard files.
   * Entries render immediately with an upload state (AI SDK Attachments
   * pattern) — validation and capability checks stay exactly as before.
   */
  async function handleIncomingFiles(list: FileList | File[]) {
    const files = Array.from(list);
    if (files.length === 0) return;
    setRejection(null);
    const accepted: Array<{ file: File; kind: AttachmentKind; entry: ComposerAttachment }> = [];
    for (const file of files) {
      if (attachments.length + accepted.length >= MAX_ATTACHMENTS) {
        toast.error(`Maximum ${MAX_ATTACHMENTS} attachments`);
        break;
      }
      if (file.size > MAX_ATTACHMENT_BYTES) {
        toast.error(`${file.name} exceeds 25 MB`);
        continue;
      }
      const kind = kindForFile(file);
      if (!kind || !kinds.includes(kind)) {
        reject(kind, file.name);
        continue;
      }
      accepted.push({
        file,
        kind,
        entry: {
          id: crypto.randomUUID(),
          name: file.name,
          size: file.size,
          mime: file.type || kind,
          kind,
          attachmentId: null,
          previewUrl: kind === "image" ? URL.createObjectURL(file) : undefined,
          status: "uploading",
          progress: 0,
        },
      });
    }
    if (accepted.length === 0) return;
    setAttachments((prev) => [...prev, ...accepted.map((a) => a.entry)]);

    // Upload sequentially: deterministic order, bounded concurrency on the
    // server, and per-file state updates stay simple.
    for (const { file, entry } of accepted) {
      try {
        const up = await uploadChatAttachment(file, useChatStore.getState().activeConversationId, (fraction) =>
          updateAttachment(entry.id, { progress: fraction }),
        );
        updateAttachment(entry.id, {
          attachmentId: up.attachment_id,
          name: up.filename,
          size: up.size,
          mime: up.mime_type,
          status: "ready",
          progress: 1,
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : "unknown error";
        updateAttachment(entry.id, { status: "error", error: message });
        toast.error(`Upload failed: ${file.name}`, { description: message });
      }
    }
  }

  function handlePaste(e: React.ClipboardEvent) {
    const files = e.clipboardData?.files;
    if (files && files.length > 0) void handleIncomingFiles(files);
  }

  function switchToModel(m: AIModel) {
    setProvider(m.provider_id);
    setModel(m.id);
    setRejection(null);
  }

  function handleSend() {
    const text = draft.trim();
    const readyFiles = readyAttachments(attachments);
    if ((!text && readyFiles.length === 0) || uploading || streaming || !ready) return;
    onSend({
      text,
      reasoningLevel: caps.supportsReasoning
        ? (reasoningLevel ?? preferredReasoningLevel(caps, defaultThinkingLevel))
        : null,
      attachments: readyFiles.map(describeAttachment),
    });
    setDraft("");
    setRejection(null);
    for (const a of attachments) {
      if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
    }
    setAttachments([]);
    // Reset height
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }

  // --- Drag & drop (AI SDK Attachments pattern, capability-gated) ---
  // Window-level so a drop anywhere in the viewport attaches to the composer.
  const canDrop = ready && !streaming && kinds.length > 0;
  const canDropRef = useRef(canDrop);
  const incomingFilesRef = useRef(handleIncomingFiles);
  const dragDepth = useRef(0);
  const [dragActive, setDragActive] = useState(false);

  // Keep the listener closures current without re-registering on every render.
  useEffect(() => {
    canDropRef.current = canDrop;
    incomingFilesRef.current = handleIncomingFiles;
  });

  useEffect(() => {
    // Synthetic test drags may omit dataTransfer.types; only skip drags that
    // explicitly carry a non-file payload (e.g. dragging selected text).
    function isFileDrag(event: DragEvent): boolean {
      const types = event.dataTransfer?.types;
      if (!types || types.length === 0) return true;
      return Array.from(types).includes("Files");
    }
    function handleDragEnter(event: DragEvent) {
      if (!canDropRef.current || !isFileDrag(event)) return;
      event.preventDefault();
      dragDepth.current += 1;
      setDragActive(true);
    }
    function handleDragOver(event: DragEvent) {
      if (!canDropRef.current || !isFileDrag(event)) return;
      event.preventDefault();
    }
    function handleDragLeave() {
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragActive(false);
    }
    function handleDrop(event: DragEvent) {
      if (!canDropRef.current) return;
      event.preventDefault();
      dragDepth.current = 0;
      setDragActive(false);
      const files = event.dataTransfer?.files;
      if (files && files.length > 0) void incomingFilesRef.current(files);
    }
    window.addEventListener("dragenter", handleDragEnter);
    window.addEventListener("dragover", handleDragOver);
    window.addEventListener("dragleave", handleDragLeave);
    window.addEventListener("drop", handleDrop);
    return () => {
      window.removeEventListener("dragenter", handleDragEnter);
      window.removeEventListener("dragover", handleDragOver);
      window.removeEventListener("dragleave", handleDragLeave);
      window.removeEventListener("drop", handleDrop);
    };
  }, []);

  return (
    <div
      className="relative border-t border-zinc-200 bg-white px-3 pb-3 pt-2 dark:border-zinc-800 dark:bg-zinc-950"
      data-testid="chat-composer"
    >
      {/* Unsupported-upload warning with model suggestions */}
      {rejection && (
        <div
          className="mb-2 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300"
          data-testid="upload-warning"
          role="alert"
        >
          <div className="min-w-0 flex-1">
            <p className="font-medium">{rejection.message}</p>
            {rejection.suggestions.length > 0 && (
              <p className="mt-1">
                <span className="text-amber-600 dark:text-amber-400">Suggested Models: </span>
                {rejection.suggestions.map((s, i) => (
                  <span key={s.id}>
                    {i > 0 && ", "}
                    <button
                      type="button"
                      data-testid={`suggestion-model-${s.id}`}
                      onClick={() => switchToModel(s)}
                      className="font-medium underline underline-offset-2 hover:text-amber-900 dark:hover:text-amber-100"
                    >
                      {s.name}
                    </button>
                  </span>
                ))}
              </p>
            )}
          </div>
          <button
            type="button"
            aria-label="Dismiss upload warning"
            onClick={() => setRejection(null)}
            className="flex size-5 shrink-0 items-center justify-center rounded hover:bg-amber-100 dark:hover:bg-amber-900/40"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}

      <PromptInput
        onSubmit={(event) => {
          event.preventDefault();
          handleSend();
        }}
        status={streaming ? "streaming" : "ready"}
      >
        {/* Image-continuity hint: the backend edits the last image by default,
            so this is informational only — no payload change, no re-upload. */}
        {continuityVisible && (
          <div
            className="mb-2 flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-[11px] text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-400"
            data-testid="continuity-chip"
          >
            <ImageIcon className="size-3 shrink-0" />
            <span className="min-w-0 flex-1 truncate">
              Continuing from last {continuityKind} — new requests edit it
            </span>
            <button
              type="button"
              aria-label="Dismiss continuity hint"
              data-testid="continuity-dismiss"
              onClick={() =>
                setContinuityDismissed((prev) => ({ ...prev, [activeConversationId ?? ""]: true }))
              }
              className="flex size-5 shrink-0 items-center justify-center rounded hover:bg-zinc-200 dark:hover:bg-zinc-800"
            >
              <X className="size-3" />
            </button>
          </div>
        )}
        <DropzoneOverlay
          isDragging={dragActive && canDrop}
          acceptLabel={kinds.join(", ")}
        />

        <UploadPreview attachments={attachments} onRemove={removeAttachment} />

        <PromptInputBody>
          <PromptInputTextarea
            textareaRef={textareaRef}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              resize();
            }}
            onPaste={handlePaste}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              const withMod = e.metaKey || e.ctrlKey;
              // "send" (default): Enter sends, Shift+Enter newline, Ctrl/Cmd+Enter also sends.
              // "newline": Enter inserts a newline; Ctrl/Cmd+Enter sends.
              const shouldSend = enterBehavior === "send" ? !e.shiftKey || withMod : withMod;
              if (shouldSend) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder={
              !modelId
                ? "Select a model to start chatting…"
                : streaming
                  ? "Generating response…"
                  : enterBehavior === "send"
                    ? "Message… (Enter to send, Shift+Enter for newline)"
                    : "Message… (Ctrl+Enter to send, Enter for newline)"
            }
            rows={1}
            disabled={disabled && !streaming}
            aria-label="Chat input"
            data-testid="chat-input"
          />
        </PromptInputBody>

        {/* Toolbar: message-creation controls only */}
        <PromptInputFooter className="pb-2">
          <PromptInputTools>
            <UnifiedModelSelector
              providers={providers}
              models={models}
              open={modelOpen}
              onOpenChange={setModelOpen}
            />

            {/* Thinking slider — hidden entirely unless the model reasons */}
            {caps.supportsReasoning && (
              <ReasoningSelector
                levels={caps.reasoningLevels}
                value={reasoningLevel ?? preferredReasoningLevel(caps, defaultThinkingLevel)}
                onChange={setReasoningLevel}
              />
            )}

            {/* Single upload button — hidden for text-only models */}
            <AttachmentPicker
              accept={kinds.length > 0 ? combinedAccept(kinds) : null}
              disabled={!ready || streaming}
              onPick={(files) => void handleIncomingFiles(files)}
            />
          </PromptInputTools>

          <PromptInputSubmit
            className={
              streaming
                ? "border-red-200 text-red-600 hover:text-red-700 dark:border-red-900"
                : undefined
            }
            disabled={!ready || uploading || (!draft.trim() && readyAttachments(attachments).length === 0)}
            onStop={onStop}
            status={streaming ? "streaming" : "ready"}
          >
            {streaming ? (
              <>
                <Square className="size-3 fill-current" />
                <span>Stop Generating</span>
              </>
            ) : (
              <>
                <span>Send</span>
                <CornerDownLeft className="size-3" />
              </>
            )}
          </PromptInputSubmit>
        </PromptInputFooter>
      </PromptInput>
    </div>
  );
}
