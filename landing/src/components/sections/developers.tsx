"use client";

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { Container, Section, SectionHeading } from "@/components/ui/layout";
import { CTA } from "@/components/ui/primitives";
import { IconArrowRight, IconCheck, IconTerminal } from "@/components/ui/icons";
import {
  animate,
  createTimeline,
  fadeUp,
  scaleReveal,
  stagger,
  utils,
  useInViewOnce,
  useParallax,
  useReducedMotion,
  useRevealOnScroll,
} from "@/lib/animations";
import { DOCS_URL, GATEWAY_BASE, GET_STARTED_URL } from "@/lib/site";

// ============================================================
// Developer experience — one OpenAI-compatible endpoint, four clients.
// The public gateway is OpenAI-compatible at GATEWAY_BASE; ToLLma also
// exposes an Anthropic-compatible /v1/messages surface (see site.ts).
// Snippets are hand-authored token arrays (no regex tokenizer) so the
// highlighting stays readable and can never mis-tokenize a string.
//
// Entrance choreography (once the panel scrolls into view, ~1.5s total,
// non-blocking): left copy fades up (section reveal) → panel frame
// scale/fades in → tab row staggers → code lines print line-by-line
// like a terminal. Language switches keep the snappy cross-fade: old
// lines slide up 6px + fade, new lines enter from 6px below (≤350ms).
// ============================================================

// The Anthropic SDK appends "/v1/messages" itself, so its baseURL is the
// gateway origin WITHOUT the "/v1" suffix.
const ANTHROPIC_BASE = GATEWAY_BASE.replace(/\/v1$/, "");

// --- token colors for the deep-navy code panel (light, token-derived) ---
const TOK = {
  plain: "color-mix(in srgb, var(--color-ink) 12%, white)", // near-white body
  kw: "color-mix(in srgb, var(--color-violet) 55%, white)", // keywords
  str: "color-mix(in srgb, var(--color-teal) 65%, white)", // strings
  fn: "color-mix(in srgb, var(--color-brand) 40%, white)", // calls / names
  com: "color-mix(in srgb, var(--color-muted) 55%, white)", // comments
} as const;

type TokKind = keyof typeof TOK;
type Tok = { v: string; t?: TokKind };
type Line = Tok[];

const kw = (v: string): Tok => ({ v, t: "kw" });
const str = (v: string): Tok => ({ v, t: "str" });
const fn = (v: string): Tok => ({ v, t: "fn" });
const p = (v: string): Tok => ({ v });

type Lang = "python" | "javascript" | "anthropic" | "curl";

const PYTHON_LINES: Line[] = [
  [kw("import "), p("os")],
  [kw("from "), p("openai "), kw("import "), fn("OpenAI")],
  [],
  [p("client = "), fn("OpenAI")],
  [p("(")],
  [p("    base_url="), str(`"${GATEWAY_BASE}"`), p(",")],
  [p("    api_key=os.environ["), str('"TOLLMA_API_KEY"'), p("],")],
  [p(")")],
  [],
  [p("resp = client.chat.completions.")],
  [p("    "), fn("create")],
  [p("(")],
  [p("    model="), str('"provider/model-name"'), p(",")],
  [p("    messages=[{"), str('"role"'), p(": "), str('"user"'), p(", "), str('"content"'), p(": "), str('"Hello"'), p("}],")],
  [p(")")],
  [],
  [fn("print"), p("(resp.choices[0].message.content)")],
];

const JS_LINES: Line[] = [
  [kw("import "), p("OpenAI "), kw("from "), str('"openai"'), p(";")],
  [],
  [kw("const "), p("client = "), kw("new "), fn("OpenAI"), p("({")],
  [p("  baseURL: "), str(`"${GATEWAY_BASE}"`), p(",")],
  [p("  apiKey: process.env.TOLLMA_API_KEY,")],
  [p("});")],
  [],
  [kw("const "), p("resp = "), kw("await "), p("client.chat.completions.")],
  [p("  "), fn("create"), p("({")],
  [p("    model: "), str('"provider/model-name"'), p(",")],
  [p("    messages: [{ role: "), str('"user"'), p(", content: "), str('"Hello"'), p(" }],")],
  [p("  });")],
  [],
  [p("console."), fn("log"), p("(resp.choices[0].message.content);")],
];

const ANTHROPIC_LINES: Line[] = [
  [kw("import "), p("Anthropic "), kw("from "), str('"@anthropic-ai/sdk"'), p(";")],
  [],
  [kw("const "), p("client = "), kw("new "), fn("Anthropic"), p("({")],
  [p("  baseURL: "), str(`"${ANTHROPIC_BASE}"`), p(",")],
  [p("  apiKey: process.env.TOLLMA_API_KEY,")],
  [p("});")],
  [],
  [p("const "), p("msg = "), kw("await "), p("client.")],
  [p("  messages."), fn("create"), p("({")],
  [p("    model: "), str('"provider/model-name"'), p(",")],
  [p("    max_tokens: "), p("1024"), p(",")],
  [p("    messages: [{ role: "), str('"user"'), p(", content: "), str('"Hello"'), p(" }],")],
  [p("  });")],
  [],
  [p("console."), fn("log"), p("(msg.content[0].text);")],
];

const CURL_LINES: Line[] = [
  [fn("curl"), p(" "), str(`"${GATEWAY_BASE}/chat/completions"`), p(" \\")],
  [p("  -H "), str('"Authorization: Bearer $TOLLMA_API_KEY"'), p(" \\")],
  [p("  -H "), str('"Content-Type: application/json"'), p(" \\")],
  [p("  -d "), str("'{")],
  [str('    "model": "provider/model-name",')],
  [str('    "messages": [{ "role": "user", "content": "Hello" }]')],
  [str("  }'")],
];

const LANGS: { id: Lang; label: string; lines: Line[]; plain: string }[] = [
  {
    id: "python",
    label: "Python",
    lines: PYTHON_LINES,
    plain: PYTHON_LINES.map((l) => l.map((t) => t.v).join("")).join("\n"),
  },
  {
    id: "javascript",
    label: "JavaScript",
    lines: JS_LINES,
    plain: JS_LINES.map((l) => l.map((t) => t.v).join("")).join("\n"),
  },
  {
    id: "anthropic",
    label: "Anthropic",
    lines: ANTHROPIC_LINES,
    plain: ANTHROPIC_LINES.map((l) => l.map((t) => t.v).join("")).join("\n"),
  },
  {
    id: "curl",
    label: "cURL",
    lines: CURL_LINES,
    plain: CURL_LINES.map((l) => l.map((t) => t.v).join("")).join("\n"),
  },
];

// --- supporting points under the heading ---
const POINTS = [
  {
    title: "One endpoint",
    body: "Every provider routes through a single gateway URL. Point your SDK at it and go.",
  },
  {
    title: "Drop-in compatible",
    body: "OpenAI-compatible chat.completions, plus an Anthropic-compatible /v1/messages surface.",
  },
  {
    title: "Keep your SDKs",
    body: "The official OpenAI and Anthropic SDKs work unchanged — only the base URL moves.",
  },
];

// --- verified extra endpoints revealed by the disclosure (site.ts) ---
const EXTRA_ENDPOINTS = [
  {
    path: "POST /v1/messages",
    body: "Anthropic Messages — point the official Anthropic SDK at the gateway origin.",
  },
  {
    path: "POST /v1/responses",
    body: "OpenAI Responses — same Bearer gateway key as chat.completions.",
  },
];

function CodePanel({ dotsRef }: { dotsRef: RefObject<HTMLDivElement | null> }) {
  // `active` is the requested tab; `displayed` lags it by one outgoing
  // animation so old lines can fade before React swaps the snippet.
  const [active, setActive] = useState(0);
  const [displayed, setDisplayed] = useState(0);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [viewRef, seen] = useInViewOnce<HTMLDivElement>(0.25);
  const reduced = useReducedMotion();

  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const indicatorRef = useRef<HTMLSpanElement | null>(null);
  const copyBtnRef = useRef<HTMLButtonElement | null>(null);
  const popAnimRef = useRef<ReturnType<typeof animate> | null>(null);
  const firstLines = useRef(true);
  const lang = LANGS[displayed];

  // Sliding active-pill indicator — measured from the active tab (transform
  // only, re-measured on resize; motion-reduce turns the slide off in CSS).
  useLayoutEffect(() => {
    const ind = indicatorRef.current;
    const tab = tabRefs.current[active];
    if (!ind || !tab) return;
    const apply = () => {
      ind.style.width = `${tab.offsetWidth}px`;
      ind.style.height = `${tab.offsetHeight}px`;
      ind.style.transform = `translate(${tab.offsetLeft}px, ${tab.offsetTop}px)`;
    };
    const first = !ind.dataset.ready;
    if (first) ind.style.transition = "none"; // no slide on the initial position
    apply();
    if (first) {
      void ind.offsetWidth; // flush so the first slide starts from here
      ind.style.transition = "";
      ind.dataset.ready = "1";
    }
    const onResize = () => apply();
    window.addEventListener("resize", onResize, { passive: true });
    return () => window.removeEventListener("resize", onResize);
  }, [active]);

  // Hide every animated layer only when JS is alive and motion is allowed,
  // so reduced-motion / no-JS users see the finished panel immediately.
  // Code lines carry their own hook (data-code-line, not data-boot) so the
  // tab stagger never touches them.
  useLayoutEffect(() => {
    const root = viewRef.current;
    if (!root || reduced) return;
    const layers = () => root.querySelectorAll<HTMLElement>("[data-boot], [data-code-line]");
    utils.set(layers(), { opacity: 0 });
    return () => {
      utils.set(layers(), { clear: "all" }); // reduced-motion toggle mid-session
    };
  }, [reduced, viewRef]);

  // Layered entrance, once the panel is in view: frame scales/fades in,
  // then the tab row staggers. Code lines are the final layer (effect below).
  useEffect(() => {
    const root = viewRef.current;
    if (!root || !seen || reduced) return;
    const frame = root.querySelector<HTMLElement>('[data-boot="frame"]');
    // Buttons only: the sliding pill is positioned via style.transform, so it
    // must stay out of any transform animation.
    const tabs = Array.from(root.querySelectorAll<HTMLElement>('button[data-boot="tab"]'));
    const tl = createTimeline({ defaults: { ease: "outExpo" } });
    if (frame) tl.add(frame, { ...scaleReveal(0.97, 560) }, 150);
    if (tabs.length) tl.add(tabs, { ...fadeUp(8, 280), delay: stagger(30) }, 480);
    return () => {
      tl.revert();
      utils.set(root.querySelectorAll("[data-boot], [data-code-line]"), { clear: "all" });
    };
  }, [seen, reduced, viewRef]);

  // Code lines: first print joins the entrance as the last layer (~1.5s
  // total, 28ms/line ≈ 600ms of line stagger); tab switches enter from
  // 6px below with a quick stagger that finishes within 350ms. Layout
  // effect so freshly swapped lines are hidden before the first paint.
  useLayoutEffect(() => {
    const root = viewRef.current;
    if (!root) return;
    const first = firstLines.current;
    if (first && !seen) return; // entrance owns the reveal order
    firstLines.current = false;
    if (reduced) return;
    const lines = root.querySelectorAll<HTMLElement>("[data-code-line]");
    if (!lines.length) return;
    utils.set(lines, { opacity: 0, y: 6 });
    const a = animate(lines, {
      opacity: [0, 1],
      y: [6, 0],
      duration: first ? 180 : 140,
      delay: stagger(first ? 28 : 14, { start: first ? 860 : 0 }),
      ease: "outQuad",
    });
    return () => {
      a.revert();
      // revert() restores the pre-animation values (hidden) — clear them so a
      // reduced-motion toggle or quick re-switch never leaves lines invisible.
      utils.set(lines, { clear: "all" });
    };
  }, [displayed, reduced, seen, viewRef]);

  // Outgoing snippet: old lines slide up 6px + fade, then the swap commits.
  useEffect(() => {
    if (displayed === active) return;
    const root = viewRef.current;
    if (reduced || !seen || !root) {
      setDisplayed(active);
      return;
    }
    const lines = root.querySelectorAll<HTMLElement>("[data-code-line]");
    const out = animate(lines, {
      opacity: [1, 0],
      y: [0, -6],
      duration: 110,
      delay: stagger(4),
      ease: "inQuad",
    });
    const t = window.setTimeout(() => setDisplayed(active), 175);
    return () => {
      window.clearTimeout(t);
      out.revert();
    };
  }, [active, displayed, reduced, seen, viewRef]);

  // Reset copy feedback after ~1.5s (timer cleaned up on re-copy/unmount).
  useEffect(() => {
    if (copyState === "idle") return;
    const t = window.setTimeout(() => setCopyState("idle"), 1500);
    return () => window.clearTimeout(t);
  }, [copyState]);

  // Revert the copy micro-pop if the section unmounts mid-animation.
  useEffect(() => {
    return () => {
      popAnimRef.current?.revert();
    };
  }, []);

  const copy = async () => {
    try {
      if (!navigator.clipboard) throw new Error("clipboard unsupported");
      await navigator.clipboard.writeText(lang.plain);
      setCopyState("copied");
      if (!reduced && copyBtnRef.current) {
        popAnimRef.current?.revert();
        popAnimRef.current = animate(copyBtnRef.current, {
          scale: [1, 1.08, 1],
          duration: 320,
          ease: "outBack",
        });
      }
    } catch {
      setCopyState("failed");
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const last = LANGS.length - 1;
    let next: number | null = null;
    if (e.key === "ArrowRight") next = active === last ? 0 : active + 1;
    else if (e.key === "ArrowLeft") next = active === 0 ? last : active - 1;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = last;
    if (next === null) return;
    e.preventDefault();
    setActive(next);
    tabRefs.current[next]?.focus();
  };

  return (
    <div className="min-w-0">
      <div className="relative isolate min-w-0">
        {/* decorative dot grid — tiny scroll parallax behind the panel */}
        <div
          ref={dotsRef}
          aria-hidden="true"
          className="pointer-events-none absolute -inset-3 -z-10 opacity-80 [background-image:radial-gradient(var(--color-line)_1.5px,transparent_1.5px)] [background-size:16px_16px]"
        />

        <div ref={viewRef} className="min-w-0">
          <div
            data-boot="frame"
            className="min-w-0 overflow-hidden rounded-2xl border border-line bg-ink shadow-[var(--shadow-lg)]"
          >
            {/* title bar — generic terminal chrome, no fake telemetry */}
            <div className="flex items-center gap-2 border-b border-white/10 px-4 py-2">
              <span aria-hidden="true" className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-danger/70" />
                <span className="h-2.5 w-2.5 rounded-full bg-warn/70" />
                <span className="h-2.5 w-2.5 rounded-full bg-ok/70" />
              </span>
              <span className="font-mono text-[0.68rem] text-white/40">tollma — zsh</span>
            </div>

            {/* header: language tabs + copy */}
            <div className="flex flex-wrap items-center gap-1 border-b border-white/10 px-3 py-2.5">
              <div
                role="tablist"
                aria-label="Code language"
                className="relative flex flex-1 flex-wrap items-center gap-1"
                onKeyDown={onKeyDown}
              >
                {/* sliding active-pill indicator — synced to the active tab */}
                <span
                  ref={indicatorRef}
                  aria-hidden="true"
                  className="pointer-events-none absolute left-0 top-0 rounded-full bg-white/10 transition-[width,height,transform] duration-[var(--dur-base)] ease-[var(--ease-out-expo)] motion-reduce:transition-none"
                  style={{ width: 0, height: 0 }}
                />
                {LANGS.map((l, i) => (
                  <button
                    key={l.id}
                    ref={(el) => {
                      tabRefs.current[i] = el;
                    }}
                    type="button"
                    role="tab"
                    id={`dev-tab-${l.id}`}
                    data-boot="tab"
                    aria-selected={i === active}
                    aria-controls="dev-code-panel"
                    tabIndex={i === active ? 0 : -1}
                    onClick={() => setActive(i)}
                    className={`relative rounded-full px-3 py-1.5 text-xs font-medium transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70 ${
                      i === active ? "text-white" : "text-white/55 hover:text-white/85"
                    }`}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
              <button
                ref={copyBtnRef}
                type="button"
                onClick={copy}
                aria-label="Copy code snippet"
                data-boot="tab"
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70 ${
                  copyState === "copied"
                    ? "text-ok"
                    : copyState === "failed"
                      ? "text-danger"
                      : "text-white/60 hover:bg-white/10 hover:text-white"
                }`}
              >
                {copyState === "copied" ? <IconCheck size={14} /> : <IconTerminal size={14} />}
                {copyState === "copied" ? "Copied" : copyState === "failed" ? "Copy failed" : "Copy"}
              </button>
            </div>

            {/* polite live region for copy feedback */}
            <p aria-live="polite" className="sr-only">
              {copyState === "copied"
                ? "Code copied to clipboard"
                : copyState === "failed"
                  ? "Copy failed"
                  : ""}
            </p>

            {/* code body — horizontal scroll stays inside this box */}
            <div
              id="dev-code-panel"
              role="tabpanel"
              aria-labelledby={`dev-tab-${lang.id}`}
              tabIndex={0}
              className="min-w-0 overflow-x-auto"
            >
              <pre className="min-w-0 whitespace-pre px-4 py-4 font-mono text-[0.78rem] leading-relaxed sm:text-[0.82rem]">
                <code translate="no" className="block w-max min-w-full">
                  {lang.lines.map((line, i) => (
                    <span key={i} data-code-line className="block min-w-0">
                      {line.length === 0
                        ? "\u00A0"
                        : line.map((tok, j) => (
                            <span key={j} style={{ color: TOK[tok.t ?? "plain"] }}>
                              {tok.v}
                            </span>
                          ))}
                    </span>
                  ))}
                </code>
              </pre>
            </div>
          </div>
        </div>
      </div>

      <p data-reveal className="mt-3 text-xs text-faint">
        Works with the official OpenAI and Anthropic SDKs, or plain cURL.
      </p>
      <EndpointNotes />
    </div>
  );
}

/* ---------------------------------------------------------------
   Disclosure — one verified extra endpoint per row (site.ts), with
   anime height animation and cleanup (same pattern as features.tsx).
---------------------------------------------------------------- */
function EndpointNotes() {
  const [open, setOpen] = useState(false);
  const reduced = useReducedMotion();
  const regionRef = useRef<HTMLDivElement | null>(null);
  const mounted = useRef(false);

  useLayoutEffect(() => {
    const el = regionRef.current;
    if (!el) return;
    el.style.overflow = "hidden";
    // First pass: establish open/closed state without animating.
    if (!mounted.current || reduced) {
      mounted.current = true;
      el.style.height = open ? "auto" : "0px";
      el.style.opacity = open ? "1" : "0";
      return;
    }
    let a: ReturnType<typeof animate> | null = null;
    if (open) {
      el.style.height = "auto";
      const target = el.scrollHeight;
      el.style.height = "0px";
      el.style.opacity = "0";
      a = animate(el, {
        height: target,
        opacity: 1,
        duration: 450,
        ease: "outExpo",
        onComplete: () => {
          el.style.height = "auto";
        },
      });
    } else {
      el.style.height = `${el.scrollHeight}px`;
      a = animate(el, { height: 0, opacity: 0, duration: 300, ease: "inQuad" });
    }
    return () => {
      a?.revert();
    };
  }, [open, reduced]);

  return (
    <div data-reveal className="mt-3">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="dev-endpoint-notes"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-line bg-surface-cool px-3 py-2 text-xs font-medium text-ink-soft transition-colors duration-200 hover:border-brand-soft hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        <span>More endpoint details</span>
        <svg
          viewBox="0 0 14 14"
          aria-hidden="true"
          className={`h-3.5 w-3.5 shrink-0 transition-transform duration-[var(--dur-fast)] motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
        >
          <path
            d="M3 5.5 L7 9.5 L11 5.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      <div id="dev-endpoint-notes" ref={regionRef} aria-hidden={!open}>
        <ul className="mt-2 rounded-lg border border-line bg-surface-cool px-3 py-1">
          {EXTRA_ENDPOINTS.map((e) => (
            <li key={e.path} className="flex flex-col gap-0.5 border-b border-line py-2 last:border-0 last:pb-2">
              <span className="font-mono text-[0.72rem] font-medium text-ink-soft">{e.path}</span>
              <span className="text-xs text-muted">{e.body}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default function Developers() {
  const ref = useRevealOnScroll();
  const dotsRef = useParallax<HTMLDivElement>(0.05);

  return (
    <Section id="developers" tone="surface">
      <div ref={ref as RefObject<HTMLDivElement | null>}>
        <Container>
          <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-16">
            {/* left: copy + CTAs (fades up first via the section reveal) */}
            <div className="min-w-0">
              <SectionHeading
                align="left"
                eyebrow="Developer experience"
                title="Ship in minutes, not days"
                lead="One OpenAI-compatible endpoint behind your existing SDKs. Change the base URL and every provider becomes reachable."
              />

              <ul className="mt-8 flex flex-col gap-5">
                {POINTS.map((pt) => (
                  <li key={pt.title} data-reveal className="flex items-start gap-3">
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-teal-soft text-teal-ink">
                      <IconCheck size={14} />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-ink">{pt.title}</p>
                      <p className="mt-0.5 text-sm leading-relaxed text-muted">{pt.body}</p>
                    </div>
                  </li>
                ))}
              </ul>

              <div data-reveal className="mt-8 flex flex-wrap items-center gap-3">
                <CTA href={GET_STARTED_URL} size="md">
                  Get Started
                  <IconArrowRight size={18} />
                </CTA>
                <CTA href={DOCS_URL} variant="secondary" size="md">
                  Read the docs
                </CTA>
              </div>
            </div>

            {/* right: code panel — owns its own entrance choreography */}
            <div className="min-w-0">
              <CodePanel dotsRef={dotsRef} />
            </div>
          </div>
        </Container>
      </div>
    </Section>
  );
}
