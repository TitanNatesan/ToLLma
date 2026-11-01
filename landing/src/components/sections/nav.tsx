"use client";

// Sticky cream navbar: app-style T-badge wordmark left, application section
// links center, "API Docs" text link + black square "Get Started" right.
// Transparent at top; once scrolled it gains opaque cream + blur + hairline
// border/shadow (fixed h-16, no shift). Active section gets a dot indicator
// via useActiveSection. Mobile panel is smooth (grid-rows + opacity),
// focus-trapped, Escape-closable, CTA visible.
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Container } from "@/components/ui/layout";
import { BlackButton } from "@/components/ui/primitives";
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
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const active = useActiveSection(LINKS.map((l) => l.id));

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
    <header className="sticky top-0 z-50 border-b border-cream-line bg-cream">
      <Container width="wide" as="nav" className="flex h-16 items-center justify-between gap-6" aria-label="Primary">
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
                  className={`relative flex items-center gap-1 py-1 text-[0.95rem] font-medium transition-opacity hover:opacity-60 ${
                    isActive ? "text-coal" : "text-coal/80"
                  }`}
                >
                  {l.label}
                  <span
                    aria-hidden="true"
                    className={`absolute -bottom-0.5 left-1/2 size-1 -translate-x-1/2 rounded-full bg-coal transition-opacity duration-200 ${
                      isActive ? "opacity-100" : "opacity-0"
                    }`}
                  />
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
          <BlackButton href={GET_STARTED_URL} className="px-6 py-2.5 text-[0.9rem]">
            Get Started
          </BlackButton>
        </div>

        <button
          ref={toggleRef}
          type="button"
          className="inline-flex size-10 items-center justify-center text-coal lg:hidden"
          aria-expanded={open}
          aria-controls="nav-mobile-panel"
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <IconClose size={22} /> : <IconMenu size={22} />}
        </button>
      </Container>

      {/* Always mounted for a smooth open/close (grid-rows + opacity);
          hidden from AT + inert when closed. */}
      <div
        id="nav-mobile-panel"
        ref={panelRef}
        inert={!open}
        className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out lg:hidden ${
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="overflow-hidden">
          <Container
            className={`flex flex-col gap-1 py-4 transition-transform duration-300 ease-out ${
              open ? "translate-y-0" : "-translate-y-2"
            }`}
          >
            <div
              aria-hidden={!open}
              className={open ? undefined : "invisible"}
            >
              {LINKS.map((l) => (
                <Link
                  key={l.label}
                  href={l.href}
                  tabIndex={open ? 0 : -1}
                  onClick={() => setOpen(false)}
                  aria-current={active === l.id ? "true" : undefined}
                  className={`flex items-center gap-1.5 px-2 py-2.5 text-[0.95rem] font-medium ${
                    active === l.id ? "text-coal" : "text-coal/80"
                  }`}
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
              <div className="mt-2 flex items-center gap-4 border-t border-cream-line px-2 pt-4">
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
                  className="flex-1 px-6 py-3"
                >
                  Get Started
                </BlackButton>
              </div>
            </div>
          </Container>
        </div>
      </div>
    </header>
  );
}
