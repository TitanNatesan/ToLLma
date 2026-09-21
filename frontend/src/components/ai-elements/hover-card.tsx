"use client";

import * as HoverCardPrimitive from "@radix-ui/react-hover-card";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export const HoverCard = HoverCardPrimitive.Root;
export const HoverCardTrigger = HoverCardPrimitive.Trigger;
export const HoverCardPortal = HoverCardPrimitive.Portal;

export function HoverCardContent({
  className,
  align = "center",
  sideOffset = 6,
  ...props
}: ComponentProps<typeof HoverCardPrimitive.Content>) {
  return (
    <HoverCardPrimitive.Portal>
      <HoverCardPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "z-50 w-80 rounded-xl border border-zinc-200 bg-white p-3 text-xs shadow-lg outline-none",
          "dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100",
          className,
        )}
        {...props}
      />
    </HoverCardPrimitive.Portal>
  );
}
