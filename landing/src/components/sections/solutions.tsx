"use client";

// Provider grid, 3×2 with hairline dividers: one bordered cell per verified
// adapter (name + API type from site.ts), hover → white card + teal
// "Explore →". Last cell is the "Don't see yours?" catch-all pointing at
// any OpenAI-compatible endpoint (the verified `custom` adapter class).
import { Container } from "@/components/ui/layout";
import { DOCS_URL, PROVIDERS } from "@/lib/site";
import { useRevealOnScroll } from "@/lib/animations";
import { AnthropicMark, OpenAIMark } from "./brand/provider-marks";
import googleG from "./brand/providers-google-g.png";
import vertexPng from "./brand/providers-vertex.png";
import bedrockPng from "./brand/providers-bedrock.png";

const CELLS = PROVIDERS.filter((p) => p.id !== "custom").map((p) => ({
  id: p.id,
  name: p.name,
  api: p.api,
  note: p.note,
}));

// Official marks: OpenAI/Anthropic/Google from the vendors' own brand kits
// (user-supplied zips); Vertex AI / Bedrock from the official pixels the app
// already vendors (Google Cloud favicon, AWS CDN touch icon). Anything
// without an official mark stays text-only — no lookalikes.
const MARKS: Record<string, React.ReactNode> = {
  openai: <OpenAIMark className="h-7 w-7 text-coal" />,
  anthropic: <AnthropicMark className="h-6 w-auto" />,
  gemini: <img src={googleG.src} alt="" width={28} height={28} className="h-7 w-7 object-contain" />,
  vertex: <img src={vertexPng.src} alt="" width={28} height={28} className="h-7 w-7 object-contain" />,
  // AWS mark is white-on-dark in the official pixels: show the tile as-is
  // (rounded like an app icon) rather than altering their artwork.
  bedrock: <img src={bedrockPng.src} alt="" width={28} height={28} className="h-7 w-7 rounded-md object-cover" />,
};

/* Target-lock corners: 4 L-brackets that scale in from their corners on
   cell hover / focus-within / focus-visible (see globals.css). */
function TargetCorners() {
  return (
    <>
      <span aria-hidden="true" className="target-corner target-tl" />
      <span aria-hidden="true" className="target-corner target-tr" />
      <span aria-hidden="true" className="target-corner target-bl" />
      <span aria-hidden="true" className="target-corner target-br" />
    </>
  );
}

export default function Solutions() {
  const revealRef = useRevealOnScroll({ staggerMs: 90, y: 16 });
  return (
    <section id="solutions" ref={revealRef} className="scroll-mt-20 bg-cream">
      <Container width="wide" className="py-20 md:py-28">
        <p data-reveal className="text-center text-xs font-medium text-coal/60">
          Our Solutions
        </p>
        <h2 data-reveal className="mx-auto mt-4 max-w-2xl text-center font-serif text-4xl font-medium tracking-tight text-coal md:text-5xl">
          Provider-agnostic by design
        </h2>
        <p data-reveal className="mx-auto mt-5 max-w-xl text-center text-[1.05rem] leading-relaxed text-coal/70">
          The ToLLma gateway plugs seamlessly into any provider. Apps and
          agents integrate once — without locking you into any vendor or model.
        </p>

        <div
          id="providers"
          className="mx-auto mt-12 grid max-w-5xl scroll-mt-24 grid-cols-1 gap-px border border-cream-line bg-cream-line min-[560px]:grid-cols-2 lg:grid-cols-3"
        >
          {CELLS.map((c) => (
            <a
              key={c.name}
              href={DOCS_URL}
              target="_blank"
              rel="noopener noreferrer"
              data-reveal
              className="group relative flex min-h-[190px] flex-col bg-cream p-7 transition-colors duration-200 hover:bg-white"
            >
              <TargetCorners />
              {/* Fixed-height mark slot keeps names aligned across cells,
                  whether or not a vendor kit was supplied. */}
              <span className="flex h-8 items-center" aria-hidden="true">
                {MARKS[c.id]}
              </span>
              <span className="font-serif text-[1.7rem] font-medium text-coal">{c.name}</span>
              <span className="mt-1 text-sm font-medium text-coal/55">{c.api}</span>
              <span className="mt-auto inline-flex items-center gap-1.5 pt-5 text-[0.95rem] font-semibold text-coal transition-colors group-hover:text-[#0e7490]">
                Explore
                <span aria-hidden="true" className="transition-transform duration-200 group-hover:translate-x-1">→</span>
              </span>
            </a>
          ))}
          <a
            href={DOCS_URL}
            target="_blank"
            rel="noopener noreferrer"
            data-reveal
            className="group relative flex min-h-[190px] flex-col bg-cream p-7"
          >
            <TargetCorners />
            <p className="text-[1.05rem] leading-snug text-coal/80">
              Don&apos;t see yours? ToLLma works with any OpenAI-compatible endpoint.
            </p>
            <span className="mt-auto inline-flex items-center gap-1.5 pt-5 text-[0.95rem] font-semibold text-coal transition-colors group-hover:text-[#0e7490]">
              Explore
              <span aria-hidden="true" className="transition-transform duration-200 group-hover:translate-x-1">→</span>
            </span>
          </a>
        </div>
      </Container>
    </section>
  );
}
