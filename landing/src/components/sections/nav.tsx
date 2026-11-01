"use client";

// Sticky cream navbar: app-style T-badge wordmark left, application section
// links center, "API Docs" text link + black square "Get Started" right.
// At top: solid cream, full height (var(--nav-h)). Past 24px of scroll the
// bar frosts (cream/85 + blur + hairline border + soft shadow), shrinks
// ~10% across the first 120px, and shows a thin page-progress line at its
// bottom edge (rAF-driven, transform-only — no re-renders on scroll).
// Desktop links draw an underline left→right on hover; the scrollspy item
// (useActiveSection) holds it full. Mobile panel staggers links in.
// Header box height follows the bar, so the shrink is smooth and
// scroll-linked — no abrupt layout shift. Copy/destinations unchanged.
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { BlackButton } from "@/components/ui/primitives";
import { MagneticButton } from "@/components/ui/magnetic-button";
import { IconClose, IconMenu } from "@/components/ui/icons";
import { useActiveSection } from "@/lib/animations";
import { DOCS_URL, GET_STARTED_URL } from "@/lib/site";
import tollmaLight from "./brand/tollma-light-256.png";

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
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const barRef = useRef<HTMLElement | null>(null);
  const progressRef = useRef<HTMLSpanElement | null>(null);
  const ids = useMemo(() => LINKS.map((l) => l.id), []);
  const active = useActiveSection(ids);

  // Frost + shrink + progress: one rAF-throttled scroll listener updating
  // the DOM directly (no per-frame React renders). Reduced-motion keeps the
  // scroll-linked bar (informative, not autoplay); magnetic is separate.
  useEffect(() => {
    let raf = 0;
    let lastScrolled: boolean | null = null;
    const update = () => {
      raf = 0;
      const y = window.scrollY || 0;
      const isScrolled = y > 24;
      if (isScrolled !== lastScrolled) {
        lastScrolled = isScrolled;
        setScrolled(isScrolled);
      }
      const t = Math.min(1, y / 120);
      barRef.current?.style.setProperty("--shrink", t.toFixed(3));
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const p = max > 0 ? Math.min(1, Math.max(0, y / max)) : 0;
      progressRef.current?.style.setProperty("transform", `scaleX(${p.toFixed(4)})`);
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
    <header
      // Single opaque background state (cream) top AND scrolled: a
      // translucent frosted bar changes appearance over dark sections
      // (e.g. #platform), reading as a background "flip" while scrolling.
      // Scoped fix: keep the blur class (no-op on opaque) for the design
      // language, but never let dark content bleed through. Shrink +
      // progress line still signal scroll.
      className={`sticky top-0 z-50 border-b transition-[border-color,box-shadow] duration-300 bg-cream ${
        scrolled
          ? "border-cream-line shadow-[var(--shadow-sm)] backdrop-blur-md"
          : "border-transparent"
      }`}
    >
      <nav
        ref={barRef}
        aria-label="Primary"
        className="nav-bar container-gutter container-wide mx-auto flex items-center justify-between gap-6"
      >
        <Link href="#top" className="flex items-center gap-2" aria-label="ToLLma home">
          {/* Official ToLLma mark (supplied PNG, light version for cream). */}
          <img
            src={tollmaLight.src}
            alt=""
            width={28}
            height={28}
            className="size-7"
          />
          <span className="text-[1.1rem] font-semibold tracking-tight text-coal">
            ToLLma
          </span>
        </Link>

        <ul className="hidden items-center gap-8 lg:flex">
          {LINKS.map((l) => {
            const isActive = active === l.id;
            return (
              <li key={l.label}>
                <Link
                  href={l.href}
                  aria-current={isActive ? "true" : undefined}
                  data-active={isActive ? "true" : undefined}
                  className={`nav-link py-1 text-[0.95rem] font-medium transition-opacity hover:opacity-60 ${
                    isActive ? "text-coal" : "text-coal/80"
                  }`}
                >
                  {l.label}
                </Link>
              </li>
            );
          })}
        </ul>

        <div className="hidden items-center gap-6 lg:flex">
          <a
            href={DOCS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[0.95rem] font-medium text-coal/80 transition-opacity hover:opacity-60"
          >
            API Docs
          </a>
          <MagneticButton strength={5}>
            <BlackButton href={GET_STARTED_URL} className="btn-shine px-6 py-2.5 text-[0.9rem]">
              Get Started
            </BlackButton>
          </MagneticButton>
        </div>

        <button
          ref={toggleRef}
          type="button"
          className="inline-flex size-11 items-center justify-center text-coal lg:hidden"
          aria-expanded={open}
          aria-controls="nav-mobile-panel"
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <IconClose size={22} /> : <IconMenu size={22} />}
        </button>
      </nav>
      <span ref={progressRef} aria-hidden="true" className="nav-progress" />

      {/* Always mounted for a smooth open/close (grid-rows + opacity);
          hidden from AT + inert when closed. Links stagger in on open. */}
      <div
        id="nav-mobile-panel"
        ref={panelRef}
        inert={!open}
        className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out lg:hidden ${
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="overflow-hidden">
          <div className="container-gutter container-wide mx-auto flex flex-col gap-1 py-4">
            <div aria-hidden={!open} className={open ? undefined : "invisible"}>
              {LINKS.map((l, i) => (
                <Link
                  key={l.label}
                  href={l.href}
                  tabIndex={open ? 0 : -1}
                  onClick={() => setOpen(false)}
                  aria-current={active === l.id ? "true" : undefined}
                  style={{ transitionDelay: open ? `${i * 45}ms` : "0ms" }}
                  className={`flex items-center gap-1.5 px-2 py-2.5 text-[0.95rem] font-medium transition-[opacity,transform] duration-300 ease-out ${
                    open ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
                  } ${active === l.id ? "text-coal" : "text-coal/80"}`}
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
                className={`mt-2 flex items-center gap-4 border-t border-cream-line px-2 pt-4 transition-[opacity,transform] duration-300 ease-out ${
                  open ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
                }`}
              >
                <a
                  href={DOCS_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  tabIndex={open ? 0 : -1}
                  className="text-[0.95rem] font-medium text-coal/80"
                >
                  API Docs
                </a>
                <BlackButton
                  href={GET_STARTED_URL}
                  className="btn-shine flex-1 px-6 py-3"
                >
                  Get Started
                </BlackButton>
              </div>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
