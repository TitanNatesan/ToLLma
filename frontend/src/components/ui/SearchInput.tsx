"use client";

import React, { forwardRef } from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SearchInputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  onClear?: () => void;
  shortcut?: string;
}

export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(
  ({ className, value, onChange, onClear, shortcut, ...props }, ref) => {
    return (
      <div className={cn("relative flex items-center w-full", className)}>
        <Search className="absolute left-2.5 size-3.5 text-zinc-400 pointer-events-none" />
        <input
          ref={ref}
          type="text"
          value={value}
          onChange={onChange}
          className={cn(
            "h-8 w-full rounded-md border border-zinc-200 bg-zinc-50/50 pl-8 pr-7 text-xs transition-colors",
            "placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none dark:border-zinc-800 dark:bg-zinc-900/60 dark:focus:border-zinc-500",
          )}
          {...props}
        />
        {value && onClear ? (
          <button
            type="button"
            onClick={onClear}
            className="absolute right-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
            aria-label="Clear search"
          >
            <X className="size-3" />
          </button>
        ) : shortcut ? (
          <kbd className="absolute right-2 rounded border border-zinc-200 bg-zinc-100 px-1 text-[9px] text-zinc-500 font-mono dark:border-zinc-800 dark:bg-zinc-800 dark:text-zinc-400 pointer-events-none">
            {shortcut}
          </kbd>
        ) : null}
      </div>
    );
  },
);

SearchInput.displayName = "SearchInput";
