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

export function IconGitHub({ className, size = 24 }: P) {
  return (
    <svg {...svg(size)} className={className} aria-hidden>
      <path d="M12 3.5c-4.7 0-8.5 3.8-8.5 8.5 0 3.7 2.4 6.9 5.8 8 .4.1.6-.2.6-.4v-1.5c-2.4.5-2.9-1-2.9-1-.4-1-1-1.2-1-1.2-.8-.6.1-.6.1-.6.9.1 1.4.9 1.4.9.8 1.4 2.1 1 2.7.8.1-.7.3-1 .6-1.3-2-.2-4-1-4-4.4 0-1 .3-1.8.9-2.4-.1-.2-.4-1.1.1-2.4 0 0 .7-.2 2.4.9a8.3 8.3 0 0 1 4.4 0c1.7-1.1 2.4-.9 2.4-.9.5 1.3.2 2.2.1 2.4.6.6.9 1.4.9 2.4 0 3.4-2 4.2-4 4.4.3.3.6.9.6 1.8v2.6c0 .2.2.5.6.4 3.4-1.1 5.8-4.3 5.8-8 0-4.7-3.8-8.5-8.5-8.5Z" />
    </svg>
  );
}

export function IconChat({ className, size = 24 }: P) {
  return (
    <svg {...svg(size)} className={className} aria-hidden>
      <path d="M21 12a8 8 0 0 1-8 8H4l2.3-2.9A8 8 0 1 1 21 12Z" />
      <path d="M9 11.5h.01M12.5 11.5h.01M16 11.5h.01" />
    </svg>
  );
}
