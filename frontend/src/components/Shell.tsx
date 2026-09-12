"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { QueryProvider } from "@/lib/query";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Chat" },
  { href: "/providers", label: "Providers" },
  { href: "/models", label: "Models" },
  { href: "/conversations", label: "Conversations" },
  { href: "/settings", label: "Settings" },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  return (
    <QueryProvider>
      <header className="flex items-center gap-6 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <Link href="/" className="text-lg font-bold">
          ToLLms
        </Link>
        <nav className="flex gap-1" aria-label="Main">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800",
                path === n.href && "bg-zinc-100 font-medium dark:bg-zinc-800",
              )}
            >
              {n.label}
            </Link>
          ))}
        </nav>
      </header>
      {children}
    </QueryProvider>
  );
}
