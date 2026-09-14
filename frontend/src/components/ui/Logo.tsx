"use client";

import React from "react";
import { cn } from "@/lib/utils";

interface LogoProps {
  size?: "sm" | "md" | "lg";
  className?: string;
  hideText?: boolean;
}

export function Logo({ size = "md", className, hideText = false }: LogoProps) {
  const badgeClasses = {
    sm: "size-6 text-[10px] rounded-md",
    md: "size-7 text-xs rounded-lg",
    lg: "size-8 text-sm rounded-xl",
  }[size];

  const textClasses = {
    sm: "text-xs",
    md: "text-sm",
    lg: "text-base",
  }[size];

  return (
    <div className={cn("flex items-center gap-2 group", className)}>
      <div
        className={cn(
          "flex items-center justify-center bg-zinc-900 text-white font-black shadow-sm transition-transform group-hover:scale-105 dark:bg-zinc-100 dark:text-zinc-900 shrink-0",
          badgeClasses,
        )}
      >
        T
      </div>
      {!hideText && (
        <span
          className={cn(
            "font-bold tracking-tight text-zinc-900 dark:text-zinc-100",
            textClasses,
          )}
        >
          ToLLma
        </span>
      )}
    </div>
  );
}
