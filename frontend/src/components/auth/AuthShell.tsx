"use client";

import type { ReactNode } from "react";
import { Logo } from "@/components/ui/Logo";

export interface AuthShellProps {
  title?: string;
  description: string;
  children: ReactNode;
  testId?: string;
}

/** Standalone auth page frame (forgot/reset) matching the login card look. */
export function AuthShell({ title, description, children, testId }: AuthShellProps) {
  return (
    <main
      className="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-zinc-950 px-4 py-12"
      data-testid={testId}
    >
      <div className="pointer-events-none absolute -top-40 -right-40 size-96 rounded-full bg-violet-600/15 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-40 -left-40 size-96 rounded-full bg-sky-500/15 blur-3xl" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(#27272a_1px,transparent_1px)] [background-size:24px_24px] opacity-30" />

      <div className="relative w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900/90 p-8 shadow-2xl backdrop-blur-[var(--glass-blur)]">
        <div className="mb-6 flex flex-col items-center text-center">
          <Logo size="lg" className="mb-3" />
          {title && <h1 className="text-xl font-bold tracking-tight text-white">{title}</h1>}
          <p className="mt-1 text-xs text-zinc-400">{description}</p>
        </div>
        {children}
      </div>
    </main>
  );
}
