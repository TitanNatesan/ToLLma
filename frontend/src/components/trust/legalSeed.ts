/**
 * Legal catalogue helpers (Agent E, Wave 3).
 *
 * The server list carries no `summary`/`category` — both are E-side display
 * derived from the frozen 20-doc registry below. `LEGAL_DOCUMENT_SEED` is
 * now a backend-absent fallback only (live-first everywhere).
 */

import type { LegalDocument } from "@/types/trust";

type Category = NonNullable<LegalDocument["category"]>;

const REGISTRY: Array<{
  slug: string;
  title: string;
  summary: string;
  category: Category;
}> = [
  { slug: "terms-of-service", title: "Terms of Service", summary: "The agreement governing your use of ToLLma.", category: "core" },
  { slug: "acceptable-use-policy", title: "Acceptable Use Policy", summary: "Prohibited uses of the platform.", category: "core" },
  { slug: "age-eligibility", title: "Age Eligibility Policy", summary: "18+ eligibility and confirmation.", category: "core" },
  { slug: "privacy-notice", title: "Privacy Notice", summary: "What personal data we collect and why.", category: "privacy" },
  { slug: "cookie-policy", title: "Cookie Policy", summary: "Cookies and similar technologies we use.", category: "privacy" },
  { slug: "dsr-procedure", title: "DSR Procedure", summary: "How data subject requests are handled.", category: "privacy" },
  { slug: "grievance-redressal", title: "Grievance Redressal", summary: "How to raise and escalate complaints.", category: "privacy" },
  { slug: "infosec-overview", title: "Information Security Overview", summary: "How we protect the platform and your data.", category: "security" },
  { slug: "coordinated-disclosure", title: "Coordinated Disclosure", summary: "How to report vulnerabilities to us.", category: "security" },
  { slug: "data-processing-addendum", title: "Data Processing Addendum", summary: "Processor terms for customer personal data.", category: "data" },
  { slug: "retention-deletion-policy", title: "Retention & Deletion Policy", summary: "How long data is kept and how deletion works.", category: "data" },
  { slug: "subprocessor-list", title: "Subprocessor List", summary: "Third parties that process customer data.", category: "data" },
  { slug: "responsible-ai-use", title: "Responsible AI Use", summary: "Rules for AI-generated content and model use.", category: "ai" },
  { slug: "model-provider-disclosure", title: "Model Provider Disclosure", summary: "Terms covering third-party model providers.", category: "ai" },
  { slug: "sla", title: "Service Level Agreement", summary: "Uptime targets and support response times.", category: "operations" },
  { slug: "support-policy", title: "Support Policy", summary: "Support channels, hours, and severity levels.", category: "operations" },
  { slug: "transparency-report", title: "Transparency Report", summary: "Periodic disclosure of requests and actions.", category: "operations" },
  { slug: "selfhost-operator-guide", title: "Self-Host Operator Guide", summary: "Responsibilities when operating ToLLma yourself.", category: "operations" },
  { slug: "copyright-dmca", title: "Copyright & DMCA", summary: "Takedown request handling.", category: "operations" },
  { slug: "law-enforcement-policy", title: "Law Enforcement Policy", summary: "How legal requests from authorities are handled.", category: "operations" },
];

const BY_SLUG = new Map(REGISTRY.map((entry) => [entry.slug, entry]));

export const LEGAL_CATEGORY_LABELS: Record<Category, string> = {
  core: "Core",
  privacy: "Privacy",
  security: "Security",
  data: "Data",
  ai: "AI",
  operations: "Operations",
};

/** E-side display for a live server document (server has no summary/category). */
export function decorateLegalDocument(doc: LegalDocument): LegalDocument {
  const known = BY_SLUG.get(doc.slug);
  return {
    ...doc,
    summary: doc.summary ?? known?.summary ?? "Legal document.",
    category: doc.category ?? known?.category ?? "operations",
  };
}

/** Backend-absent fallback: same 20 slugs, honestly undated. */
export const LEGAL_DOCUMENT_SEED: LegalDocument[] = REGISTRY.map((entry) => ({
  slug: entry.slug,
  version: "0.1.0-draft",
  title: entry.title,
  locale: "en-IN",
  status: "published",
  // ponytail: provisional hash — the server computes sha256 over canonical
  // markdown (F1); seed rows never present as verified.
  content_hash: "sha256:pending-live-registry",
  requires_reaccept: false,
  effective_at: null,
  summary: entry.summary,
  category: entry.category,
}));

export function findSeedDocument(slug: string): LegalDocument | undefined {
  return LEGAL_DOCUMENT_SEED.find((doc) => doc.slug === slug);
}

/** Backend-absent placeholder body: honest draft notice, never binding text. */
export function seedBodyNotice(doc: LegalDocument): string {
  return [
    `# ${doc.title}`,
    ``,
    `> The live registry is unavailable, so this bundled entry carries no`,
    `> binding text. The published version will appear here with its content`,
    `> hash (F1) once the backend is reachable.`,
    ``,
    `${doc.summary ?? "Legal document."}`,
    ``,
  ].join("\n");
}
