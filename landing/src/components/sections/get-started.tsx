"use client";

// Cream closing CTA, two columns: serif headline + copy left, black button
// on static pixel-block decor right. No scroll animation — decor is static.
import { Container } from "@/components/ui/layout";
import { BlackButton } from "@/components/ui/primitives";
import { GET_STARTED_URL } from "@/lib/site";

function PixelBlocks() {
  return (
    <div aria-hidden="true" className="relative h-56 w-full overflow-hidden md:h-72">
      <span className="absolute right-[8%] top-0 h-[38%] w-[34%] bg-coal" />
      <span className="absolute right-[30%] top-[38%] h-[24%] w-[22%] bg-coal" />
      <span className="absolute bottom-0 right-0 h-[38%] w-[62%] bg-coal" />
      <span className="absolute bottom-[38%] left-[16%] h-[24%] w-[12%] bg-coal" />
      <span className="absolute left-0 top-[30%] h-[20%] w-[10%] bg-coal" />
    </div>
  );
}

export function CTA() {
  return (
    <section id="get-started" className="scroll-mt-20 overflow-hidden bg-cream">
      <Container width="wide" className="grid items-center gap-10 py-20 md:grid-cols-2 md:py-28">
        <div>
          <h2 className="max-w-md font-serif text-4xl font-medium tracking-tight text-coal md:text-5xl">
            Move from juggling keys to running the business.
          </h2>
          <p className="mt-5 max-w-md text-[1.05rem] leading-relaxed text-coal/70">
            One gateway for all your AI models and agents. Open source, Apache 2.0.
          </p>
        </div>
        <div className="relative">
          <PixelBlocks />
          <BlackButton
            href={GET_STARTED_URL}
            ariaLabel="Get started with ToLLma"
            className="absolute bottom-[8%] right-[14%] px-8 py-4"
          >
            Get Started <span aria-hidden="true">→</span>
          </BlackButton>
        </div>
      </Container>
    </section>
  );
}
