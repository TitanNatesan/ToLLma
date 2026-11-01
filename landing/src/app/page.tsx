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
        <PixelWipe tone="dark" />
        <Marquee />
        <WhatWeDo />
        <Outcomes />
        <PixelWipe tone="dark" band="bg-sage" />
        <Platform />
        <PixelWipe tone="light" flip cssDriven />
        <Solutions />
        <PixelWipe tone="dark" />
        <Knowledge />
        <PixelWipe tone="light" />
        <CTA />
      </main>
      <Footer />
    </>
  );
}
