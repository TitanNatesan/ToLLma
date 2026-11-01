"use client";

// Outcomes carousel — SCROLL-DRIVEN via a ~350vh sticky stage on md+ only:
// the eyebrow + heading ride INSIDE the sticky viewport (pinned like a
// ScrollTrigger pin — visible the whole time cards are shown, released when
// the tall region ends), scroll progress selects slide 0→1→2→3 (thin
// progress ticks track the active slide), with a smooth switch (stat wipes
// first, quote crossfades). The ← → buttons scroll to that slide's position
// while a suppress flag keeps the scroll driver from hard-cutting the
// in-flight switch. Below md the sticky stage would trap touch scroll, so
// the slides render as a static stacked list instead (no sticky, no
// overflow-hidden clipping). Stats count up 0→value (1.2s ease-out) at 50%
// visibility, once per activation; stacked cards enter staggered and drift
// at 0.9/1.0/1.1/1.0 parallax; a mint gradient shifts behind at 0.1. Each
// card carries an abstract mini-visual (aria-hidden, NOT a count — 6 dots /
// 10 ticks / endpoint pulse) that runs once on entry then idles; cards lift
// + stat weight shifts on hover. Slide 0 keeps verified site.ts-adjacent
// copy; slides 1–3 carry DRAFT copy (see marks) with 200+/9000+ flagged
// unverified below — never presented as verified facts.
// Reduced-motion / no-JS: static slide 0, no sticky, final numbers.
import { useCallback, useEffect, useRef, useState } from "react";
import { Container } from "@/components/ui/layout";
import { Parallax } from "@/components/ui/parallax";
import { Reveal } from "@/components/ui/reveal";
import { GUARDRAIL_CATEGORIES, PROVIDERS } from "@/lib/site";
import {
  animate,
  stagger,
  useInViewOnce,
  useInViewToggle,
  useReducedMotion,
  useRevealOnScroll,
  utils,
} from "@/lib/animations";
import { prefersReducedMotion } from "@/lib/animations/motion-preference";

export type OutcomeStat = {
  display: string;
  countTo: number | null;
  suffix: string;
  label: string;
  quote: string;
  attr: string;
  verified: boolean;
};

/* Four ordered outcomes. `verified:false` on the two unconfirmed draft
   figures (200+, 9000+) — flagged in UI + report, never stated as fact. */
export const OUTCOME_STATS: OutcomeStat[] = [
  {
    display: "1",
    countTo: 1,
    suffix: "",
    label: "One Proxy",
    quote:
      "One OpenAI-compatible endpoint for every provider — Chat Completions plus Responses.",
    attr: "ToLLma · Providers",
    verified: true,
  },
  /* DRAFT copy — unverified */
  {
    display: "200+",
    countTo: 200,
    suffix: "+",
    label: "API Providers",
    quote:
      "Every provider behind one OpenAI-compatible shape — swap APIs without rewriting calls.",
    attr: "ToLLma · Providers",
    verified: false,
  },
  /* DRAFT copy — unverified */
  {
    display: "9000+",
    countTo: 9000,
    suffix: "+",
    label: "Models",
    quote:
      "Every model behind the same gateway — switch by name, never by SDK.",
    attr: "ToLLma · Models",
    verified: false,
  },
  /* DRAFT copy — unverified */
  {
    display: "∞",
    countTo: null,
    suffix: "",
    label: "Endless Integrations",
    quote:
      "Wire agents, tools, and pipelines once — every integration speaks the same protocol.",
    attr: "ToLLma · Integrations",
    verified: true,
  },
];

type Phase = "idle" | "out" | "stat" | "quote";

const REGION_VH = 350;

/* Number ticker: counts 0→value once visible at 50% (1.2s ease-out).
   SSR/reduced-motion render the final value. */
function CountStat({ value, suffix = "" }: { value: number; suffix?: string }) {
  const [ref, seen] = useInViewOnce<HTMLSpanElement>(0.5);

  useEffect(() => {
    const el = ref.current;
    if (!el || !seen) return;
    if (prefersReducedMotion()) {
      el.textContent = `${value}${suffix}`;
      return;
    }
    const state = { v: 0 };
    el.textContent = `0${suffix}`;
    const a = animate(state, {
      v: value,
      duration: 1200,
      ease: "outQuad",
      onUpdate: () => {
        el.textContent = `${Math.round(state.v)}${suffix}`;
      },
    });
    return () => {
      a.revert();
      el.textContent = `${value}${suffix}`;
    };
  }, [ref, seen, value, suffix]);

  return (
    <span ref={ref}>
      {value}
      {suffix}
    </span>
  );
}

/* Per-card mini-visual: runs once on entry, then idles on CSS. Abstract and
   aria-hidden — dot/tick counts illustrate, they are NOT the card figures.
   1 → provider dots light in sequence (PROVIDERS.length, verified);
   2 → generic ticks fill; 0 + 3 → endpoint pulse (CSS-only).
   Static finals under reduced-motion. */
function SlideVisual({ n }: { n: number }) {
  const [ref, seen] = useInViewOnce<HTMLDivElement>(0.4);

  useEffect(() => {
    const root = ref.current;
    if (!root || !seen || (n !== 1 && n !== 2) || prefersReducedMotion()) return;
    const items = Array.from(root.querySelectorAll<HTMLElement>(".viz-bit"));
    if (!items.length) return;
    utils.set(items, { opacity: 0, scale: 0.4 });
    const a = animate(items, {
      opacity: [0, 1],
      scale: [0.4, 1],
      duration: 400,
      delay: stagger(90),
      ease: "outExpo",
    });
    return () => {
      a.revert();
    };
  }, [ref, seen, n]);

  if (n === 1) {
    return (
      <div ref={ref} className="mt-5 flex items-center gap-1.5" aria-hidden="true">
        {PROVIDERS.map((p, i) => (
          <span
            key={p.id}
            title={p.name}
            className="viz-bit viz-dot"
            style={{ animationDelay: `${(i * 0.35).toFixed(2)}s` }}
          />
        ))}
      </div>
    );
  }
  if (n === 2) {
    return (
      <div ref={ref} className="mt-5 flex items-center gap-1" aria-hidden="true">
        {GUARDRAIL_CATEGORIES.map((c) => (
          <span key={c} className="viz-bit viz-tick" />
        ))}
      </div>
    );
  }
  return (
    <div ref={ref} className="mt-5 flex items-center" aria-hidden="true">
      <span className="viz-pulse">
        <span className="viz-pulse-dot" />
        <span className="viz-pulse-ring" />
      </span>
    </div>
  );
}

/* Static slide pane for the mobile stacked list (always settled, no switch). */
function StaticSlide({ n }: { n: number }) {
  const s = OUTCOME_STATS[n];
  return (
    <div className="outcome-card grid bg-white md:grid-cols-2">
      <div className="flex min-h-[200px] flex-col justify-center px-6 py-8">
        <p className="outcome-stat font-serif text-6xl font-medium tracking-tight text-coal">
          {s.countTo == null ? <span>∞</span> : <CountStat value={s.countTo} suffix={s.suffix} />}
        </p>
        <p className="mt-3 text-[1.05rem] font-medium text-coal/70">{s.label}</p>
        <SlideVisual n={n} />
        <div className="mt-6 flex gap-2" aria-hidden="true">
          {OUTCOME_STATS.map((_, i) => (
            <span
              key={i}
              className={`h-[3px] w-16 ${i === n ? "bg-[#2f9e6e]" : "bg-coal/15"}`}
            />
          ))}
        </div>
      </div>
      <div className="flex flex-col justify-center border-t border-cream-line px-6 py-8 md:border-l md:border-t-0">
        <span aria-hidden="true" className="font-serif text-5xl leading-none text-mint">
          &ldquo;
        </span>
        <p className="-mt-3 text-[1.15rem] leading-snug text-coal">{s.quote}</p>
        <p className="mt-5 text-sm font-semibold text-coal">{s.attr}</p>
      </div>
    </div>
  );
}

/* Pinned heading: eyebrow + title shared by sticky/mobile/static branches
   (only one branch is ever displayed, so a single heading is exposed). */
function OutcomeHeading() {
  return (
    <>
      <p data-reveal className="text-center text-xs font-medium text-coal/60">
        Outcomes
      </p>
      <h2
        data-reveal
        className="mx-auto mt-4 max-w-3xl text-center font-serif text-4xl font-medium tracking-tight text-coal md:text-5xl"
      >
        One gateway. Every model. Fully governed.
      </h2>
    </>
  );
}

/* Subtle unverified-figures flag — keeps draft 200+/9000+ from reading as fact. */
function DraftNote() {
  return (
    <p className="mt-6 text-center text-xs text-coal/45">
      Draft figures — 200+ providers and 9000+ models are placeholders pending verification.
    </p>
  );
}

const CARD_SPEEDS = [0.9, 1.0, 1.1, 1.0];

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
  // Infinite viz loops idle unless the section is in view (enter/exit).
  const [vizRef, vizPlaying] = useInViewToggle<HTMLElement>(0);
  const slide = OUTCOME_STATS[index];
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
      const next = v < 1 / 4 ? 0 : v < 2 / 4 ? 1 : v < 3 / 4 ? 2 : 3;
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
    const y = top + ((n + 0.5) / OUTCOME_STATS.length) * total;
    suppressRef.current = { until: performance.now() + 1600, y };
    transitionTo(n);
    window.scrollTo({ top: y, behavior: "smooth" });
  };

  // Arrows stay focusable mid-transition (aria-disabled, presses ignored)
  // instead of `disabled`, so keyboard focus is never lost.
  const go = (dir: 1 | -1) => {
    if (phaseRef.current !== "idle") return;
    scrollToSlide((index + dir + OUTCOME_STATS.length) % OUTCOME_STATS.length);
  };
  const busy = phase !== "idle";

  const card = (
    <div data-reveal className="relative mx-auto w-full max-w-5xl">
      <div className="outcome-card grid bg-white md:grid-cols-2">
        {/* Left: stat wipes first */}
        <div className="flex min-h-[240px] flex-col justify-center overflow-hidden px-6 py-8 md:px-10">
          <p
            key={`stat-${index}`}
            className={`outcome-stat font-serif text-7xl font-medium tracking-tight text-coal md:text-8xl ${phase === "out" ? "stat-wipe-out" : phase !== "idle" ? "stat-wipe-enter" : ""}`}
          >
            {slide.countTo == null ? (
              <span>∞</span>
            ) : (
              <CountStat value={slide.countTo} suffix={slide.suffix} />
            )}
          </p>
          <p
            key={`cap-${index}`}
            className={`mt-3 text-[1.05rem] font-medium text-coal/70 ${phase === "out" ? "stat-wipe-out" : phase !== "idle" ? "stat-wipe-enter" : ""}`}
          >
            {slide.label}
          </p>
          <SlideVisual n={index} />
          <div className="mt-6 flex gap-2" aria-hidden="true">
            {OUTCOME_STATS.map((_, i) => (
              <span
                key={i}
                className={`h-[3px] w-16 transition-colors duration-300 ${i === index ? "bg-[#2f9e6e]" : "bg-coal/15"}`}
              />
            ))}
          </div>
          <p className="sr-only" aria-live="polite">
            Slide {index + 1} of {OUTCOME_STATS.length}: {slide.display} {slide.label}
          </p>
        </div>
        {/* Right: quote crossfades after the stat */}
        <div className="flex flex-col justify-center border-t border-cream-line px-6 py-8 md:border-l md:border-t-0 md:px-10">
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
    <section
      id="outcomes"
      ref={(el) => {
        revealRef.current = el;
        vizRef.current = el;
      }}
      data-playing={vizPlaying}
      className="relative scroll-mt-20 bg-sage"
    >
      {/* Clip is on this sibling wrapper — never on the section itself, so
          the md+ sticky scroll-stage keeps working. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <Parallax speed={0.1} className="h-full w-full">
          <div className="outcome-glow h-[130%] w-full" />
        </Parallax>
      </div>

      {static_ ? (
        <Container width="wide" className="relative pb-20 pt-20 md:pt-28">
          <OutcomeHeading />
          <div className="pt-12">{card}</div>
          <DraftNote />
        </Container>
      ) : (
        <>
          {/* Sticky scroll-stage: md+ only — it would trap touch scroll on phones.
              Heading rides inside the sticky viewport: pinned the whole time
              cards show, released when the tall region ends. */}
          <div ref={wrapRef} className="relative hidden md:block" style={{ height: `${REGION_VH}vh` }}>
            <div className="sticky top-0 flex h-screen flex-col items-center justify-center overflow-hidden px-6">
              <Container width="wide" className="relative">
                <OutcomeHeading />
              </Container>
              <div className="relative mt-8 w-full">
                {card}
                <DraftNote />
              </div>
            </div>
          </div>
          {/* Mobile: heading + the same slides as a static stacked list. */}
          <div className="relative px-6 pb-20 pt-20 md:hidden">
            <OutcomeHeading />
            <div className="mx-auto flex w-full max-w-5xl flex-col gap-10 pt-12">
              {OUTCOME_STATS.map((s, n) => (
                <Parallax key={s.label} speed={CARD_SPEEDS[n]}>
                  <Reveal y={n === 1 || n === 2 ? 36 : 20} delay={n * 110}>
                    <StaticSlide n={n} />
                  </Reveal>
                </Parallax>
              ))}
            </div>
            <DraftNote />
          </div>
        </>
      )}
      <style>{`
        .outcome-glow {
          background: linear-gradient(180deg, color-mix(in srgb, var(--color-mint) 26%, transparent), transparent 65%);
        }
        .outcome-card { transition: transform 300ms var(--ease-out-expo); }
        .outcome-card:hover { transform: translateY(-4px); }
        .outcome-stat { transition: font-weight 200ms ease; }
        .outcome-card:hover .outcome-stat { font-weight: 600; }
        .viz-dot, .viz-tick, .viz-pulse-ring { animation-play-state: paused; }
        #outcomes[data-playing="true"] .viz-dot,
        #outcomes[data-playing="true"] .viz-tick,
        #outcomes[data-playing="true"] .viz-pulse-ring { animation-play-state: running; }
        .viz-dot {
          width: 8px; height: 8px; border-radius: 999px;
          background: var(--color-mint);
          border: 1px solid color-mix(in srgb, var(--color-coal) 25%, transparent);
          animation: viz-breathe 3s ease-in-out infinite;
        }
        .viz-tick {
          width: 14px; height: 6px; border-radius: 3px;
          background: var(--color-mint);
          transform-origin: 0 50%;
          animation: viz-breathe 3.4s ease-in-out infinite;
        }
        .viz-pulse { position: relative; display: grid; place-items: center; width: 28px; height: 28px; }
        .viz-pulse-dot { width: 8px; height: 8px; border-radius: 999px; background: var(--color-coal); }
        .viz-pulse-ring {
          position: absolute; inset: 0; border-radius: 999px;
          border: 2px solid var(--color-mint);
          animation: viz-ring 2.2s ease-out infinite;
        }
        @keyframes viz-ring { from { transform: scale(0.4); opacity: 0.9; } to { transform: scale(1.15); opacity: 0; } }
        @keyframes viz-breathe { 0%, 100% { opacity: 1; } 50% { opacity: 0.45; } }
        @media (prefers-reduced-motion: reduce) {
          .viz-dot, .viz-tick, .viz-pulse-ring { animation: none; }
        }
      `}</style>
    </section>
  );
}
