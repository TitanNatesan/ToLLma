import Nav from "@/components/sections/nav";
import Hero from "@/components/sections/hero";
import Problem from "@/components/sections/problem";
import Features from "@/components/sections/features";
import HowItWorks from "@/components/sections/how-it-works";
import Providers from "@/components/sections/providers";
import Product from "@/components/sections/product";
import Security from "@/components/sections/security";
import Developers from "@/components/sections/developers";
import OpenSource from "@/components/sections/opensource";
import SelfHosted from "@/components/sections/selfhosted";
import { CTA } from "@/components/sections/get-started";
import { Footer } from "@/components/sections/closing";

export default function Page() {
  return (
    <>
      <a
        href="#top"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:rounded-lg focus:bg-surface focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-brand-strong focus:shadow-md"
      >
        Skip to content
      </a>
      <Nav />
      <main id="top">
        <Hero />
        <Problem />
        <Features />
        <HowItWorks />
        <Providers />
        <Product />
        <Security />
        <Developers />
        <OpenSource />
        <SelfHosted />
        <CTA />
      </main>
      <Footer />
    </>
  );
}
