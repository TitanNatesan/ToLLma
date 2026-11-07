"use client";

import Image from "next/image";
import { cn } from "@/lib/utils";

interface LogoProps {
  size?: "sm" | "md" | "lg";
  className?: string;
  hideText?: boolean;
}

const markSizes = {
  sm: { box: "size-6", px: 24 },
  md: { box: "size-7", px: 28 },
  lg: { box: "size-8", px: 32 },
} as const;

const textClasses = {
  sm: "text-xs",
  md: "text-sm",
  lg: "text-base",
} as const;

/** ToLLma maze mark: light surface shows the black mark, dark the white mark. */
export function ToLLmaMark({
  size = "md",
  className,
}: {
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const mark = markSizes[size];
  return (
    <span
      className={cn(
        "relative block shrink-0 overflow-hidden shadow-sm transition-transform group-hover:scale-105",
        mark.box,
        className,
      )}
    >
      <Image
        src="/tollma-light.png"
        alt="ToLLma logo"
        width={mark.px}
        height={mark.px}
        className="size-full dark:hidden"
      />
      <Image
        src="/tollma-dark.png"
        alt=""
        aria-hidden
        width={mark.px}
        height={mark.px}
        className="hidden size-full dark:block"
      />
    </span>
  );
}

export function Logo({ size = "md", className, hideText = false }: LogoProps) {
  return (
    <div className={cn("flex items-center gap-2 group", className)}>
      <ToLLmaMark size={size} />
      {!hideText && (
        <span
          className={cn(
            "font-bold tracking-tight text-zinc-900 dark:text-zinc-100",
            textClasses[size],
          )}
        >
          ToLLma
        </span>
      )}
    </div>
  );
}
