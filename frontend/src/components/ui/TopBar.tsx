"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Command as CmdIcon,
  Cpu,
  MessageSquare,
  Moon,
  Search,
  Settings,
  Sun,
} from "lucide-react";
import { cn } from "@/lib/utils";

export function TopBar({ onOpenCommandPalette }: { onOpenCommandPalette?: () => void }) {
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  const [isDark, setIsDark] = useState(true);

  useEffect(() => {
    setMounted(true);
    const isDarkTheme =
      document.documentElement.classList.contains("dark") ||
      (!("theme" in localStorage) && window.matchMedia("(prefers-color-scheme: dark)").matches) ||
      localStorage.getItem("theme") === "dark";
    setIsDark(isDarkTheme);
  }, []);

  const toggleTheme = () => {
    setIsDark((prev) => {
      const next = !prev;
      if (next) {
        document.documentElement.classList.add("dark");
        localStorage.setItem("theme", "dark");
      } else {
        document.documentElement.classList.remove("dark");
        localStorage.setItem("theme", "light");
      }
      return next;
    });
  };

  // (Repository sync runs on the server scheduler; no manual trigger in the UI.)

  const navItems = [
    { href: "/", label: "Chat", icon: MessageSquare },
    { href: "/providers", label: "Providers", icon: Cpu },
  ];

  const futureItems = [
    { label: "Analytics", icon: BarChart3, badge: "Soon" },
    { label: "Settings", icon: Settings, badge: "Soon" },
  ];

  return (
    <header
      className="sticky top-0 z-30 flex h-12 w-full shrink-0 items-center justify-between border-b border-zinc-200 bg-white/95 px-3 backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-950/95"
      data-testid="top-navigation"
    >
      {/* Left section: Logo + Primary Views */}
      <div className="flex items-center gap-4">
        <Link
          href="/"
          className="flex items-center gap-2 group"
          data-testid="app-logo"
        >
          <div className="flex size-7 items-center justify-center rounded-lg bg-zinc-900 text-white font-black text-xs shadow-sm transition-transform group-hover:scale-105 dark:bg-zinc-100 dark:text-zinc-900">
            T
          </div>
          <span className="font-bold text-sm tracking-tight text-zinc-900 dark:text-zinc-100">
            ToLLma
          </span>
        </Link>

        {/* View switcher tabs */}
        <nav className="flex items-center gap-1 border-l border-zinc-200 pl-3 dark:border-zinc-800" aria-label="Main navigation">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
                  isActive
                    ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100 font-semibold"
                    : "text-zinc-500 hover:bg-zinc-50 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100",
                )}
                data-testid={`nav-item-${item.label.toLowerCase()}`}
              >
                <Icon className="size-3.5" />
                <span>{item.label}</span>
              </Link>
            );
          })}

          {futureItems.map((item) => {
            const Icon = item.icon;
            return (
              <div
                key={item.label}
                className="hidden md:flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-zinc-400 cursor-not-allowed select-none"
                title={`${item.label} - Coming Soon`}
              >
                <Icon className="size-3.5 opacity-60" />
                <span>{item.label}</span>
                <span className="rounded bg-zinc-100 dark:bg-zinc-800 px-1 py-0.2 text-[9px] text-zinc-500 font-normal">
                  {item.badge}
                </span>
              </div>
            );
          })}
        </nav>
      </div>

      {/* Right section: Command Palette, Theme */}
      <div className="flex items-center gap-1.5 sm:gap-2">
        {/* Command Palette button */}
        <button
          onClick={onOpenCommandPalette}
          className="flex items-center gap-1.5 rounded-md border border-zinc-200 bg-zinc-50/50 px-2 py-1 text-xs text-zinc-500 transition-colors hover:border-zinc-300 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900/50 dark:text-zinc-400 dark:hover:border-zinc-700 dark:hover:bg-zinc-800"
          data-testid="topbar-command-palette-btn"
          title="Open Command Palette (Ctrl+K)"
        >
          <Search className="size-3 text-zinc-400" />
          <span className="hidden md:inline text-[11px]">Commands</span>
          <kbd className="hidden sm:inline-flex items-center gap-0.5 rounded border border-zinc-200 bg-zinc-100 px-1 text-[9px] font-mono text-zinc-500 dark:border-zinc-800 dark:bg-zinc-800 dark:text-zinc-400">
            <CmdIcon className="size-2.5" /> K
          </kbd>
        </button>

        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          className="flex size-7 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          data-testid="theme-toggle-btn"
          aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
        >
          {mounted ? (isDark ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />) : <span className="size-3.5" />}
        </button>
      </div>
    </header>
  );
}
