"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/docs", slug: "overview", label: "Overview", blurb: "Quickstart" },
  { href: "/docs/authentication", slug: "authentication", label: "Authentication", blurb: "Keys, headers, budgets" },
  { href: "/docs/openai", slug: "openai", label: "OpenAI Compatible", blurb: "Chat, models, streaming" },
  { href: "/docs/anthropic", slug: "anthropic", label: "Anthropic Compatible", blurb: "Messages API" },
  { href: "/docs/advanced", slug: "advanced", label: "Responses, Media & Limits", blurb: "Responses, images, video" },
];

/** Section sidebar for the docs: route links with active highlighting. */
export function DocsNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Documentation sections"
      data-testid="docs-nav"
      className="flex shrink-0 gap-1 overflow-x-auto md:sticky md:top-4 md:w-52 md:flex-col md:self-start md:overflow-visible"
    >
      {ITEMS.map((item) => {
        const active = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            data-testid={`docs-nav-${item.slug}`}
            className={cn(
              "min-w-36 flex-1 rounded-lg border px-3 py-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tollma-500/60 md:min-w-0",
              active
                ? "border-tollma-500/40 bg-tollma-50 dark:bg-tollma-950/30"
                : "border-transparent hover:border-zinc-200 hover:bg-zinc-50 dark:hover:border-zinc-800 dark:hover:bg-zinc-900/60",
            )}
          >
            <span
              className={cn(
                "block text-xs font-semibold",
                active
                  ? "text-tollma-700 dark:text-tollma-300"
                  : "text-zinc-700 dark:text-zinc-200",
              )}
            >
              {item.label}
            </span>
            <span className="block truncate text-[10px] text-zinc-400">{item.blurb}</span>
          </Link>
        );
      })}
    </nav>
  );
}
