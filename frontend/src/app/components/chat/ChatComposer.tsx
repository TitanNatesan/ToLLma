"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/notify";
import { useQueryClient } from "@tanstack/react-query";
import { useChatStore } from "@/store/chat";
import { useChatKeyStore } from "./chatKeyStore";
import { useOrgStore } from "@/store/org";
import { useSettingsStore } from "@/store/settings";
import { useModels, useProviders } from "@/hooks/useRegistry";
import { useAllChatKeyModels, useChatKeys, type KeyModelsEntry } from "@/hooks/useChatKeys";
import { Button } from "@/components/ui";
import { ModelSelectorMenu } from "./ModelSelectorMenu";
import { cn } from "@/lib/utils";
import { policyDenialCopy, uploadChatAttachment } from "@/services/api";
import type { AIModel, ChatKey } from "@/types";

import {
  Bot,
  CornerDownLeft,
  Image as ImageIcon,
  KeyRound,
  Plus,
  Square,
  X,
} from "lucide-react";
import { AttachmentPicker } from "./AttachmentPicker";
import { UploadPreview } from "./UploadPreview";
import { DropzoneOverlay } from "./attachments/DropzoneOverlay";
import { ReasoningControl } from "./ReasoningControl";
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
  resolveReasoningValue,
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

interface Rejection {
  message: string;
  kind: AttachmentKind | null;
  suggestions: AIModel[];
}

/** Key-gating notice: same banner language as the upload warning above. */
function KeyNotice({
  title,
  body,
  actionLabel,
  onAction,
}: {
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div
      className="mb-2 flex items-start gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800 dark:border-sky-900/50 dark:bg-sky-950/30 dark:text-sky-300"
      data-testid="key-notice"
      role="status"
    >
      <KeyRound className="mt-0.5 size-3.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{title}</p>
        <p className="mt-0.5 text-sky-700 dark:text-sky-400">{body}</p>
      </div>
      {actionLabel && onAction && (
        <Button size="sm" variant="outline" onClick={onAction} className="mt-0.5 shrink-0 text-[11px]">
          {actionLabel}
        </Button>
      )}
    </div>
  );
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
  // --- BYOK key gating: the model list derives from the selected key.
  // Per-key entries are full ModelRead rows (same shape as the registry),
  // so org models render without depending on the personal-only listing.
  const qc = useQueryClient();
  const { data: chatKeys = [], isPending: keysPending } = useChatKeys();
  const { keyId, problem: keyProblem, setKey, clearProblem } = useChatKeyStore();
  // All keys' models at once: powers the unified key-grouped dropdown and
  // keyboard cycling. Single-key views below derive from this map.
  const { entries: keyEntries, isPending: keyEntriesPending } = useAllChatKeyModels(chatKeys);
  // Scope-correct model union: personal registry rows plus every key's
  // eligible models (full ModelRead rows, same shape). Org models never
  // appear in the personal-only listing, so every id lookup below must
  // use this union — never the registry alone.
  const scopedModels = useMemo(() => {
    const byId = new Map(models.map((m) => [m.id, m]));
    for (const entry of keyEntries) {
      for (const km of entry.models ?? []) byId.set(km.id, km);
    }
    return [...byId.values()];
  }, [models, keyEntries]);
  // Provider ids the session may validly reference: personal registry
  // plus every key-eligible model's provider (org providers included).
  const scopedProviderIds = useMemo(() => {
    const ids = new Set(providers.map((p) => p.id));
    for (const entry of keyEntries) {
      for (const km of entry.models ?? []) ids.add(km.provider_id);
    }
    return ids;
  }, [providers, keyEntries]);
  const activeKeyEntry = keyEntries.find((e) => e.key.id === keyId);
  const keyModels = activeKeyEntry?.models;
  const keyModelsError = activeKeyEntry?.error ?? false;
  const activeKey = activeKeyEntry?.key ?? chatKeys.find((k) => k.id === keyId);
  const eligibleIds = useMemo(() => new Set((keyModels ?? []).map((m) => m.id)), [keyModels]);
  const eligibleModels = useMemo(
    () => (keyId ? scopedModels.filter((m) => eligibleIds.has(m.id)) : []),
    [scopedModels, eligibleIds, keyId],
  );
  const orgContext = useOrgStore((s) => s.context);
  const orgKey = orgContext.type === "org" ? orgContext.orgId : "personal";
  const { caps } = useModelCapabilities(scopedModels, modelId);
  const kinds = uploadKinds(caps);
  const enterBehavior = useSettingsStore((s) => s.enterBehavior);
  const defaultThinkingLevel = useSettingsStore((s) => s.defaultThinkingLevel);

  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  // Reasoning level lives in persisted store state keyed by model id, so
  // switching models restores each model's last level. Null = no override.
  const thinkingLevels = useChatStore((st) => st.thinkingLevels);
  const setThinkingLevel = useChatStore((st) => st.setThinkingLevel);
  const reasoningLevel = modelId ? (thinkingLevels[modelId] ?? null) : null;
  // Display + send value: stored choice kept when the model supports it,
  // else the provided default or empty. Null-safe: unknown models resolve
  // to null and hide the control (see reasoningControl).
  const resolvedReasoning = resolveReasoningValue(caps, reasoningLevel, defaultThinkingLevel);
  const [modelOpen, setModelOpen] = useState(false);
  const [rejection, setRejection] = useState<Rejection | null>(null);
  // Informational continuity chip, dismissed per conversation (local only).
  const [continuityDismissed, setContinuityDismissed] = useState<Record<string, boolean>>({});
  const continuityVisible =
    !!continuityKind && !continuityDismissed[activeConversationId ?? ""];

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const ready = !!providerId && !!modelId && !!keyId && !keyProblem && !disabled;
  const uploading = attachments.some((a) => a.status === "uploading");
  const router = useRouter();

  // Stale persisted selection: the store survives provider/model deletions,
  // so validate saved ids against the registry once it loads. Clear the dead
  // reference and surface a one-time notice linking to provider setup.
  const staleNoticed = useRef(false);
  useEffect(() => {
    // Wait for every scope source (key list, registry, all key entries):
    // validating against a partially loaded union would clear live org
    // selections. Note useQueries([]) is instantly "settled", so the key
    // list itself must gate too.
    if (staleNoticed.current || keysPending || providersPending || modelsPending || keyEntriesPending) return;
    const store = useChatStore.getState();
    if (store.providerId && !scopedProviderIds.has(store.providerId)) {
      staleNoticed.current = true;
      store.setProvider(null);
      toast.warning("Saved provider is no longer available", {
        description: "It was removed or is not registered. Pick another model to continue.",
        action: { label: "Open providers", onClick: () => router.push("/providers") },
      });
      return;
    }
    if (store.modelId && !scopedModels.some((m) => m.id === store.modelId)) {
      staleNoticed.current = true;
      store.setModel(null);
      toast.warning("Saved model is no longer available", {
        description: "It was removed or unregistered. Pick another model to continue.",
        action: { label: "Open providers", onClick: () => router.push("/providers") },
      });
    }
  }, [keysPending, providersPending, modelsPending, keyEntriesPending, providers, scopedModels, scopedProviderIds, router]);

  // Persisted key validation: the key store survives key deletion/disable, so
  // validate the saved id against the fetched list. Clear the dead reference
  // with a one-time notice (same pattern as the provider/model stale check).
  useEffect(() => {
    if (keysPending || !keyId) return;
    const entry = chatKeys.find((k) => k.id === keyId);
    if (entry?.enabled) return;
    setKey(null);
    toast.warning("Selected API key is no longer available", {
      description: entry
        ? "That key was disabled. Pick another key to continue."
        : "It was removed or revoked. Pick another key to continue.",
      action: { label: "Manage API keys", onClick: () => router.push("/api-keys") },
    });
  }, [keysPending, chatKeys, keyId, setKey, router]);

  // Model eligibility follows the key: a model valid under the previous key
  // (or a stale persisted id) must not survive under a key that forbids it.
  // Clear with notice — never auto-pick a replacement.
  useEffect(() => {
    if (!keyId || keyModels === undefined || modelsPending || !modelId) return;
    if (eligibleIds.has(modelId)) {
      // Same model, different scope: keep the explicit choice but re-align
      // the provider (setProvider resets the model, so restore it after).
      const kept = scopedModels.find((m) => m.id === modelId);
      if (kept && kept.provider_id !== providerId) {
        setProvider(kept.provider_id);
        setModel(kept.id);
      }
      return;
    }
    setModel(null);
    toast.warning("Model isn't available for this key", {
      description: "The selected model isn't eligible for the active API key. Pick another model to continue.",
    });
  }, [keyId, keyModels, eligibleIds, modelId, scopedModels, modelsPending, providerId, setModel, setProvider]);

  // Gateway key denial on send (flagged by the api layer): refresh both lists
  // and request re-selection. Key denials clear the key only via the
  // validation effect above (key gone/disabled) — never silently switched.
  // Model denials clear the model; the key is unchanged.
  useEffect(() => {
    if (!keyProblem) return;
    void qc.invalidateQueries({ queryKey: ["chat-keys"] });
    if (keyId) void qc.invalidateQueries({ queryKey: ["chat-key-models", keyId] });
    if (keyProblem === "model-not-allowed") setModel(null);
  }, [keyProblem, keyId, qc, setModel]);

  // Resolved by re-selection: an eligible model after a model denial.
  // (Key changes resolve via setKey, which clears the problem itself.)
  useEffect(() => {
    if (keyProblem === "model-not-allowed" && modelId && eligibleIds.has(modelId)) clearProblem();
  }, [keyProblem, modelId, eligibleIds, clearProblem]);

  // Org context switch (or membership revocation elsewhere): eligibility is
  // membership-scoped, so refresh the key list on change. Skips the first
  // run — the initial fetch already covers mount.
  const orgFirstRun = useRef(true);
  useEffect(() => {
    if (orgFirstRun.current) {
      orgFirstRun.current = false;
      return;
    }
    void qc.invalidateQueries({ queryKey: ["chat-keys"] });
  }, [orgKey, qc]);

  // Model change: drop attachments the new model's capabilities no longer
  // support. The reasoning level needs no reset — it is derived per model at
  // render (stored level, else the global default), so it follows the switch.
  const prevModelId = useRef(modelId);
  useEffect(() => {
    if (prevModelId.current === modelId) return;
    prevModelId.current = modelId;
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
      // Cycle across every key's models (deduped, current key preferred);
      // landing on a model also switches to its key.
      const seen = new Set<string>();
      const pairs: Array<{ keyId: string; model: AIModel }> = [];
      const orderedEntries = [...keyEntries].sort((a, b) =>
        a.key.id === useChatKeyStore.getState().keyId ? -1 : b.key.id === useChatKeyStore.getState().keyId ? 1 : 0,
      );
      for (const entry of orderedEntries) {
        for (const km of entry.models ?? []) {
          if (seen.has(km.id)) continue;
          const full = scopedModels.find((m) => m.id === km.id);
          if (!full || !full.is_active) continue;
          seen.add(km.id);
          pairs.push({ keyId: entry.key.id, model: full });
        }
      }
      if (pairs.length === 0) return;
      const index = pairs.findIndex((p) => p.model.id === useChatStore.getState().modelId);
      const next = pairs[(index + 1 + pairs.length) % pairs.length];
      if (!next) return;
      const store = useChatStore.getState();
      useChatKeyStore.getState().setKey(next.keyId);
      store.setProvider(next.model.provider_id);
      store.setModel(next.model.id);
    }
    function cycleThinking() {
      const control = caps.reasoningControl;
      if (!control || !modelId) return;
      if (control.kind === "toggle") {
        setThinkingLevel(modelId, reasoningLevel === control.onValue ? null : control.onValue);
        return;
      }
      if (control.kind !== "effort") return;
      const current = reasoningLevel ?? resolveReasoningValue(caps, reasoningLevel, defaultThinkingLevel);
      const next = cycleReasoningLevel(control.levels, current);
      if (next) setThinkingLevel(modelId, next);
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
  }, [caps, reasoningLevel, defaultThinkingLevel, keyEntries, scopedModels, modelId, setThinkingLevel]);

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
    const suggestions = suggestModels(eligibleModels, kind, modelId);
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

  /**
   * Single key-grouped pick: one click sets key + provider + model together.
   * setKey clears any outstanding key problem (explicit choice wins).
   */
  function pickKeyModel(nextKeyId: string, m: AIModel) {
    setKey(nextKeyId);
    setProvider(m.provider_id);
    setModel(m.id);
    setModelOpen(false);
  }

  function handleSend() {
    const text = draft.trim();
    const readyFiles = readyAttachments(attachments);
    if ((!text && readyFiles.length === 0) || uploading || streaming) return;
    if (!keyId) {
      toast.error("Select a model to send", {
        description: "Pick a model above — its API key is selected automatically.",
      });
      return;
    }
    if (modelId && keyModels !== undefined && !keyModelsError && !eligibleIds.has(modelId)) {
      toast.error("That model isn't available for this key", {
        description: "Pick another model to continue.",
      });
      return;
    }
    if (!ready) return;
    onSend({
      text,
      reasoningLevel: resolvedReasoning,
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

  // --- Key-state banner + model empty state (derived during render) ---
  // Send stays disabled via `ready`; banners explain why and offer the fix.
  function openKeyManagement() {
    router.push("/api-keys");
  }
  let keyBanner: ReactNode = null;
  if (keyProblem === "key-invalid") {
    keyBanner = (
      <KeyNotice
        title="This API key is no longer valid"
        body="It was revoked, disabled, expired, or your org access changed. Your key list was refreshed — pick another model to continue."
      />
    );
  } else if (keyProblem === "model-not-allowed") {
    keyBanner = (
      <KeyNotice
        title="That model isn't allowed for this key"
        body="Pick another model to continue — your key is unchanged."
      />
    );
  } else if (keyProblem === "budget-exceeded" || keyProblem === "ip-blocked") {
    // Policy denial: nothing was generated, key and model stay selected.
    // Recovery is correcting the policy — the key console owns the fix.
    const copy = policyDenialCopy(keyProblem);
    keyBanner = (
      <KeyNotice
        title={copy.title}
        body={copy.description}
        actionLabel="Manage API keys"
        onAction={openKeyManagement}
      />
    );
  } else if (keyProblem === "rate-limited") {
    // Transient: the same key and model stay selected, retrying clears this.
    const copy = policyDenialCopy(keyProblem);
    keyBanner = (
      <KeyNotice
        title={copy.title}
        body={copy.description}
        actionLabel="Retry now"
        onAction={() => {
          clearProblem();
          void qc.invalidateQueries({ queryKey: ["chat-keys"] });
        }}
      />
    );
  } else if (keyProblem === "key-required") {
    keyBanner = (
      <KeyNotice
        title="An API key is required"
        body="Select a model above — its API key is selected automatically."
      />
    );
  } else if (!keysPending && chatKeys.length === 0) {
    keyBanner = (
      <KeyNotice
        title="Chat needs an API key"
        body="Create a key to start chatting — or ask your org admin for access."
        actionLabel="Manage API keys"
        onAction={openKeyManagement}
      />
    );
  } else if (keyId && keyModelsError) {
    keyBanner = (
      <KeyNotice
        title="Couldn't load this key's models"
        body="The key list may be stale — retry to refresh it."
        actionLabel="Retry"
        onAction={() => void qc.invalidateQueries({ queryKey: ["chat-key-models", keyId] })}
      />
    );
  } else if (keyId && keyModels !== undefined && keyModels.length === 0) {
    keyBanner = (
      <KeyNotice
        title="This key has no eligible models"
        body="No live models fall under this key's scope. Manage the key or pick another one."
        actionLabel="Manage API keys"
        onAction={openKeyManagement}
      />
    );
  }

  // Model dropdown empty state: explain the key gating instead of pointing
  // at provider setup when the registry itself is fine.
  const keyModelsPending = keyEntries.some((e) => e.pending);
  const keyModelsFailed = keyEntries.filter((e) => e.error);
  const listedTotal = keyEntries.reduce((n, e) => n + (e.models?.length ?? 0), 0);
  let modelEmpty: ReactNode = null;
  if (keysPending || (listedTotal === 0 && keyModelsPending)) {
    modelEmpty = (
      <div className="flex h-[200px] items-center justify-center px-4 text-center text-xs text-zinc-400">
        <span>Loading models…</span>
      </div>
    );
  } else if (chatKeys.length === 0) {
    modelEmpty = (
      <div className="flex h-[200px] flex-col items-center justify-center gap-1.5 px-4 text-center text-xs text-zinc-400">
        <KeyRound className="size-5 opacity-40" />
        <span className="font-medium text-zinc-500 dark:text-zinc-300">No API keys yet</span>
        <span className="text-[11px]">Create a key to start chatting.</span>
        <Button size="sm" onClick={openKeyManagement} className="mt-1 gap-1 text-[11px]">
          <Plus className="size-3.5" />
          Manage API keys
        </Button>
      </div>
    );
  } else if (keyModelsFailed.length > 0 && listedTotal === 0) {
    modelEmpty = (
      <div className="flex h-[200px] flex-col items-center justify-center gap-1.5 px-4 text-center text-xs text-zinc-400">
        <span className="font-medium text-zinc-500 dark:text-zinc-300">Couldn&apos;t load models</span>
        <button
          type="button"
          onClick={() => void qc.invalidateQueries({ queryKey: ["chat-key-models"] })}
          className="font-medium text-tollma-600 underline underline-offset-2 hover:text-tollma-700 dark:text-tollma-400 dark:hover:text-tollma-300"
        >
          Retry
        </button>
      </div>
    );
  } else {
    modelEmpty = (
      <div className="flex h-[200px] flex-col items-center justify-center gap-1.5 px-4 text-center text-xs text-zinc-400">
        <Bot className="size-5 opacity-40" />
        <span className="font-medium text-zinc-500 dark:text-zinc-300">No eligible models</span>
        <span className="text-[11px]">This key has no live models in scope.</span>
        <Button size="sm" onClick={openKeyManagement} className="mt-1 gap-1 text-[11px]">
          <Plus className="size-3.5" />
          Manage API keys
        </Button>
      </div>
    );
  }

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
      {keyBanner}

      <PromptInput
        onSubmit={(event) => {
          event.preventDefault();
          handleSend();
        }}
        status={streaming ? "streaming" : "ready"}
        // Chat-only focus treatment (scoped here — never in globals.css or
        // the shared primitive): text entry is excluded from the global
        // :focus-visible ring, so a subtle container border shift is the
        // only visible focus indicator.
        className="[&:has(textarea:focus-visible)]:border-zinc-400 dark:[&:has(textarea:focus-visible)]:border-zinc-500"
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
        <PromptInputFooter className="flex-wrap pb-2">
          <PromptInputTools>
            <ModelSelectorMenu
              keys={chatKeys}
              keyEntries={keyEntries}
              models={scopedModels}
              open={modelOpen}
              onOpenChange={setModelOpen}
              onSelect={pickKeyModel}
              activeKeyId={keyId}
              activeKeyName={activeKey?.name ?? null}
              activeKeyScope={activeKey?.scope ?? null}
              activeKeyOrgId={activeKey?.org_id ?? null}
              triggerPlaceholder="Select a model to start chatting…"
              emptyContent={modelEmpty}
            />

            {/* Thinking control — hidden entirely unless the model declares reasoning options */}
            {caps.reasoningControl ? (
              <ReasoningControl
                control={caps.reasoningControl}
                value={resolvedReasoning}
                onChange={(level) => {
                  if (modelId) setThinkingLevel(modelId, level);
                }}
              />
            ) : null}

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
                <span className="hidden sm:inline">Stop Generating</span>
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
