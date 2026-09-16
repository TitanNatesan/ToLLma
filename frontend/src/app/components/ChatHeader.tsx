"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  Download,
  FileJson,
  FileText,
  Layers,
  MoreVertical,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Tooltip,
} from "@/components/ui";
import { useConversation, useConversationMutations, useUsage } from "@/hooks/useChat";
import { useModels, useProviders } from "@/hooks/useRegistry";
import { useChatStore } from "@/store/chat";
import { cn } from "@/lib/utils";
import { fmtCost, fmtTokens } from "@/lib/utils";

export function ChatHeader() {
  const {
    activeConversationId,
    providerId,
    modelId,
    leftSidebarOpen,
    rightSidebarOpen,
    setConversation,
    setLeftSidebar,
    setRightSidebar,
  } = useChatStore();

  const { data: conv } = useConversation(activeConversationId);
  const { data: usage } = useUsage(activeConversationId);
  const { data: providers = [] } = useProviders();
  const { data: models = [] } = useModels();
  const mutations = useConversationMutations();

  const [renaming, setRenaming] = useState(false);
  const [titleInput, setTitleInput] = useState("");

  const activeProvider = providers.find((p) => p.id === providerId);
  const activeModel = models.find((m) => m.id === modelId);

  const title = conv?.title ?? "New conversation";

  function handleStartRename() {
    setTitleInput(title);
    setRenaming(true);
  }

  function handleSaveRename() {
    if (activeConversationId && titleInput.trim()) {
      mutations.rename.mutate({ id: activeConversationId, title: titleInput.trim() });
    }
    setRenaming(false);
  }

  function handleExport(format: "json" | "markdown") {
    if (!conv) {
      toast.error("No conversation to export");
      return;
    }

    let blob: Blob;
    let filename: string;

    if (format === "json") {
      const data = JSON.stringify(conv, null, 2);
      blob = new Blob([data], { type: "application/json" });
      filename = `${conv.title.replace(/\s+/g, "_")}.json`;
    } else {
      const lines = [
        `# ${conv.title}`,
        `*Created: ${new Date(conv.created_at).toLocaleString()}*`,
        "",
        ...(conv.messages ?? []).map((m) => {
          const role = m.role === "user" ? "**User**" : "**Assistant**";
          return `${role}\n\n${m.content}\n\n---`;
        }),
      ];
      blob = new Blob([lines.join("\n\n")], { type: "text/markdown" });
      filename = `${conv.title.replace(/\s+/g, "_")}.md`;
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported conversation as ${format.toUpperCase()}`);
  }

  function handleDelete() {
    if (activeConversationId) {
      mutations.remove.mutate(activeConversationId);
      setConversation(null);
      toast.success("Conversation deleted");
    }
  }

  const costFormatted = fmtCost(usage?.total_cost);

  return (
    <header className="flex h-12 w-full shrink-0 items-center justify-between border-b border-zinc-200 bg-white/80 px-4 backdrop-blur-sm dark:border-zinc-800 dark:bg-zinc-950/80">
      {/* Left: Title & Inline Rename */}
      <div className="flex items-center gap-2 min-w-0 flex-1">
        {!leftSidebarOpen && (
          <Tooltip content="Show sidebar">
            <Button
              size="sm"
              variant="ghost"
              className="h-8 w-8 p-0 -ml-1 text-zinc-500 shrink-0"
              onClick={() => setLeftSidebar(true)}
              aria-label="Open sidebar"
              data-testid="left-sidebar-toggle"
            >
              <PanelLeftOpen className="size-4" />
            </Button>
          </Tooltip>
        )}
        {renaming ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSaveRename();
            }}
            className="flex items-center gap-1.5"
          >
            <input
              type="text"
              value={titleInput}
              onChange={(e) => setTitleInput(e.target.value)}
              onBlur={handleSaveRename}
              onKeyDown={(e) => e.key === "Escape" && setRenaming(false)}
              autoFocus
              className="h-7 rounded border border-zinc-300 bg-white px-2 text-xs font-semibold text-zinc-900 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            />
          </form>
        ) : (
          <button
            onClick={handleStartRename}
            className="group flex items-center gap-1.5 truncate text-left text-xs font-semibold text-zinc-900 transition-colors hover:text-zinc-600 dark:text-zinc-100 dark:hover:text-zinc-300"
            title="Click to rename conversation"
          >
            <span className="truncate max-w-[200px] sm:max-w-xs md:max-w-md">{title}</span>
            <Pencil className="size-3 opacity-0 text-zinc-400 group-hover:opacity-100 transition-opacity" />
          </button>
        )}

        {/* Model & Provider Badges in Header */}
        <div className="hidden sm:flex items-center gap-1.5 ml-2">
          {activeModel && (
            <Badge variant="secondary" className="gap-1 text-[10px] font-medium font-mono">
              <Sparkles className="size-2.5 text-zinc-400" />
              <span>{activeModel.name}</span>
            </Badge>
          )}
          {activeProvider && (
            <Badge variant="outline" className="text-[10px] text-zinc-400 font-normal">
              {activeProvider.name}
            </Badge>
          )}
        </div>
      </div>

      {/* Right: Metrics & Actions */}
      <div className="flex items-center gap-2 shrink-0">
        {/* Telemetry Stats */}
        {usage && usage.total_tokens > 0 && (
          <div className="hidden md:flex items-center gap-3 text-xs text-zinc-500 font-mono pr-2 border-r border-zinc-200 dark:border-zinc-800">
            <span title="Total tokens used in this conversation">
              {fmtTokens(usage.total_tokens)} tok
            </span>
            <span title="Total estimated cost" className="text-tollma-600 dark:text-tollma-400 font-semibold">
              {costFormatted}
            </span>
          </div>
        )}

        {/* Action Controls */}
        <div className="flex items-center gap-1">
          <Tooltip content="Start new conversation">
            <Button
              size="sm"
              variant="ghost"
              className="h-8 w-8 p-0"
              onClick={() => setConversation(null)}
              aria-label="New chat"
            >
              <Plus className="size-3.5 text-zinc-500" />
            </Button>
          </Tooltip>

          {/* Export & Manage Dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost" className="h-8 w-8 p-0" aria-label="More actions">
                <MoreVertical className="size-3.5 text-zinc-500" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44 p-1 text-xs shadow-lg">
              <DropdownMenuItem onClick={handleStartRename} className="gap-2">
                <Pencil className="size-3.5 text-zinc-400" />
                <span>Rename Chat</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleExport("markdown")} className="gap-2">
                <FileText className="size-3.5 text-zinc-400" />
                <span>Export as Markdown</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleExport("json")} className="gap-2">
                <FileJson className="size-3.5 text-zinc-400" />
                <span>Export as JSON</span>
              </DropdownMenuItem>
              {activeConversationId && (
                <DropdownMenuItem
                  onClick={handleDelete}
                  className="gap-2 text-red-600 dark:text-red-400 focus:text-red-600 dark:focus:text-red-400"
                >
                  <Trash2 className="size-3.5" />
                  <span>Delete Chat</span>
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Open Intelligence Panel (only shown when panel is closed) */}
          {!rightSidebarOpen && (
            <Tooltip content="Show Intelligence">
              <Button
                size="sm"
                variant="ghost"
                className="h-8 w-8 p-0 ml-0.5 text-zinc-500"
                onClick={() => setRightSidebar(true)}
                aria-label="Show intelligence panel"
                data-testid="right-sidebar-toggle"
              >
                <PanelRightOpen className="size-4" />
              </Button>
            </Tooltip>
          )}
        </div>
      </div>
    </header>
  );
}
