import Nav from "@/components/sections/nav";
import Hero from "@/components/sections/hero";
import Marquee from "@/components/sections/marquee";
import PixelWipe from "@/components/sections/pixel-wipe";
import WhatWeDo from "@/components/sections/what-we-do";
import Outcomes from "@/components/sections/outcomes";
import Platform from "@/components/sections/platform";
import Solutions from "@/components/sections/solutions";
import Knowledge from "@/components/sections/knowledge";
import { CTA } from "@/components/sections/get-started";
import { Footer } from "@/components/sections/closing";

export default function Page() {
  return (
    <>
      <a
        href="#top"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-coal"
      >
        Skip to content
      </a>
      <Nav />
      <main id="top">
        <Hero />
        {/* R8 dividers (inverted): PREV-section field + NEXT-section teeth,
            rise-on-enter only — no parallax, no hairlines. */}
        <PixelWipe tone="light" />
        <Marquee />
        <WhatWeDo />
        <Outcomes />
        <PixelWipe tone="dark" field="bg-sage" block="bg-night" />
        <Platform />
        <PixelWipe tone="dark" />
        <Solutions />
        <PixelWipe tone="light" />
        <Knowledge />
        <PixelWipe tone="dark" />
        <CTA />
      </main>
      <Footer />
    </>
  );
}
