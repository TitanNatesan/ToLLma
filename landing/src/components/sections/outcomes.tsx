"use client";

// Outcomes carousel — SCROLL-DRIVEN via a ~250vh sticky stage on md+ only:
// scroll progress selects slide 0→1→2 (thin progress ticks track the active
// slide), with a smooth switch (stat wipes first, quote crossfades). The
// ← → buttons scroll to that slide's position while a suppress flag keeps
// the scroll driver from hard-cutting the in-flight switch. Below md the
// sticky stage would trap touch scroll, so the slides render as a static
// stacked list instead (no sticky, no overflow-hidden clipping). All slide
// content is verified site.ts facts — no invented metrics or testimonials.
// Reduced-motion / no-JS: static slide 0, no sticky.
import { useCallback, useEffect, useRef, useState } from "react";
import { Container } from "@/components/ui/layout";
import { GUARDRAIL_CATEGORIES, PROVIDERS } from "@/lib/site";
import { useReducedMotion, useRevealOnScroll } from "@/lib/animations";

const SLIDES = [
  {
    stat: String(PROVIDERS.length),
    caption: "Provider adapters",
    ticks: ["OpenAI · Anthropic", "Gemini · Vertex AI", "Bedrock · Custom"],
    quote:
      "One OpenAI-compatible endpoint for every provider — Chat Completions plus Responses.",
    attr: "ToLLma · Providers",
  },
  {
    stat: String(GUARDRAIL_CATEGORIES.length),
    caption: "Guardrail categories",
    ticks: ["Prompt injection", "PII + secrets", "Tool actions"],
    quote:
      "Every request is checked before it runs — monitor or block, globally or per key.",
    attr: "ToLLma · Guardrails",
  },
  {
    // A concept count (one gateway endpoint), not a list length — keep literal.
    stat: "1",
    caption: "Gateway endpoint",
    ticks: ["Same keys", "Same shape", "Every model"],
    quote: "Apps and agents integrate once — swap providers without rewriting.",
    attr: "ToLLma · Quickstart",
  },
];

type Phase = "idle" | "out" | "stat" | "quote";

const REGION_VH = 250;

/* Static slide pane for the mobile stacked list (always settled, no switch). */
function StaticSlide({ n }: { n: number }) {
  const s = SLIDES[n];
  return (
    <div data-reveal className="grid bg-white md:grid-cols-2">
      <div className="flex min-h-[240px] flex-col justify-center px-8 py-10">
        <p className="font-serif text-6xl font-medium tracking-tight text-coal">{s.stat}</p>
        <p className="mt-3 text-[1.05rem] font-medium text-coal/70">{s.caption}</p>
        <div className="mt-8 flex gap-2" aria-hidden="true">
          {SLIDES.map((_, i) => (
            <span
              key={i}
              className={`h-[3px] w-16 ${i === n ? "bg-[#2f9e6e]" : "bg-coal/15"}`}
            />
          ))}
        </div>
      </div>
      <div className="flex flex-col justify-center border-t border-cream-line px-8 py-10 md:border-l md:border-t-0">
        <span aria-hidden="true" className="font-serif text-5xl leading-none text-mint">
          &ldquo;
        </span>
        <p className="-mt-3 text-[1.15rem] leading-snug text-coal">{s.quote}</p>
        <p className="mt-5 text-sm font-semibold text-coal">{s.attr}</p>
      </div>
    </div>
  );
}

export default function Outcomes() {
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>("idle");
  const timers = useRef<number[]>([]);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  // While a button-initiated smooth scroll is in flight, the scroll driver
  // stays out of the way so it can't hard-cut the switch mid-transition.
  const suppressRef = useRef<{ until: number; y: number } | null>(null);
  const [jsReady, setJsReady] = useState(false);
  const reduced = useReducedMotion();
  const revealRef = useRevealOnScroll({ staggerMs: 80 });
  const slide = SLIDES[index];
  const indexRef = useRef(index);
  indexRef.current = index;
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  useEffect(() => {
    setJsReady(true);
  }, []);

  useEffect(() => () => {
    timers.current.forEach((t) => window.clearTimeout(t));
  }, []);

  const static_ = !jsReady || reduced;

  const transitionTo = useCallback(
    (target: number) => {
      timers.current.forEach((t) => window.clearTimeout(t));
      timers.current = [];
      if (reduced || !jsReady) {
        setIndex(target);
        setPhase("idle");
        return;
      }
      if (target === indexRef.current && phaseRef.current === "idle") return;
      setPhase("out");
      timers.current.push(
        window.setTimeout(() => {
          setIndex(target);
          setPhase("stat");
        }, 200)
      );
      timers.current.push(window.setTimeout(() => setPhase("quote"), 580));
      timers.current.push(window.setTimeout(() => setPhase("idle"), 920));
    },
    [reduced, jsReady]
  );

  // Scroll progress through the tall region selects the slide.
  useEffect(() => {
    if (static_) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const el = wrapRef.current;
      // Hidden below md (stacked list owns the content there) — nothing to drive.
      if (!el || el.offsetParent === null) return;
      const sup = suppressRef.current;
      if (sup) {
        const settled =
          Math.abs(window.scrollY - sup.y) < 12 || performance.now() > sup.until;
        if (!settled) return;
        suppressRef.current = null;
      }
      const total = el.offsetHeight - window.innerHeight;
      const rect = el.getBoundingClientRect();
      const v = total > 0 ? Math.min(1, Math.max(0, -rect.top / total)) : 0;
      const next = v < 1 / 3 ? 0 : v < 2 / 3 ? 1 : 2;
      if (next === indexRef.current) return;
      if (phaseRef.current === "idle") {
        transitionTo(next);
      } else {
        // Fast scroll mid-transition: stay in sync with a hard cut so the
        // sticky card never shows the wrong slide.
        timers.current.forEach((t) => window.clearTimeout(t));
        timers.current = [];
        setIndex(next);
        setPhase("idle");
      }
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [static_, transitionTo]);

  // Buttons scroll to that slide's position; the index is set immediately so
  // the switch feels instant, and the suppress flag stops the scroll driver
  // from double-driving (and flickering) until the scroll settles.
  const scrollToSlide = (n: number) => {
    const el = wrapRef.current;
    if (static_ || !el) {
      transitionTo(n);
      return;
    }
    const top = el.getBoundingClientRect().top + window.scrollY;
    const total = el.offsetHeight - window.innerHeight;
    const y = top + ((n + 0.5) / SLIDES.length) * total;
    suppressRef.current = { until: performance.now() + 1600, y };
    transitionTo(n);
    window.scrollTo({ top: y, behavior: "smooth" });
  };

  // Arrows stay focusable mid-transition (aria-disabled, presses ignored)
  // instead of `disabled`, so keyboard focus is never lost.
  const go = (dir: 1 | -1) => {
    if (phaseRef.current !== "idle") return;
    scrollToSlide((index + dir + SLIDES.length) % SLIDES.length);
  };
  const busy = phase !== "idle";

  const card = (
    <div data-reveal className="relative mx-auto w-full max-w-5xl">
      <div className="grid bg-white md:grid-cols-2">
        {/* Left: stat wipes first */}
        <div className="flex min-h-[300px] flex-col justify-center overflow-hidden px-8 py-12 md:px-12">
          <p
            key={`stat-${index}`}
            className={`font-serif text-7xl font-medium tracking-tight text-coal md:text-8xl ${phase === "out" ? "stat-wipe-out" : phase !== "idle" ? "stat-wipe-enter" : ""}`}
          >
            {slide.stat}
          </p>
          <p
            key={`cap-${index}`}
            className={`mt-3 text-[1.05rem] font-medium text-coal/70 ${phase === "out" ? "stat-wipe-out" : phase !== "idle" ? "stat-wipe-enter" : ""}`}
          >
            {slide.caption}
          </p>
          <div className="mt-8 flex gap-2" aria-hidden="true">
            {SLIDES.map((_, i) => (
              <span
                key={i}
                className={`h-[3px] w-16 transition-colors duration-300 ${i === index ? "bg-[#2f9e6e]" : "bg-coal/15"}`}
              />
            ))}
          </div>
          <p className="sr-only" aria-live="polite">
            Slide {index + 1} of {SLIDES.length}: {slide.stat} {slide.caption}
          </p>
        </div>
        {/* Right: quote crossfades after the stat */}
        <div className="flex flex-col justify-center border-t border-cream-line px-8 py-12 md:border-l md:border-t-0 md:px-12">
          <div
            key={`quote-${index}`}
            className={phase === "quote" || phase === "idle" ? "quote-fade-enter" : undefined}
          >
            <span aria-hidden="true" className="font-serif text-5xl leading-none text-mint">
              &ldquo;
            </span>
            <p className="-mt-3 text-[1.15rem] leading-snug text-coal">{slide.quote}</p>
            <p className="mt-5 text-sm font-semibold text-coal">{slide.attr}</p>
          </div>
        </div>
      </div>

      {/* Arrows: bottom-right, overlapping the card edge */}
      <div className="absolute -bottom-6 right-6 flex md:right-10">
        <button
          type="button"
          onClick={() => go(-1)}
          aria-disabled={busy}
          aria-label="Previous outcome"
          className={`flex size-12 items-center justify-center border border-cream-line bg-white text-xl text-coal transition-colors hover:bg-cream ${busy ? "opacity-40" : ""}`}
        >
          ←
        </button>
        <button
          type="button"
          onClick={() => go(1)}
          aria-disabled={busy}
          aria-label="Next outcome"
          className={`-ml-px flex size-12 items-center justify-center border border-cream-line bg-white text-xl text-coal transition-colors hover:bg-cream ${busy ? "opacity-40" : ""}`}
        >
          →
        </button>
      </div>
    </div>
  );

  return (
    <section id="outcomes" ref={revealRef} className="scroll-mt-20 bg-sage">
      <Container width="wide" className="pt-20 md:pt-28">
        <p data-reveal className="text-center text-xs font-medium text-coal/60">
          Outcomes
        </p>
        <h2 data-reveal className="mx-auto mt-4 max-w-3xl text-center font-serif text-4xl font-medium tracking-tight text-coal md:text-5xl">
          One gateway. Every model. Fully governed.
        </h2>
      </Container>

      {static_ ? (
        <Container width="wide" className="pb-20 pt-12 md:pb-28">
          {card}
        </Container>
      ) : (
        <>
          {/* Sticky scroll-stage: md+ only — it would trap touch scroll on phones. */}
          <div ref={wrapRef} className="relative hidden md:block" style={{ height: `${REGION_VH}vh` }}>
            <div className="sticky top-0 flex h-screen items-center justify-center overflow-hidden px-6">
              {card}
            </div>
          </div>
          {/* Mobile: the same slides as a static stacked list. */}
          <div className="px-6 pb-20 pt-12 md:hidden">
            <div className="mx-auto flex w-full max-w-5xl flex-col gap-10">
              {SLIDES.map((s, n) => (
                <StaticSlide key={s.caption} n={n} />
              ))}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
