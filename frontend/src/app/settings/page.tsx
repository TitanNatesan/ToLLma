"use client";

import { useState } from "react";
import { Moon, Sun } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/ui";
import { cn } from "@/lib/utils";

function ThemeToggle() {
  const [isDark, setIsDark] = useState<boolean>(() => {
    if (typeof document === "undefined") return true;
    return document.documentElement.classList.contains("dark");
  });

  const setTheme = (dark: boolean) => {
    document.documentElement.classList.toggle("dark", dark);
    try {
      localStorage.setItem("theme", dark ? "dark" : "light");
    } catch {
      // storage unavailable
    }
    setIsDark(dark);
  };

  return (
    <div
      className="flex items-center gap-1 rounded-lg border border-zinc-200 p-1 dark:border-zinc-800"
      data-testid="settings-theme-toggle"
    >
      <button
        onClick={() => setTheme(false)}
        aria-pressed={!isDark}
        className={cn(
          "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
          !isDark
            ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
            : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100",
        )}
      >
        <Sun className="size-3.5" />
        <span>Light</span>
      </button>
      <button
        onClick={() => setTheme(true)}
        aria-pressed={isDark}
        className={cn(
          "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
          isDark
            ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
            : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100",
        )}
      >
        <Moon className="size-3.5" />
        <span>Dark</span>
      </button>
    </div>
  );
}

/** Settings landing page. Sections are anchored for sidebar shortcuts. */
export default function SettingsPage() {
  return (
    <main
      className="flex min-w-0 flex-1 flex-col overflow-y-auto bg-white px-4 py-4 dark:bg-zinc-950"
      data-testid="settings-page"
    >
      <PageHeader title="Settings" subtitle="Workspace preferences and account configuration." />
      <div className="mt-4 flex flex-col gap-4 pb-8">
        <section id="general" className="scroll-mt-4">
          <EmptyState
            title="General"
            description="Workspace defaults and language preferences. Coming soon."
            testId="settings-section-general"
          />
        </section>
        <section id="appearance" className="scroll-mt-4">
          <div className="m-auto flex max-w-sm flex-col items-center justify-center p-6 text-center">
            <h3 className="text-base font-semibold text-zinc-800 dark:text-zinc-200">
              Appearance
            </h3>
            <p className="mt-1 text-sm text-zinc-500">
              Choose the interface theme. More display options coming soon.
            </p>
            <div className="mt-3">
              <ThemeToggle />
            </div>
          </div>
        </section>
        <section id="providers" className="scroll-mt-4">
          <EmptyState
            title="Providers"
            description="Manage providers from the Providers page. Default provider selection coming soon."
            testId="settings-section-providers"
          />
        </section>
        <section id="authentication" className="scroll-mt-4">
          <EmptyState
            title="Authentication"
            description="Sessions, API keys, and connected accounts. Coming soon."
            testId="settings-section-authentication"
          />
        </section>
      </div>
    </main>
  );
}
