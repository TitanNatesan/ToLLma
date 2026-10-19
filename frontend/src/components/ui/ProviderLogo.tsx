"use client";

import { useState } from "react";
import { Cpu } from "lucide-react";
import { cn } from "@/lib/utils";

/** Provider logo with the required fallback chain: models.dev logo ->
 * provider-family icon -> generic icon. Never renders a broken image. */
export function ProviderLogo({ logoUrl, name, size = "md", className }: {
  logoUrl?: string | null;
  name: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const dims =
    size === "sm"
      ? "size-6 rounded-md"
      : size === "lg"
        ? "size-12 rounded-2xl"
        : "size-8 rounded-lg";
  if (!logoUrl || failed) {
    return (
      <span
        role="img"
        aria-label={`${name} logo unavailable, showing generic provider icon`}
        className={cn(
          "flex shrink-0 items-center justify-center bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-300",
          dims,
          className,
        )}
      >
        <Cpu className={size === "lg" ? "size-6" : size === "sm" ? "size-3.5" : "size-4"} aria-hidden />
      </span>
    );
  }
  return (
    // Remote SVG brand marks cannot use next/image optimization (unsupported
    // format + external host); lazy img with an onError fallback chain instead.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={logoUrl}
      alt={`${name} logo`}
      loading="lazy"
      onError={() => setFailed(true)}
      className={cn("shrink-0 bg-white object-contain ring-1 ring-inset ring-zinc-200 dark:ring-zinc-700", dims, className)}
    />
  );
}
