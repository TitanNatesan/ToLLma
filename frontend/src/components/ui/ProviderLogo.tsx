"use client";

import { useState } from "react";
import { Cpu } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Official marks vendored under /public/providers (no hotlinking), keyed by
 * models.dev logo slug — the same slugs the backend catalog serves.
 * OpenAI is absent: openai.com blocks automated downloads, so it stays on the
 * remote models.dev file. "Custom" has no brand: generic icon only.
 */
const LOCAL_LOGOS: Record<string, string> = {
  anthropic: "/providers/anthropic.svg",
  google: "/providers/gemini.svg",
  "google-vertex": "/providers/vertex.png",
  "amazon-bedrock": "/providers/bedrock.png",
};

/** models.dev logo URL -> vendored official mark, when we carry that brand. */
export function localLogoForUrl(logoUrl: string | null | undefined): string | null {
  if (!logoUrl) return null;
  const slug = /models\.dev\/logos\/([\w-]+)\.svg/i.exec(logoUrl)?.[1];
  return (slug && LOCAL_LOGOS[slug]) ?? null;
}

/** Provider logo with the required fallback chain: vendored official mark ->
 * remote logo_url -> generic icon. Never renders a broken image. */
export function ProviderLogo({ logoUrl, name, size = "md", className }: {
  logoUrl?: string | null;
  name: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const candidates = [localLogoForUrl(logoUrl), logoUrl].filter(
    (u): u is string => !!u,
  );
  const [attempt, setAttempt] = useState(0);
  const [lastUrl, setLastUrl] = useState(logoUrl);
  if (logoUrl !== lastUrl) {
    setLastUrl(logoUrl);
    setAttempt(0);
  }
  const src = candidates[attempt];
  if (!src) {
    return (
      <span
        role="img"
        aria-label={`${name} logo unavailable, showing generic provider icon`}
        className={cn(
          "flex shrink-0 items-center justify-center bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-300",
          size === "sm"
            ? "size-6 rounded-md"
            : size === "lg"
              ? "size-12 rounded-2xl"
              : "size-8 rounded-lg",
          className,
        )}
      >
        <Cpu className={size === "lg" ? "size-6" : size === "sm" ? "size-3.5" : "size-4"} aria-hidden />
      </span>
    );
  }
  return (
    // Brand marks cannot use next/image optimization (SVG format / hotlinked
    // remote fallback); lazy img with an onError fallback chain instead.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={`${name} logo`}
      loading="lazy"
      onError={() => setAttempt((a) => a + 1)}
      className={cn("shrink-0 bg-white object-contain ring-1 ring-inset ring-zinc-200 dark:ring-zinc-700", size === "sm" ? "size-6 rounded-md" : size === "lg" ? "size-12 rounded-2xl" : "size-8 rounded-lg", className)}
    />
  );
}
