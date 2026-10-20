"use client";

import { useEffect, useId, useMemo, useRef, useState, type ComponentType, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useChatStore } from "@/store/chat";
import { Badge, Button } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { AIModel, ChatKey } from "@/types";
import type { KeyModelsEntry } from "@/hooks/useChatKeys";
import {
  Bot,
  Brain,
  ChevronDown,
  Eye,
  Image as ImageIcon,
  KeyRound,
  Mic,
  Plus,
  Search,
  Wrench,
  Zap,
} from "lucide-react";

const CAP_ICONS: Record<string, { icon: ComponentType<{ className?: string }>; label: string }> = {
  supports_vision: { icon: Eye, label: "Vision" },
  supports_reasoning: { icon: Brain, label: "Reasoning" },
  supports_tool_calling: { icon: Wrench, label: "Tool calling" },
  supports_streaming: { icon: Zap, label: "Streaming" },
  supports_audio_input: { icon: Mic, label: "Audio input" },
  supports_image_generation: { icon: ImageIcon, label: "Image generation" },
};

interface ModelSelectorMenuProps {
  /** Eligible keys to group by (order preserved). */
  keys: ChatKey[];
  /** Per-key servable models (same key ids). */
  keyEntries: KeyModelsEntry[];
  /** Full registry rows for display (capabilities/pricing). */
  models: AIModel[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Single pick sets key + provider + model together. */
  onSelect: (keyId: string, model: AIModel) => void;
  /** Key name for the trigger chip. */
  activeKeyName?: string | null;
  /** Key scope for the trigger badge + add-provider fallback routing. */
  activeKeyScope?: "personal" | "organization" | null;
  /** Org id for the add-provider fallback (org keys only). */
  activeKeyOrgId?: string | null;
  /** Placeholder when nothing is selected. */
  triggerPlaceholder?: string;
  /** Empty-state override. */
  emptyContent?: ReactNode;
}

interface PanelPos {
  left: number;
  top?: number;
  bottom?: number;
  width: number;
}

/**
 * Key-grouped model picker without any Radix menu layer.
 *
 * The old DropdownMenu sat between wheel input and the list (modal
 * RemoveScroll, roving focus, collision layers), making the list
 * unscrollable. This is a plain fixed-position div with a native
 * overflow-y-auto scroll container — zero JS scroll handling, so wheel
 * events provably reach the list.
 */
export function ModelSelectorMenu({
  keys: _keys,
  keyEntries,
  models,
  open,
  onOpenChange,
  onSelect,
  activeKeyName,
  activeKeyScope,
  activeKeyOrgId,
  triggerPlaceholder,
  emptyContent,
}: ModelSelectorMenuProps) {
  const { modelId, setAddProviderOpen } = useChatStore();
  const [search, setSearch] = useState("");
  const router = useRouter();
  const uid = useId();
  const panelId = `${uid}-panel`;

  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelPos, setPanelPos] = useState<PanelPos | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const activeModel = models.find((m) => m.id === modelId);

  const caps = activeModel
    ? Object.entries(CAP_ICONS)
        .filter(([k]) => (activeModel as unknown as Record<string, boolean>)[k])
        .map(([, item]) => item)
    : [];

  const q = search.trim().toLowerCase();
  const byId = useMemo(() => new Map(models.map((m) => [m.id, m])), [models]);

  const groups = keyEntries
    .map((entry) => {
      // Join key-eligible ids with full registry rows for display.
      const seen = new Set<string>();
      const kModels: AIModel[] = [];
      for (const km of entry.models ?? []) {
        if (seen.has(km.id)) continue;
        seen.add(km.id);
        // Join with the personal registry row when present, else fall back
        // to the key's own full ModelRead row: org-only models have no
        // personal registry row and must not be dropped from the union.
        const full = byId.get(km.id) ?? km;
        if (!full.is_active) continue;
        if (
          q &&
          !full.name.toLowerCase().includes(q) &&
          !full.model_id.toLowerCase().includes(q) &&
          !entry.key.name.toLowerCase().includes(q)
        )
          continue;
        kModels.push(full);
      }
      return { key: entry.key, models: kModels };
    })
    .filter((g) => g.models.length > 0 || (q && g.key.name.toLowerCase().includes(q)));

  const totalMatchingModels = groups.reduce((acc, g) => acc + g.models.length, 0);
  // No servable models under any key (not just no search hit): point at key
  // management instead of a dead end.
  const registryEmpty = groups.every((g) => g.models.length === 0) && !q;

  // Flat option order matches render order (group by group).
  const flat = useMemo(
    () => groups.flatMap((g) => g.models.map((model) => ({ keyId: g.key.id, model }))),
    [groups],
  );
  const clampedIndex = flat.length === 0 ? 0 : Math.min(activeIndex, flat.length - 1);
  const activeOpt = flat[clampedIndex];
  const activeDescendantId = activeOpt ? `${uid}-opt-${activeOpt.keyId}-${activeOpt.model.id}` : undefined;

  // Reset the keyboard index when the search filter changes the list
  // (render-phase adjustment: derived from q, not an external sync).
  const [prevQ, setPrevQ] = useState(q);
  if (prevQ !== q) {
    setPrevQ(q);
    setActiveIndex(0);
  }

  // Position the fixed panel from the trigger rect: align start, open above
  // when space below is short, recompute on window resize while open.
  // (Deferred to rAF: measuring the trigger rect is external-DOM sync, so
  // placement lands in a callback rather than as a sync setState in effect.)
  useEffect(() => {
    if (!open) return;
    function place() {
      const el = triggerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const width = Math.min(320, window.innerWidth - 32);
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
      const need = Math.min(window.innerHeight * 0.6, 560) + 70;
      const spaceBelow = window.innerHeight - rect.bottom;
      if (spaceBelow < need) {
        setPanelPos({ left, bottom: window.innerHeight - rect.top + 4, width });
      } else {
        setPanelPos({ left, top: rect.bottom + 4, width });
      }
    }
    const raf = requestAnimationFrame(place);
    window.addEventListener("resize", place);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", place);
    };
  }, [open ]);

  // Close on Escape or outside pointerdown.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onOpenChange(false);
    }
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node | null;
      if (!target) return;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      onOpenChange(false);
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open, onOpenChange]);

  // Return focus to the trigger on close.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !open) triggerRef.current?.focus();
    wasOpen.current = open;
  }, [open ]);

  function select(keyId: string, model: AIModel) {
    onSelect(keyId, model);
    onOpenChange(false);
  }

  function handleAddProvider() {
    // The wizard modal lives on the providers page: navigate there first,
    // then open it (same pattern as the command palette's Add Provider).
    // Org keys land on the org providers section instead — the personal
    // wizard must never see org credentials.
    onOpenChange(false);
    if (activeKeyScope === "organization" && activeKeyOrgId) {
      router.push(`/organizations/${activeKeyOrgId}?section=providers`);
      return;
    }
    router.push("/providers");
    setAddProviderOpen(true);
  }

  function onPanelKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Home" || e.key === "End") {
      if (flat.length === 0) return;
      e.preventDefault();
      let next = clampedIndex;
      if (e.key === "ArrowDown") next = Math.min(clampedIndex + 1, flat.length - 1);
      else if (e.key === "ArrowUp") next = Math.max(clampedIndex - 1, 0);
      else if (e.key === "Home") next = 0;
      else next = flat.length - 1;
      setActiveIndex(next);
      // Options are all rendered, so the node exists: scroll it into view.
      // preventDefault above also cancels button Enter-click activation.
      const opt = flat[next];
      if (opt) document.getElementById(`${uid}-opt-${opt.keyId}-${opt.model.id}`)?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      if (activeOpt) {
        e.preventDefault();
        select(activeOpt.keyId, activeOpt.model);
      }
    }
  }

  // Tabbing out of the panel orphans it (no focus trap by design): close
  // when focus leaves both the panel and the trigger.
  function onPanelFocusOut(e: React.FocusEvent) {
    const next = e.relatedTarget as Node | null;
    if (next && (panelRef.current?.contains(next) || triggerRef.current?.contains(next))) return;
    onOpenChange(false);
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={cn(
          "flex h-7 items-center gap-1.5 rounded-md px-2 text-xs transition-colors",
          "border border-zinc-200 hover:border-zinc-300 hover:bg-zinc-50",
          "dark:border-zinc-700 dark:hover:border-zinc-600 dark:hover:bg-zinc-800",
          !activeModel && "text-zinc-400",
        )}
        data-testid="model-selector"
        aria-label="Select model"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => onOpenChange(!open)}
      >
        <Bot className="size-3 text-zinc-500" />
        <span className="max-w-44 truncate font-medium">
          {activeModel ? activeModel.name : (triggerPlaceholder ?? "Select model")}
        </span>
        {activeKeyName && (
          <span className="hidden sm:inline-flex rounded bg-zinc-100 dark:bg-zinc-800 px-1 py-0.2 text-[9px] text-zinc-500 dark:text-zinc-400 font-normal">
            <KeyRound className="mr-0.5 size-2.5 self-center" />
            {activeKeyName}
          </span>
        )}
        {activeKeyScope && (
          <Badge
            variant="outline"
            className="hidden text-[9px] px-1 py-0 font-normal sm:inline-flex"
            data-testid="model-selector-key-scope"
          >
            {activeKeyScope === "organization" ? "Org" : "Personal"}
          </Badge>
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

      {open && panelPos && (
        <div
          ref={panelRef}
          id={panelId}
          className="fixed z-50 rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-zinc-800 dark:bg-zinc-950"
          style={{ left: panelPos.left, top: panelPos.top, bottom: panelPos.bottom, width: panelPos.width }}
          onKeyDown={onPanelKeyDown}
          onBlur={onPanelFocusOut}
        >
          {/* Search input */}
          <div className="border-b border-zinc-200 p-2 dark:border-zinc-800">
            <div className="relative flex items-center">
              <Search className="absolute left-2 size-3.5 text-zinc-400 pointer-events-none" />
              <input
                type="text"
                placeholder="Search models or keys…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-7 w-full rounded border border-zinc-200 bg-transparent pl-7 pr-2 text-xs outline-none focus:border-zinc-400 dark:border-zinc-700 dark:focus:border-zinc-500"
                autoFocus
              />
            </div>
          </div>

          {/* Scrollable list: plain div with INLINE constraints so no
              cascade, merge, or specificity trap can un-cap it again.
              Native wheel provably reaches a bare overflow div. */}
          <div
            role="listbox"
            aria-label="Models"
            aria-activedescendant={activeDescendantId}
            className="overscroll-contain p-1.5"
            style={{ minHeight: 200, maxHeight: 400, overflowY: "auto", overscrollBehavior: "contain" }}
          >
            {totalMatchingModels === 0 ? (emptyContent ?? (
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
            )) : (
              groups.map(({ key, models: kModels }) => (
                <div key={key.id} className="mb-2 last:mb-0">
                  {/* Key group header */}
                  <div className="sticky top-0 z-10 flex items-center justify-between rounded bg-zinc-100/95 px-2 py-1 text-[11px] font-semibold text-zinc-600 backdrop-blur-sm dark:bg-zinc-900/95 dark:text-zinc-400">
                    <span className="flex items-center gap-1.5 truncate" title={key.scope === "organization" && key.org_name ? `${key.name} · ${key.org_name}` : key.name}>
                      <KeyRound className="size-3 text-zinc-400" />
                      <span className="truncate">{key.name}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1">
                      <Badge variant="outline" className="text-[9px] px-1 py-0 font-normal">
                        {key.scope === "organization" ? "Org" : "Personal"}
                      </Badge>
                      <span className="text-[10px] font-normal text-zinc-400">
                        {kModels.length} model{kModels.length === 1 ? "" : "s"}
                      </span>
                    </span>
                  </div>

                  {/* Models servable under this key */}
                  <div className="mt-0.5 space-y-0.5">
                    {kModels.map((m) => {
                      const isSelected = modelId === m.id;
                      const mCaps = Object.entries(CAP_ICONS)
                        .filter(([k]) => (m as unknown as Record<string, boolean>)[k])
                        .map(([, item]) => item);

                      return (
                        <button
                          key={`${key.id}:${m.id}`}
                          id={`${uid}-opt-${key.id}-${m.id}`}
                          type="button"
                          role="option"
                          aria-selected={isSelected}
                          onClick={() => select(key.id, m)}
                          data-testid={`model-option-${m.id}`}
                          className={cn(
                            "flex w-full cursor-pointer items-center justify-between rounded px-2 py-1.5 text-left text-xs transition-colors focus:outline-none focus-visible:outline-none",
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
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </>
  );
}
