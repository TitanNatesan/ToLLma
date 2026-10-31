import Link from "next/link";
import type { ReactNode } from "react";

// Primary / secondary CTA buttons. Consistent across every section so the
// page reads as one product. `href` renders an anchor, otherwise a button.

type Variant = "primary" | "secondary" | "ghost";

const base =
  "inline-flex items-center justify-center gap-2 rounded-full font-medium " +
  "transition-all duration-200 whitespace-nowrap select-none " +
  "focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2";

const variants: Record<Variant, string> = {
  primary:
    "bg-brand text-white shadow-[0_8px_24px_-8px_rgba(31,94,255,0.55)] " +
    "hover:bg-brand-strong hover:shadow-[0_12px_28px_-8px_rgba(31,94,255,0.6)] active:translate-y-px",
  secondary:
    "bg-surface text-ink border border-line-strong " +
    "hover:border-brand hover:text-brand active:translate-y-px",
  ghost: "text-ink-soft hover:text-brand",
};

const sizes = {
  sm: "h-9 px-4 text-sm",
  md: "h-11 px-6 text-[0.95rem]",
  lg: "h-12 px-7 text-base",
};

export function CTA({
  href,
  children,
  variant = "primary",
  size = "md",
  className = "",
  onClick,
  ariaLabel,
}: {
  href?: string;
  children: ReactNode;
  variant?: Variant;
  size?: keyof typeof sizes;
  className?: string;
  onClick?: () => void;
  ariaLabel?: string;
}) {
  const cls = `${base} ${variants[variant]} ${sizes[size]} ${className}`;
  if (href) {
    const external = href.startsWith("http");
    return (
      <Link
        href={href}
        className={cls}
        aria-label={ariaLabel}
        {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      >
        {children}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={cls} aria-label={ariaLabel}>
      {children}
    </button>
  );
}

// Small pill/badge used for tags, statuses, eyebrows.
export function Badge({
  children,
  tone = "neutral",
  className = "",
}: {
  children: ReactNode;
  tone?: "neutral" | "brand" | "teal" | "ok" | "warn";
  className?: string;
}) {
  const tones = {
    neutral: "bg-surface-cool text-muted border-line",
    brand: "bg-brand-soft text-brand-strong border-brand-soft",
    teal: "bg-teal-soft text-teal-ink border-teal-soft",
    ok: "bg-ok-soft text-ok-ink border-ok-soft",
    warn: "bg-warn/10 text-warn-ink border-warn/20",
  } as const;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${tones[tone]} ${className}`}
    >
      {children}
    </span>
  );
}
