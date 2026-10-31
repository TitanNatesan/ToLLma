import type { ReactNode } from "react";

// Shared section container. `width` picks the max-width tier.
// All horizontal padding comes from --gutter (fluid 20→72px).
export function Container({
  children,
  width = "std",
  className = "",
  as: Tag = "div",
}: {
  children: ReactNode;
  width?: "std" | "wide" | "xwide";
  className?: string;
  as?: "div" | "section" | "header" | "footer" | "nav";
}) {
  const tier =
    width === "wide" ? "container-wide" : width === "xwide" ? "container-xwide" : "container-std";
  return (
    <Tag className={`container-gutter ${tier} ${className}`}>{children}</Tag>
  );
}

// A full-bleed section band with consistent vertical rhythm.
export function Section({
  children,
  id,
  tone = "canvas",
  className = "",
}: {
  children: ReactNode;
  id?: string;
  tone?: "canvas" | "surface" | "cool" | "tint";
  className?: string;
}) {
  const bg =
    tone === "surface"
      ? "bg-surface"
      : tone === "cool"
        ? "bg-surface-cool"
        : tone === "tint"
          ? "bg-surface-tint"
          : "bg-canvas";
  return (
    <section id={id} className={`relative ${bg} ${className}`} style={{ paddingBlock: "var(--section-y)" }}>
      {children}
    </section>
  );
}

// Section eyebrow + heading + optional lead. One place for heading rhythm.
export function SectionHeading({
  eyebrow,
  title,
  lead,
  align = "center",
  width = "std",
}: {
  eyebrow?: string;
  title: ReactNode;
  lead?: ReactNode;
  align?: "center" | "left";
  width?: "std" | "wide";
}) {
  return (
    <div
      data-reveal
      className={`flex flex-col gap-4 ${align === "center" ? "items-center text-center" : "items-start"} ${
        width === "wide" ? "max-w-4xl" : "max-w-3xl"
      } ${align === "center" ? "mx-auto" : ""}`}
    >
      {eyebrow && <p className="eyebrow">{eyebrow}</p>}
      <h2
        className="font-semibold tracking-tight text-ink"
        style={{ fontSize: "var(--t-h2)", lineHeight: 1.12 }}
      >
        {title}
      </h2>
      {lead && (
        <p className="text-muted" style={{ fontSize: "var(--t-lead)", lineHeight: 1.6, maxWidth: "60ch" }}>
          {lead}
        </p>
      )}
    </div>
  );
}
