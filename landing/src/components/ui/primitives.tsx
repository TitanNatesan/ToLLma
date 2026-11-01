import Link from "next/link";
import type { ReactNode } from "react";

// Black square CTA — the Nominal-style primary action used by nav, hero,
// and closing. Square corners, cream text, no shadow, no scale — hover only
// deepens the fill, press settles 1px (transform-only).
export function BlackButton({
  href,
  children,
  className = "",
  ariaLabel,
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
  ariaLabel?: string;
}) {
  const external = href.startsWith("http");
  return (
    <Link
      href={href}
      aria-label={ariaLabel}
      className={
        `inline-flex items-center justify-center gap-2 bg-coal px-7 py-3.5 ` +
        `text-[0.95rem] font-medium text-cream transition-[background-color,transform] ` +
        `duration-200 hover:bg-black focus-visible:outline-2 focus-visible:outline-offset-2 ` +
        `focus-visible:outline-coal active:translate-y-px ${className}`
      }
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
    >
      {children}
    </Link>
  );
}
