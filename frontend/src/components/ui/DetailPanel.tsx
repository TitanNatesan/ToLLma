"use client";

import type { ReactNode } from "react";
import { X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

export interface DetailPanelProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  width?: number | string;
  className?: string;
  testId?: string;
}

export function DetailPanel({
  open,
  onClose,
  title,
  subtitle,
  children,
  actions,
  width = 380,
  className,
  testId,
}: DetailPanelProps) {
  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          initial={{ x: "100%", opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: "100%", opacity: 0 }}
          transition={{ type: "spring", damping: 25, stiffness: 300 }}
          style={{ width }}
          className={cn(
            "fixed inset-y-0 right-0 z-40 flex flex-col border-l border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950",
            className,
          )}
          data-testid={testId}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
            <div className="flex flex-col gap-0.5 truncate pr-2">
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                {title}
              </h2>
              {subtitle && (
                <div className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                  {subtitle}
                </div>
              )}
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {actions}
              <button
                type="button"
                onClick={onClose}
                className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                aria-label="Close panel"
              >
                <X className="size-4" />
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-4">{children}</div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
