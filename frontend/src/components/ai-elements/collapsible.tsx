"use client";

import * as CollapsiblePrimitive from "@radix-ui/react-collapsible";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export const Collapsible = CollapsiblePrimitive.Root;

export function CollapsibleTrigger({
  className,
  ...props
}: ComponentProps<typeof CollapsiblePrimitive.Trigger>) {
  return (
    <CollapsiblePrimitive.Trigger
      className={cn("group/collapsible cursor-pointer", className)}
      {...props}
    />
  );
}

export function CollapsibleContent({
  className,
  ...props
}: ComponentProps<typeof CollapsiblePrimitive.Content>) {
  return (
    <CollapsiblePrimitive.Content className={cn("overflow-hidden", className)} {...props} />
  );
}
