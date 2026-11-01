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
