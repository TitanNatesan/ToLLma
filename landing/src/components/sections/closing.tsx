"use client";

// ============================================================
// Footer: complete, quiet site footer. Brand block, product /
// resources / community columns, license + placeholder-link note.
// ============================================================

import Link from "next/link";
import { useLayoutEffect, useEffect, type RefObject } from "react";
import { Container } from "@/components/ui/layout";
import { IconGateway } from "@/components/ui/icons";
import {
  animate,
  fadeUp,
  stagger,
  useInViewOnce,
  useReducedMotion,
  utils,
} from "@/lib/animations";
import {
  COMMUNITY_URL,
  DOCS_URL,
  GITHUB_URL,
  IS_PLACEHOLDER_LINKS,
  LICENSE_URL,
  ROADMAP_URL,
} from "@/lib/site";

const footerLinks = [
  {
    title: "Product",
    links: [
      { label: "Features", href: "#features" },
      { label: "How it works", href: "#how-it-works" },
      { label: "Get started", href: "#get-started" },
    ],
  },
  {
    title: "Resources",
    links: [
      { label: "Docs", href: DOCS_URL },
      { label: "Roadmap", href: ROADMAP_URL },
      { label: "License", href: LICENSE_URL },
    ],
  },
  {
    title: "Community",
    links: [
      { label: "GitHub", href: GITHUB_URL },
      { label: "Discussions", href: COMMUNITY_URL },
    ],
  },
] as const;

function FooterLink({ href, children }: { href: string; children: string }) {
  const external = href.startsWith("http");
  return (
    <Link
      href={href}
      className={
        "relative inline-block rounded-sm px-1 py-1 text-sm text-muted transition-colors duration-[var(--dur-fast)] hover:text-brand " +
        "focus-visible:text-brand focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand motion-reduce:transition-none " +
        "after:absolute after:-bottom-0.5 after:left-0 after:h-px after:w-full after:origin-right after:scale-x-0 after:bg-current " +
        "after:transition-transform after:duration-[var(--dur-fast)] after:ease-[var(--ease-out-expo)] motion-reduce:after:transition-none " +
        "hover:after:origin-left hover:after:scale-x-100 focus-visible:after:origin-left focus-visible:after:scale-x-100"
      }
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
    >
      {children}
    </Link>
  );
}

export function Footer() {
  const [footRef, seen] = useInViewOnce<HTMLElement>(0.1);
  const reduced = useReducedMotion();

  // Link columns stagger-fade once on first view — 40ms stagger, 500ms,
  // starts as soon as the footer edges into view (never feels late).
  useLayoutEffect(() => {
    const root = footRef.current;
    if (!root || reduced) return;
    const cols = root.querySelectorAll(".ftr-col");
    if (cols.length) utils.set(cols, { opacity: 0, y: 10 });
    return () => {
      if (cols.length) utils.set(cols, { clear: "all" });
    };
  }, [reduced, footRef]);

  useEffect(() => {
    const root = footRef.current;
    if (!root || !seen || reduced) return;
    const a = animate(root.querySelectorAll(".ftr-col"), {
      ...fadeUp(10, 500),
      delay: stagger(40),
    });
    return () => {
      a.revert();
    };
  }, [seen, reduced, footRef]);

  return (
    <footer ref={footRef as RefObject<HTMLElement>} className="border-t border-line bg-surface">
      <Container width="wide" className="py-14 md:py-16">
        <div className="grid gap-10 sm:grid-cols-2 sm:gap-x-8 lg:grid-cols-[1.4fr_1fr_1fr_1fr] lg:gap-8">
          {/* Brand block — full row on tablet so link columns align below */}
          <div className="max-w-sm sm:col-span-2 lg:col-span-1">
            <Link
              href="/"
              className="inline-flex items-center gap-2.5 rounded-lg text-ink focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand"
            >
              <span className="flex size-9 items-center justify-center rounded-lg border border-line bg-brand-soft text-brand">
                <IconGateway size={20} />
              </span>
              <span className="text-lg font-semibold tracking-tight">ToLLma</span>
            </Link>
            <p className="mt-4 text-sm leading-relaxed text-muted">
              The open-source AI gateway for models and agents — one endpoint in
              front of every provider you use.
            </p>
            <p className="mt-3 text-xs text-faint">Licensed under Apache 2.0.</p>
          </div>

          {/* Link columns */}
          {footerLinks.map((col) => (
            <nav key={col.title} aria-label={col.title} className="ftr-col">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-ink">
                {col.title}
              </h3>
              <ul className="mt-4 space-y-3">
                {col.links.map((l) => (
                  <li key={l.label}>
                    <FooterLink href={l.href}>{l.label}</FooterLink>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        {/* Bottom bar */}
        <div className="mt-12 flex flex-col gap-2 border-t border-line pt-6 text-xs text-faint sm:flex-row sm:items-center sm:justify-between">
          <p>© 2026 ToLLma. Licensed under Apache 2.0.</p>
          {IS_PLACEHOLDER_LINKS && (
            <p>
              Docs, roadmap and community links currently point to the placeholder
              repository.
            </p>
          )}
        </div>
      </Container>
    </footer>
  );
}
