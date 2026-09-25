"use client";

import { Boxes, Clapperboard, Image, MessagesSquare, MessageSquareText, Reply } from "lucide-react";
import { Badge } from "@/components/ui";

/** Gateway endpoints a key may call. Display-only: nothing here is enforced yet. */
export interface EndpointPermission {
  id: string;
  label: string;
  path: string;
  description: string;
}

export const ENDPOINT_PERMISSIONS: readonly EndpointPermission[] = [
  {
    id: "chat",
    label: "Chat Completions",
    path: "POST /v1/chat/completions",
    description: "OpenAI-compatible chat completions.",
  },
  {
    id: "responses",
    label: "Responses",
    path: "POST /v1/responses",
    description: "Stateful response chains with tool use.",
  },
  {
    id: "messages",
    label: "Messages",
    path: "POST /v1/messages",
    description: "Anthropic-compatible message batches.",
  },
  {
    id: "images",
    label: "Images",
    path: "/v1/images/*",
    description: "Image generation and edits.",
  },
  {
    id: "videos",
    label: "Videos",
    path: "/v1/videos/*",
    description: "Video generation and edits.",
  },
  {
    id: "models",
    label: "Models",
    path: "GET /v1/models",
    description: "List models visible to this key.",
  },
];

const ENDPOINT_ICON = {
  chat: MessageSquareText,
  responses: Reply,
  messages: MessagesSquare,
  images: Image,
  videos: Clapperboard,
  models: Boxes,
} as const;

/**
 * Display-only endpoint access list for the key edit drawer.
 *
 * Rendered as a fixed reference table (every endpoint "Allowed") so teams can
 * see the future permission surface; enforcement lands separately.
 */
export function EndpointPermissions({ testId = "endpoint-permissions" }: { testId?: string }) {
  return (
    <div className="space-y-2" data-testid={testId}>
      <ul className="divide-y divide-zinc-100 overflow-hidden rounded-lg border border-zinc-200/80 dark:divide-zinc-800/80 dark:border-zinc-800/80">
        {ENDPOINT_PERMISSIONS.map((endpoint) => {
          const Icon = ENDPOINT_ICON[endpoint.id as keyof typeof ENDPOINT_ICON] ?? Boxes;
          return (
            <li
              key={endpoint.id}
              className="flex items-center gap-2.5 bg-white px-3 py-2 transition-colors hover:bg-zinc-50/80 dark:bg-zinc-950 dark:hover:bg-zinc-900/60"
            >
              <span className="flex size-6 shrink-0 items-center justify-center rounded-md border border-zinc-200 bg-zinc-50 text-zinc-400 dark:border-zinc-800 dark:bg-zinc-900">
                <Icon className="size-3" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  {endpoint.label}
                </span>
                <span className="block truncate font-mono text-[10px] text-zinc-400">
                  {endpoint.path} · {endpoint.description}
                </span>
              </span>
              <Badge variant="secondary" className="shrink-0 text-[10px]">
                Allowed
              </Badge>
            </li>
          );
        })}
      </ul>
      <p className="text-[10px] leading-relaxed text-zinc-400">
        Endpoint permissions are shown for reference only and are not enforced yet — this key can
        call every endpoint above.
      </p>
    </div>
  );
}
