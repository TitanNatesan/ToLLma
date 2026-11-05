"use client";

// Floating dynamic-island navbar: a centered liquid-glass pill, detached
// from the viewport top. At the top (or whenever the island is hovered /
// focused / tapped open) it shows everything — wordmark, all section
// links, API Docs and Get Started. While scrolled down and idle it
// collapses to just the wordmark, the current scroll-spy section, and Get
// Started. No progress line. The collapse/expand is a smooth FLIP-measured
// width glide (curtain reveal, exact widths, no snapping) plus a crossfade
// between the link row and the section label; transform/opacity-only
// otherwise. Static full nav under reduced motion (no collapse —
// everything stays visible).
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { MagneticButton } from "@/components/ui/magnetic-button";
import { IconClose, IconMenu } from "@/components/ui/icons";
import { useActiveSection } from "@/lib/animations";
import { prefersReducedMotion } from "@/lib/animations/motion-preference";
import { DOCS_URL, GET_STARTED_URL } from "@/lib/site";
import tollmaInk from "./brand/tollma-mark-ink.png";

// Mirrors the ToLLma application sidebar
// (frontend/src/components/Sidebar/SidebarNavigation.tsx PERSONAL_NAV),
// not the reference video's marketing taxonomy. Each item deep-links to the
// landing section showcasing that app area: Providers -> provider grid,
// API Keys -> Secure pillar (credentials & access), Guardrails -> guardrail
// panel, Prompt Logs -> Request Activity dashboard, Analytics -> platform
// section (Observe step: usage & cost visibility).
const LINKS = [
  { label: "Providers", href: "#providers", id: "providers" },
  { label: "API Keys", href: "#what-we-do", id: "what-we-do" },
  { label: "Guardrails", href: "#outcomes", id: "outcomes" },
  { label: "Prompt Logs", href: "#activity", id: "activity" },
  { label: "Analytics", href: "#platform", id: "platform" },
];

export default function Nav() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [touchOpen, setTouchOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const foldRef = useRef<HTMLDivElement | null>(null);
  const foldW = useRef(0);
  const ids = useMemo(() => LINKS.map((l) => l.id), []);
  const active = useActiveSection(ids);
  const reduced = prefersReducedMotion();

  const current = LINKS.find((l) => l.id === active) ?? {
    label: "Overview",
    href: "#top",
    id: "top",
  };
  // Reduced motion: never collapse — the full nav is always shown.
  const expanded = reduced || !scrolled || hovered || focused || touchOpen || open;

  useEffect(() => {
    let raf = 0;
    let last: boolean | null = null;
    const update = () => {
      raf = 0;
      const isScrolled = (window.scrollY || 0) > 24;
      if (isScrolled !== last) {
        last = isScrolled;
        setScrolled(isScrolled);
      }
      // Any scroll collapses a tap-opened island.
      if (isScrolled) setTouchOpen(false);
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  // FLIP width glide on expand/collapse: animate the fold from its
  // previous settled width to the new content width, then release back
  // to auto. The old width is recorded here — in the same layout effect,
  // before reading the new width — so a mid-animation re-render can never
  // overwrite it with a stale measurement (the old separate recorder ran
  // after every commit, including while a previous inline width was still
  // applied, which collapsed from/to and snapped instead of gliding).
  // Inline width is cleared before measuring so `to` is the natural
  // content width. The outgoing row is display:none so it never inflates
  // the measurement; the incoming row is revealed by the width curtain.
  useLayoutEffect(() => {
    const el = foldRef.current;
    if (!el || reduced) return;
    el.style.width = "";
    const to = el.scrollWidth;
    const from = foldW.current;
    foldW.current = to;
    if (!from || Math.abs(from - to) < 2) return;
    el.style.width = `${from}px`;
    const anim = el.animate(
      [{ width: `${from}px` }, { width: `${to}px` }],
      { duration: 360, easing: "cubic-bezier(0.2,0.7,0.2,1)" }
    );
    const clear = () => {
      el.style.width = "";
    };
    anim.onfinish = clear;
    return () => {
      try {
        anim.cancel();
      } catch {
        /* noop */
      }
      clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);

  // Mobile panel: Escape closes, Tab stays trapped, focus returns on close.
  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    panelRef.current
      ?.querySelector<HTMLElement>("a, button")
      ?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        toggleRef.current?.focus();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;
      const items = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>("a[href], button")
      ).filter((el) => !el.hasAttribute("disabled"));
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
    };
  }, [open ]);

  return (
    <>
      <header className="pointer-events-none fixed inset-x-0 top-3 z-50 flex justify-center px-4 sm:top-4">
        <nav
          aria-label="Primary"
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onMouseMove={(e) => {
            // Pointer glare: drift the ::after highlight toward the
            // cursor. Mouse only, motion-safe only — touch and
            // reduced-motion keep the static centered sheen.
            if (reduced) return;
            const pe = e as unknown as { pointerType?: string };
            if (pe.pointerType && pe.pointerType !== "mouse") return;
            const el = e.currentTarget;
            const r = el.getBoundingClientRect();
            if (r.width <= 0 || r.height <= 0) return;
            el.style.setProperty("--mx", `${(((e.clientX - r.left) / r.width) * 100).toFixed(1)}%`);
            el.style.setProperty("--my", `${(((e.clientY - r.top) / r.height) * 100).toFixed(1)}%`);
          }}
          onClick={() => {
            // Touch: tapping the collapsed island expands it.
            if (!expanded) setTouchOpen(true);
          }}
          className={`navbar-glass pointer-events-auto flex max-w-full items-center gap-3 rounded-full px-4 py-2 text-coal transition-[padding,background-color,border-color,box-shadow] duration-300 ease-out sm:gap-4 sm:px-5 sm:py-2.5 ${
            expanded ? "" : "cursor-pointer"
          }`}
        >
          <Link
            href="#top"
            className="flex shrink-0 items-center gap-2"
            aria-label="ToLLma home"
            onClick={() => {
              setTouchOpen(false);
              setOpen(false);
            }}
          >
            {/* Official ToLLma mark (ink version for the glass island). */}
            <img
              src={tollmaInk.src}
              alt=""
              width={28}
              height={28}
              className="size-[28px]"
            />
            <span className="hidden text-[1.05rem] font-semibold tracking-tight min-[400px]:inline">
              ToLLma
            </span>
          </Link>

          {/* Middle fold: full link row when expanded, current-section
              label when collapsed. Width glides via FLIP; contents
              crossfade. On mobile the link row stays hidden and the label
              persists in both states. */}
          <div ref={foldRef} className="island-fold min-w-0">
            <div className="relative">
              <div
                className={`items-center gap-4 whitespace-nowrap transition-opacity duration-200 lg:gap-6 ${
                  expanded ? "flex opacity-100 max-lg:hidden" : "hidden"
                }`}
              >
                <ul className="flex items-center gap-1 lg:gap-3">
                  {LINKS.map((l) => {
                    const isActive = active === l.id;
                    return (
                      <li key={l.label}>
                        <Link
                          href={l.href}
                          aria-current={isActive ? "true" : undefined}
                          data-active={isActive ? "true" : undefined}
                          onClick={() => {
                            setTouchOpen(false);
                            setOpen(false);
                          }}
                          className={`nav-link nav-link-light nav-link-glass text-[0.95rem] font-medium transition-opacity hover:opacity-80 ${
                            isActive ? "text-coal" : "text-coal/70"
                          }`}
                        >
                          {l.label}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
                <a
                  href={DOCS_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="nav-link-glass text-[0.95rem] font-medium text-coal/70 transition-opacity hover:opacity-80"
                >
                  API Docs
                </a>
              </div>
              <span
                className={`whitespace-nowrap transition-opacity duration-200 ${
                  expanded
                    ? "opacity-100 lg:pointer-events-none lg:absolute lg:inset-0 lg:opacity-0"
                    : "opacity-100"
                }`}
              >
                <Link
                  href={current.href}
                  aria-current={active ? "true" : undefined}
                  onClick={(e) => e.stopPropagation()}
                  className="truncate text-[0.95rem] font-medium text-coal/75"
                >
                  {current.label}
                </Link>
              </span>
            </div>
          </div>

          <MagneticButton strength={5} className="shrink-0">
            <span className="btn-shine inline-flex shrink-0 items-center rounded-full border border-white/20 bg-coal px-4 py-1.5 text-[0.85rem] font-semibold text-cream shadow-[0_2px_10px_rgba(23,25,20,0.25)] transition-transform duration-150 ease-out active:scale-[0.98] sm:px-5 sm:py-2 sm:text-[0.9rem]">
              <Link
                href={GET_STARTED_URL}
                onClick={(e) => e.stopPropagation()}
              >
                Get Started
              </Link>
            </span>
          </MagneticButton>

          {/* Mobile menu toggle: fades/slides open only with the island. */}
          <span
            className={`grid transition-[grid-template-columns,opacity,margin] duration-300 ease-out lg:hidden ${
              expanded
                ? "ml-0 grid-cols-[1fr] opacity-100"
                : "grid-cols-[0fr] opacity-0"
            }`}
          >
            <span className="min-w-0 overflow-hidden">
              <button
                ref={toggleRef}
                type="button"
                tabIndex={expanded ? 0 : -1}
                className="inline-flex size-10 items-center justify-center rounded-full text-coal"
                aria-expanded={open}
                aria-controls="nav-mobile-panel"
                aria-label={open ? "Close menu" : "Open menu"}
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen((v) => !v);
                }}
              >
                {open ? <IconClose size={20} /> : <IconMenu size={20} />}
              </button>
            </span>
          </span>
        </nav>
      </header>

      {/* Mobile drop-down card, mounted only when the island is expanded. */}
      {expanded && (
        <div
          id="nav-mobile-panel"
          ref={panelRef}
          inert={!open}
          className={`fixed inset-x-4 top-[72px] z-50 grid transition-[grid-template-rows,opacity] duration-300 ease-out lg:hidden ${
            open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
          }`}
        >
          <div className="overflow-hidden">
            <div
              className={`navbar-glass navbar-menu flex flex-col gap-1 rounded-3xl p-3 text-coal ${
                open ? undefined : "invisible"
              }`}
            >
              {LINKS.map((l, i) => (
                <Link
                  key={l.label}
                  href={l.href}
                  tabIndex={open ? 0 : -1}
                  onClick={() => setOpen(false)}
                  aria-current={active === l.id ? "true" : undefined}
                  style={{ transitionDelay: open ? `${i * 45}ms` : "0ms" }}
                  className={`flex items-center gap-1.5 rounded-2xl px-3 py-2.5 text-[0.95rem] font-medium transition-[opacity,transform,background-color] duration-300 ease-out hover:bg-coal/[0.06] ${
                    open ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
                  } ${active === l.id ? "bg-coal/[0.07] text-coal" : "text-coal/70"}`}
                >
                  <span
                    aria-hidden="true"
                    className={`size-1.5 rounded-full bg-coal ${
                      active === l.id ? "opacity-100" : "opacity-0"
                    }`}
                  />
                  {l.label}
                </Link>
              ))}
              <div
                style={{ transitionDelay: open ? `${LINKS.length * 45}ms` : "0ms" }}
                className={`mt-1 flex items-center gap-4 border-t border-coal/10 px-3 pt-4 transition-[opacity,transform] duration-300 ease-out ${
                  open ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
                }`}
              >
                <a
                  href={DOCS_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  tabIndex={open ? 0 : -1}
                  className="text-[0.95rem] font-medium text-coal/70"
                >
                  API Docs
                </a>
                <span className="btn-shine inline-flex flex-1 items-center justify-center rounded-full border border-white/20 bg-coal px-6 py-3 text-[0.95rem] font-semibold text-cream shadow-[0_2px_10px_rgba(23,25,20,0.25)] transition-transform duration-150 ease-out active:scale-[0.98]">
                  <Link href={GET_STARTED_URL}>Get Started</Link>
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
      <style>{`
        .nav-link-light::after { background: currentColor; }
        .island-fold { overflow: hidden; }
      `}</style>
    </>
  );
}
