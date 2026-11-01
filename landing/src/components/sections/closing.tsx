import Link from "next/link";
import { Container } from "@/components/ui/layout";
import { COMMUNITY_URL, DOCS_URL, GET_STARTED_URL, GITHUB_URL, LICENSE_URL, ROADMAP_URL } from "@/lib/site";
import tollmaLight from "./brand/tollma-light-256.png";

// Cream footer with top border: wordmark + 6 link columns (all hrefs are
// verified site.ts links or in-page anchors), bottom bar with
// © 2026 ToLLma, Apache-2.0, and Privacy/Terms as plain spans.
const COLS: { title: string; links: { label: string; href: string; external?: boolean }[] }[] = [
  {
    title: "Meet Our Gateway",
    links: [
      { label: "Route", href: "#platform" },
      { label: "Unify", href: "#platform" },
      { label: "Govern", href: "#platform" },
      { label: "Observe", href: "#platform" },
    ],
  },
  {
    title: "Solutions by Use Case",
    links: [
      { label: "Multi-provider routing", href: "#providers" },
      { label: "Guardrails", href: "#outcomes" },
      { label: "Request activity", href: "#activity" },
      { label: "Observability", href: "#knowledge" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "Platform", href: "#platform" },
      { label: "Documentation", href: DOCS_URL, external: true },
      { label: "GitHub", href: GITHUB_URL, external: true },
      { label: "License", href: LICENSE_URL, external: true },
    ],
  },
  {
    title: "Solutions by Provider",
    links: [
      { label: "OpenAI", href: "#providers" },
      { label: "Anthropic", href: "#providers" },
      { label: "Gemini", href: "#providers" },
      { label: "Bedrock", href: "#providers" },
    ],
  },
  {
    title: "Connect",
    links: [
      { label: "Documentation", href: DOCS_URL, external: true },
      { label: "Discussions", href: COMMUNITY_URL, external: true },
      { label: "Roadmap", href: ROADMAP_URL, external: true },
      { label: "Get Started", href: GET_STARTED_URL, external: true },
    ],
  },
  {
    title: "Knowledge Base",
    links: [
      { label: "Routing guide", href: "#knowledge" },
      { label: "Governance guide", href: "#knowledge" },
      { label: "Observability guide", href: "#knowledge" },
    ],
  },
];

export function Footer() {
  return (
    <footer id="company" className="scroll-mt-20 border-t border-cream-line bg-cream">
      <Container width="wide" className="py-14">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,2fr)_minmax(0,10fr)]">
          <div className="flex flex-col items-start gap-3">
            <Link href="#top" className="flex items-center gap-2" aria-label="ToLLma home">
              <img
                src={tollmaLight.src}
                alt=""
                width={28}
                height={28}
                className="size-7"
              />
              <span className="text-[1.1rem] font-semibold tracking-tight text-coal">ToLLma</span>
            </Link>
            <p className="max-w-xs text-sm leading-relaxed text-coal/60">
              The open source AI gateway for models and agents. Apache 2.0.
            </p>
          </div>
          <nav className="grid grid-cols-2 gap-8 min-[560px]:grid-cols-3 xl:grid-cols-6" aria-label="Footer">
            {COLS.map((c) => (
              <div key={c.title} className="flex flex-col items-start gap-4">
                <p className="text-xs font-semibold text-coal/50">{c.title}</p>
                <ul className="flex flex-col items-start gap-2.5">
                  {c.links.map((l) =>
                    l.external ? (
                      <li key={l.label}>
                        <a
                          href={l.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm leading-relaxed text-coal/75 transition-opacity hover:opacity-60"
                        >
                          {l.label}
                        </a>
                      </li>
                    ) : (
                      <li key={l.label}>
                        <Link
                          href={l.href}
                          className="text-sm leading-relaxed text-coal/75 transition-opacity hover:opacity-60"
                        >
                          {l.label}
                        </Link>
                      </li>
                    )
                  )}
                </ul>
              </div>
            ))}
          </nav>
        </div>
        <div className="mt-12 flex flex-col gap-3 border-t border-cream-line pt-6 text-sm text-coal/60 sm:flex-row sm:items-center sm:justify-between">
          <p>© 2026 ToLLma · Apache-2.0</p>
          <p className="flex gap-5">
            <span>Privacy</span>
            <span>Terms</span>
          </p>
        </div>
      </Container>
    </footer>
  );
}
