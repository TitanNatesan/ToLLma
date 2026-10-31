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

export function IconGateway({ className, size = 24 }: P) {
  return (
    <svg {...svg(size)} className={className} aria-hidden>
      <rect x="3" y="3" width="18" height="18" rx="4" />
      <path d="M8 12h8M12 8v8" />
    </svg>
  );
}

export function IconShield({ className, size = 24 }: P) {
  return (
    <svg {...svg(size)} className={className} aria-hidden>
      <path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" />
      <path d="M9.5 12l1.8 1.8L15 10" />
    </svg>
  );
}

export function IconKey({ className, size = 24 }: P) {
  return (
    <svg {...svg(size)} className={className} aria-hidden>
      <circle cx="8" cy="8" r="4" />
      <path d="M11 11l9 9M17 17l2-2M14 14l1.5-1.5" />
    </svg>
  );
}

export function IconActivity({ className, size = 24 }: P) {
  return (
    <svg {...svg(size)} className={className} aria-hidden>
      <path d="M3 12h4l2.5 7 4-14L16 12h5" />
    </svg>
  );
}

export function IconLayers({ className, size = 24 }: P) {
  return (
    <svg {...svg(size)} className={className} aria-hidden>
      <path d="M12 3l9 5-9 5-9-5 9-5z" />
      <path d="M3 13l9 5 9-5" />
    </svg>
  );
}

export function IconTerminal({ className, size = 24 }: P) {
  return (
    <svg {...svg(size)} className={className} aria-hidden>
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <path d="M7 9l3 3-3 3M13 15h4" />
    </svg>
  );
}

export function IconOrg({ className, size = 24 }: P) {
  return (
    <svg {...svg(size)} className={className} aria-hidden>
      <rect x="4" y="3" width="7" height="7" rx="1.5" />
      <rect x="13" y="3" width="7" height="7" rx="1.5" />
      <rect x="4" y="14" width="7" height="7" rx="1.5" />
      <path d="M13 17.5h7M16.5 14v7" />
    </svg>
  );
}

export function IconDoc({ className, size = 24 }: P) {
  return (
    <svg {...svg(size)} className={className} aria-hidden>
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v4h4M9 12h6M9 16h6" />
    </svg>
  );
}

export function IconLock({ className, size = 24 }: P) {
  return (
    <svg {...svg(size)} className={className} aria-hidden>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 018 0v3" />
    </svg>
  );
}

export function IconChart({ className, size = 24 }: P) {
  return (
    <svg {...svg(size)} className={className} aria-hidden>
      <path d="M4 20V4M4 20h16" />
      <path d="M8 20v-6M12 20v-9M16 20v-4M20 20v-8" />
    </svg>
  );
}

export function IconSpark({ className, size = 24 }: P) {
  return (
    <svg {...svg(size)} className={className} aria-hidden>
      <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z" />
    </svg>
  );
}

export function IconArrowRight({ className, size = 20 }: P) {
  return (
    <svg {...svg(size)} className={className} aria-hidden>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

export function IconCheck({ className, size = 18 }: P) {
  return (
    <svg {...svg(size)} className={className} aria-hidden>
      <path d="M5 12.5l4.5 4.5L19 7" />
    </svg>
  );
}

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

export function IconCube({ className, size = 24 }: P) {
  return (
    <svg {...svg(size)} className={className} aria-hidden>
      <path d="M12 2.5l8 4.5v10l-8 4.5-8-4.5v-10L12 2.5z" />
      <path d="M4 7l8 4.5L20 7M12 11.5V22" />
    </svg>
  );
}

// GitHub mark (filled, brand-agnostic) — used in nav/CTA/footer.
export function IconGitHub({ className, size = 20 }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M12 2C6.48 2 2 6.58 2 12.25c0 4.53 2.87 8.37 6.84 9.73.5.1.68-.22.68-.49l-.01-1.7c-2.78.62-3.37-1.22-3.37-1.22-.46-1.18-1.11-1.5-1.11-1.5-.91-.64.07-.62.07-.62 1 .07 1.53 1.06 1.53 1.06.89 1.57 2.34 1.11 2.91.85.09-.66.35-1.11.63-1.37-2.22-.26-4.55-1.14-4.55-5.06 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.28 2.75 1.05a9.3 9.3 0 015 0c1.91-1.33 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.93-2.34 4.79-4.57 5.05.36.32.68.94.68 1.9l-.01 2.82c0 .27.18.6.69.49A10.02 10.02 0 0022 12.25C22 6.58 17.52 2 12 2z" />
    </svg>
  );
}
