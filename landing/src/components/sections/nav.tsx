"use client";

// Premium floating navbar: transparent at rest, frosted once scrolled.
// Lightweight bar; active-section indicator slides between links (scrollspy),
// mobile dropdown animates in AND out with Anime.js.

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Container } from "@/components/ui/layout";
import { CTA } from "@/components/ui/primitives";
import { IconGitHub, IconMenu, IconClose } from "@/components/ui/icons";
import { DOCS_URL, GET_STARTED_URL, GITHUB_URL } from "@/lib/site";
import {
  animate,
  prefersReducedMotion,
  stagger,
  useActiveSection,
} from "@/lib/animations";

// --- Link model: in-page anchors smooth-scroll, DOCS_URL is external ---
type NavLink = { label: string; href: string; external?: boolean };

const LINKS: NavLink[] = [
  { label: "Features", href: "#features" },
  { label: "How it works", href: "#how-it-works" },
  { label: "Product", href: "#product" },
  { label: "Docs", href: DOCS_URL, external: true },
];

// Ids watched by the scrollspy, in page order (top → bottom).
const SECTION_IDS = ["features", "how-it-works", "product"] as const;

// Small gateway/routing mark: one inbound node fanning out to three routes.
function LogoMark() {
  return (
    <svg width={28} height={28} viewBox="0 0 28 28" fill="none" aria-hidden>
      <rect x="1" y="1" width="26" height="26" rx="8" className="fill-brand-soft" />
      <circle cx="8" cy="14" r="2.4" className="fill-brand" />
      <path
        d="M10.4 14h4.2M14.6 14c2.6 0 2.8-5 5.4-5M14.6 14h5.4M14.6 14c2.6 0 2.8 5 5.4 5"
        stroke="var(--color-brand)"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <circle cx="20.4" cy="9" r="1.6" className="fill-teal" />
      <circle cx="20.4" cy="14" r="1.6" className="fill-brand-strong" />
      <circle cx="20.4" cy="19" r="1.6" className="fill-violet" />
    </svg>
  );
}

export default function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  // Panel stays mounted during the exit animation, then unmounts.
  const [panelVisible, setPanelVisible] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const linkRefs = useRef<Map<string, HTMLAnchorElement>>(new Map());

  // Scrollspy: null until the observer fires (no hydration mismatch).
  const activeId = useActiveSection([...SECTION_IDS]);

  // Sliding indicator geometry; null until an active link has been measured.
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null);

  // Passive scroll listener with cleanup; ~24px threshold.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Position the active indicator under its link (layout-only, client-side).
  const measure = useCallback(() => {
    if (!activeId) return;
    const link = linkRefs.current.get(activeId);
    const list = listRef.current;
    if (!link || !list) return;
    const lr = list.getBoundingClientRect();
    const br = link.getBoundingClientRect();
    setIndicator({ left: br.left - lr.left, width: br.width });
  }, [activeId]);

  useEffect(() => {
    measure();
  }, [measure]);

  // Keep the indicator correct across resizes (nav width changes).
  useEffect(() => {
    if (!activeId) return;
    const onResize = () => measure();
    window.addEventListener("resize", onResize, { passive: true });
    return () => window.removeEventListener("resize", onResize);
  }, [activeId, measure]);

  // Close on Escape, return focus to the toggle.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        toggleRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Close on outside click (panel or toggle tapped → keep open).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      if (panelRef.current?.contains(t) || toggleRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  // Keep the panel mounted while open (and during its exit animation).
  useEffect(() => {
    if (open) setPanelVisible(true);
  }, [open]);

  // Animate the mobile panel in (staggered items) and out (fade + slight y).
  // Instant for reduced motion; cleanup on unmount.
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;

    if (open) {
      if (prefersReducedMotion()) return;
      const items = panel.querySelectorAll("[data-menu-item]");
      const a = animate(items, {
        opacity: [0, 1],
        y: [10, 0],
        duration: 450,
        delay: stagger(45),
        ease: "outExpo",
      });
      return () => {
        a.revert();
      };
    }

    // Closing: fade the whole panel out, then unmount it.
    if (prefersReducedMotion()) {
      setPanelVisible(false);
      return;
    }
    const a = animate(panel, {
      opacity: [1, 0],
      y: [0, -8],
      duration: 220,
      ease: "inQuad",
      onComplete: () => setPanelVisible(false),
    });
    return () => a.pause();
  }, [open, panelVisible]);

  const close = useCallback(() => setOpen(false), []);

  const headerCls = scrolled
    ? "bg-surface/80 backdrop-blur-md border-b border-line shadow-[0_8px_30px_-12px_rgba(11,27,52,0.18)]"
    : "bg-surface/40 backdrop-blur-[2px] border-b border-transparent";

  return (
    <header className="fixed inset-x-0 top-0 z-50">
      {/* Floating bar */}
      <div className={`transition-all duration-300 ${headerCls}`}>
        <Container as="nav" width="wide" className="flex h-16 items-center justify-between gap-6">
          {/* Wordmark */}
          <Link
            href="#top"
            className="flex items-center gap-2.5 rounded-lg"
            aria-label="ToLLma home"
          >
            <LogoMark />
            <span className="text-[1.05rem] font-semibold tracking-tight text-ink">ToLLma</span>
          </Link>

          {/* Desktop links + sliding active indicator */}
          <ul ref={listRef} className="relative hidden items-center gap-1 md:flex">
            {LINKS.map((l) => {
              const id = l.external ? undefined : l.href.slice(1);
              const isActive = !!id && id === activeId;
              return (
                <li key={l.label}>
                  <Link
                    ref={(el) => {
                      if (id) {
                        if (el) linkRefs.current.set(id, el);
                        else linkRefs.current.delete(id);
                      }
                    }}
                    href={l.href}
                    {...(l.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                    aria-current={isActive ? "true" : undefined}
                    className={`group relative inline-block px-3 py-2 text-sm transition-colors ${
                      isActive ? "text-ink" : "text-ink-soft hover:text-ink"
                    }`}
                  >
                    {l.label}
                    {/* hover: underline grows from the left */}
                    <span className="absolute inset-x-3 bottom-1 h-px origin-left scale-x-0 bg-brand transition-transform duration-300 group-hover:scale-x-100" />
                  </Link>
                </li>
              );
            })}
            {/* Shared indicator: slides (translateX + width) between active links */}
            <span
              aria-hidden
              className={`pointer-events-none absolute bottom-1 left-0 h-0.5 rounded-full bg-brand transition-all motion-reduce:transition-none ${
                indicator && activeId ? "opacity-100" : "opacity-0"
              }`}
              style={
                indicator
                  ? {
                      width: `${indicator.width}px`,
                      transform: `translateX(${indicator.left}px)`,
                      transitionDuration: "var(--dur-base)",
                      transitionTimingFunction: "var(--ease-out-expo)",
                    }
                  : undefined
              }
            />
          </ul>

          {/* Desktop actions */}
          <div className="hidden items-center gap-2 md:flex">
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="ToLLma on GitHub"
              className="inline-flex h-9 w-9 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-surface-cool hover:text-ink"
            >
              <IconGitHub size={19} />
            </a>
            <CTA
              href={GET_STARTED_URL}
              size="sm"
              className="hover:-translate-y-px hover:shadow-md"
            >
              Get started
            </CTA>
          </div>

          {/* Mobile toggle */}
          <button
            ref={toggleRef}
            type="button"
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-ink transition-colors hover:bg-surface-cool md:hidden"
            aria-expanded={open}
            aria-controls="nav-mobile-panel"
            aria-label={open ? "Close menu" : "Open menu"}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <IconClose size={22} /> : <IconMenu size={22} />}
          </button>
        </Container>
      </div>

      {/* Mobile dropdown panel (stays mounted while animating out) */}
      {panelVisible && (
        <div
          id="nav-mobile-panel"
          ref={panelRef}
          className="border-b border-line bg-surface/95 backdrop-blur-md md:hidden"
        >
          <Container className="flex flex-col gap-1 py-4">
            {LINKS.map((l) => {
              const id = l.external ? undefined : l.href.slice(1);
              const isActive = !!id && id === activeId;
              return (
                <Link
                  key={l.label}
                  href={l.href}
                  data-menu-item
                  {...(l.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                  onClick={close}
                  aria-current={isActive ? "true" : undefined}
                  className={`rounded-lg px-3 py-2.5 text-[0.95rem] transition-colors hover:bg-surface-cool hover:text-ink ${
                    isActive ? "bg-surface-cool font-medium text-ink" : "text-ink-soft"
                  }`}
                >
                  {l.label}
                </Link>
              );
            })}
            <div data-menu-item className="mt-3 flex items-center gap-3 border-t border-line pt-4">
              <a
                href={GITHUB_URL}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="ToLLma on GitHub"
                onClick={close}
                className="inline-flex h-10 w-10 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-surface-cool"
              >
                <IconGitHub size={20} />
              </a>
              <CTA href={GET_STARTED_URL} size="md" className="flex-1">Get started</CTA>
            </div>
          </Container>
        </div>
      )}
    </header>
  );
}
