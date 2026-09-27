import Nav from "@/components/nav";
import Hero from "@/components/hero";
import Problem from "@/components/problem";
import Features from "@/components/features";
import Architecture from "@/components/architecture";
import Screenshots from "@/components/screenshots";
import Why from "@/components/why";
import Roadmap from "@/components/roadmap";
import OpenSource from "@/components/opensource";
import { CTA, Footer } from "@/components/closing";

export default function Page() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <Problem />
        <Features />
        <Architecture />
        <Screenshots />
        <Why />
        <Roadmap />
        <OpenSource />
        <CTA />
      </main>
      <Footer />
    </>
  );
}
