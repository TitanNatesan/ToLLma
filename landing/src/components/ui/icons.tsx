// Consistent icon system — inline SVG, 1.6 stroke, currentColor.
// No emoji, no external icon deps beyond what's installed. Each icon is a
// small functional component so sections share one visual language.

type P = { className?: string; size?: number };

const svg = (size: number) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
});

export function IconMenu({ className, size = 24 }: P) {
  return (
    <svg {...svg(size)} className={className} aria-hidden>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

export function IconClose({ className, size = 24 }: P) {
  return (
    <svg {...svg(size)} className={className} aria-hidden>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}
