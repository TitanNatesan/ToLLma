"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Container, Section, SectionHeading } from "@/components/ui/layout";
import { Badge } from "@/components/ui/primitives";
import { CopyButton } from "@/components/ui/copy-button";
import {
  animate,
  animatePackets,
  createTimeline,
  fadeUp,
  gatewayPulse,
  scaleReveal,
  stagger,
  svg,
  useInViewOnce,
  useParallax,
  usePointerTilt,
  useReducedMotion,
  utils,
} from "@/lib/animations";
import { GATEWAY_BASE, PROVIDERS } from "@/lib/site";

// ============================================================
// Provider ecosystem — one segmented control (all six providers on one
// row at desktop), one labeled network diagram, one detail panel.
// Diagram nodes are labeled at every width; the active provider's curve
// draws and carries a pulse into the gateway. Tabs are the keyboard
// path (roving tabindex + arrows/Home/End); nodes mirror it for pointers.
// ============================================================

const NODE_X = 24;
const NODE_Y = (i: number) => 26 + i * 48;
const NODE_W = 150;
const NODE_H = 34;
const GATEWAY = { x: 302, y: 128, w: 124, h: 64 };
const GATEWAY_MID = { x: GATEWAY.x, y: GATEWAY.y + GATEWAY.h / 2 };
const GATEWAY_ORIGIN = `${GATEWAY.x + GATEWAY.w / 2} ${GATEWAY_MID.y}`;

function connectionPath(i: number) {
  const y = NODE_Y(i);
  return `M ${NODE_X + NODE_W} ${y} C 228 ${y}, 250 ${GATEWAY_MID.y}, ${GATEWAY.x} ${GATEWAY_MID.y}`;
}

const SHORT: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Gemini",
  vertex: "Vertex AI",
  bedrock: "Bedrock",
  custom: "Custom",
};

const MARK: Record<string, { bg: string; fg: string }> = {
  openai: { bg: "fill-brand-soft", fg: "fill-brand" },
  anthropic: { bg: "fill-surface-tint", fg: "fill-violet" },
  gemini: { bg: "fill-teal-soft", fg: "fill-teal-ink" },
  vertex: { bg: "fill-brand-soft", fg: "fill-brand-strong" },
  bedrock: { bg: "fill-ok-soft", fg: "fill-ok-ink" },
  custom: { bg: "fill-surface-cool", fg: "fill-ink-soft" },
};

const INITIALS: Record<string, string> = {
  openai: "O",
  anthropic: "A",
  gemini: "G",
  vertex: "V",
  bedrock: "B",
  custom: "+",
};

export default function Providers() {
  const [active, setActive] = useState(0);
  const [hovered, setHovered] = useState<number | null>(null);
  const [indicator, setIndicator] = useState<{ left: number; top: number; w: number; h: number } | null>(null);
  const reduced = useReducedMotion();
  const [viewRef, seen] = useInViewOnce<HTMLDivElement>(0.3);
  const tiltRef = usePointerTilt<HTMLDivElement>(4);
  const dotsRef = useParallax<HTMLDivElement>(0.05);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const tablistRef = useRef<HTMLDivElement | null>(null);
  const diagramRef = useRef<SVGSVGElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const provider = PROVIDERS[active];

  // Keyboard: roving focus across the tab row (Home/End included).
  function onTabListKeyDown(e: React.KeyboardEvent) {
    let next: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (active + 1) % PROVIDERS.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp")
      next = (active - 1 + PROVIDERS.length) % PROVIDERS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = PROVIDERS.length - 1;
    if (next === null) return;
    e.preventDefault();
    setActive(next);
    tabRefs.current[next]?.focus();
  }

  // Sliding segmented-control indicator (measured, so it works at every
  // breakpoint and after a resize/font swap).
  const measure = useCallback(() => {
    const list = tablistRef.current;
    const btn = tabRefs.current[active];
    if (!list || !btn) return;
    const lr = list.getBoundingClientRect();
    const br = btn.getBoundingClientRect();
    setIndicator({
      left: br.left - lr.left + list.scrollLeft,
      top: br.top - lr.top,
      w: br.width,
      h: br.height,
    });
  }, [active]);

  useLayoutEffect(() => {
    measure();
  }, [measure]);

  useEffect(() => {
    const list = tablistRef.current;
    if (!list) return;
    const ro = new ResizeObserver(measure);
    ro.observe(list);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [measure]);

  // Hide entrance targets before first paint — only when JS is alive and
  // motion is allowed, so reduced-motion / no-JS users see everything.
  useLayoutEffect(() => {
    const root = viewRef.current;
    if (!root || reduced) return;
    const targets = root.querySelectorAll("[data-node], [data-conn], [data-gateway-idle]");
    utils.set(targets, { opacity: 0 });
    return () => {
      utils.set(targets, { clear: "all" });
    };
  }, [reduced, viewRef]);

  // Entrance: gateway scales in, labeled nodes pop staggered, curves fade,
  // then the gateway runs a subtle idle pulse (paused off-screen).
  useEffect(() => {
    const root = viewRef.current;
    if (!root || !seen || reduced) return;

    const nodes = Array.from(root.querySelectorAll<SVGGElement>("[data-node]"));
    const conns = Array.from(root.querySelectorAll<SVGPathElement>("[data-conn]"));
    const gatewayIdle = root.querySelector<SVGGElement>("[data-gateway-idle]");

    const idle: Array<ReturnType<typeof animate>> = [];
    let visible = true;
    let disposed = false;

    const tl = createTimeline({ defaults: { ease: "outExpo" } });
    if (gatewayIdle) {
      tl.add(gatewayIdle, { ...scaleReveal(0.86, 650), svgOrigin: GATEWAY_ORIGIN }, 0);
    }
    nodes.forEach((el, i) => {
      tl.add(el, { ...scaleReveal(0.7, 460), svgOrigin: `${NODE_X + 20} ${NODE_Y(i)}` }, 220 + i * 70);
    });
    tl.add(conns, { opacity: [0, 1], duration: 550, delay: stagger(50, { start: 760 }) }, 0);
    tl.add(
      { t: 0 },
      {
        t: 1,
        duration: 1,
        onComplete: () => {
          if (disposed || !gatewayIdle) return;
          idle.push(animate(gatewayIdle, { ...gatewayPulse(), svgOrigin: GATEWAY_ORIGIN }));
          if (!visible) idle.forEach((a) => a.pause());
        },
      },
      1500
    );

    const io = new IntersectionObserver(
      (entries) => {
        visible = entries.some((e) => e.isIntersecting);
        idle.forEach((a) => (visible ? a.play() : a.pause()));
      },
      { threshold: 0 }
    );
    io.observe(root);

    return () => {
      disposed = true;
      io.disconnect();
      tl.revert();
      idle.forEach((a) => a.revert());
      utils.set(root.querySelectorAll("[data-node], [data-conn], [data-gateway-idle]"), {
        clear: "all",
      });
    };
  }, [seen, reduced, viewRef]);

  // Active curve draws + one pulse rides it into the gateway.
  useEffect(() => {
    if (reduced) return;
    const path = diagramRef.current?.querySelector<SVGPathElement>(
      `[data-conn="${provider.id}"]`
    );
    const ring = diagramRef.current?.querySelector<SVGGElement>("[data-gateway-ring]");
    const pkt = diagramRef.current?.querySelector<SVGCircleElement>(".prov-pulse");
    if (!path) return;
    const [drawable] = svg.createDrawable([path]);
    const tl = createTimeline();
    tl.add(drawable, { duration: 620, ease: "inOutQuad" });
    if (ring) {
      tl.add(
        ring,
        {
          scale: [1, 1.06, 1],
          opacity: [1, 0.75, 1],
          duration: 420,
          ease: "outQuad",
          svgOrigin: GATEWAY_ORIGIN,
        },
        "-=260"
      );
    }
    let flow: ReturnType<typeof animatePackets> | null = null;
    if (pkt) {
      utils.set(pkt, { opacity: 1 });
      flow = animatePackets(path, [pkt], { duration: 950, staggerMs: 0, loop: false });
    }
    return () => {
      flow?.revert();
      if (pkt) utils.set(pkt, { opacity: 0, clear: "all" });
      tl.revert();
    };
  }, [provider.id, reduced]);

  // Panel content transition: fade + slide on provider switch.
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel || reduced) return;
    const items = panel.querySelectorAll<HTMLElement>("[data-panel-item]");
    if (!items.length) return;
    const a = animate(items, {
      ...fadeUp(14, 480),
      delay: stagger(55, { start: 40 }),
    });
    return () => {
      a.revert();
    };
  }, [provider.id, reduced]);

  const snippet =
    `curl ${GATEWAY_BASE.replace(/\/v1$/, "")}${provider.endpoints[0]} \\\n` +
    `  -H "Authorization: Bearer $TOLLMA_KEY" \\\n` +
    `  -d '{"model": "${provider.id}/your-model", "stream": true}'`;

  const segment = 100 / PROVIDERS.length;

  return (
    <Section id="providers" tone="cool">
      <Container width="wide">
        <SectionHeading
          eyebrow="Provider ecosystem"
          title="One gateway, every major provider"
          lead="Switch providers with a single model prefix — same API surface, same key, same observability."
        />

        {/* Segmented control: one row at desktop, wraps to three-up on
            tablet, scrolls horizontally on phones. */}
        <div className="mt-10 flex justify-center">
          <div
            ref={tablistRef}
            role="tablist"
            aria-label="Supported providers"
            onKeyDown={onTabListKeyDown}
            className="relative flex w-full max-w-4xl gap-1 overflow-x-auto rounded-2xl border border-line bg-surface-cool p-1.5 sm:grid sm:grid-cols-3 sm:overflow-visible lg:grid-cols-6"
          >
            {indicator && (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute rounded-xl bg-surface shadow-[var(--shadow-xs)] ring-1 ring-line transition-[transform,width] duration-[var(--dur-base)] ease-[var(--ease-out-expo)] motion-reduce:transition-none"
                style={{
                  left: 0,
                  top: indicator.top,
                  width: indicator.w,
                  height: indicator.h,
                  transform: `translateX(${indicator.left}px)`,
                }}
              />
            )}
            {PROVIDERS.map((p, i) => {
              const selected = i === active;
              return (
                <button
                  key={p.id}
                  ref={(el) => {
                    tabRefs.current[i] = el;
                  }}
                  type="button"
                  role="tab"
                  id={`provider-tab-${p.id}`}
                  aria-selected={selected}
                  aria-controls="provider-panel"
                  tabIndex={selected ? 0 : -1}
                  onClick={() => setActive(i)}
                  onMouseEnter={() => setHovered(i)}
                  onMouseLeave={() => setHovered((h) => (h === i ? null : h))}
                  onFocus={() => setHovered(i)}
                  onBlur={() => setHovered((h) => (h === i ? null : h))}
                  className={`relative z-10 h-10 shrink-0 rounded-xl px-3 text-sm font-medium whitespace-nowrap transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
                    selected ? "text-ink" : "text-muted hover:text-ink"
                  }`}
                >
                  {SHORT[p.id] ?? p.name}
                </button>
              );
            })}
          </div>
        </div>

        <div
          ref={viewRef}
          className="mt-6 grid items-stretch gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-10"
        >
          {/* --- Labeled network diagram --- */}
          <div ref={tiltRef} className="flex min-w-0">
            <div className="relative w-full overflow-hidden rounded-[var(--radius-xl)] border border-line bg-surface p-4 shadow-sm sm:p-6">
              <div
                ref={dotsRef}
                aria-hidden="true"
                className="bg-dots pointer-events-none absolute inset-0 opacity-60"
              />
              <div className="relative flex h-full min-h-[21rem] items-center">
                <svg
                  ref={diagramRef}
                  viewBox="0 0 440 320"
                  className="block h-auto w-full"
                  role="img"
                  aria-label={`${provider.name} connects to the ToLLma gateway`}
                >
                  {/* provider → gateway curves */}
                  {PROVIDERS.map((p, i) => (
                    <path
                      key={p.id}
                      d={connectionPath(i)}
                      data-conn={p.id}
                      className={`fill-none transition-[stroke,stroke-width] duration-[var(--dur-fast)] motion-reduce:transition-none ${
                        i === active
                          ? "stroke-brand"
                          : i === hovered
                            ? "stroke-brand/60"
                            : "stroke-line"
                      }`}
                      strokeWidth={i === active ? 2.5 : i === hovered ? 2 : 1.5}
                      strokeLinecap="round"
                    />
                  ))}

                  {/* labeled provider nodes (pointer enhancement; tabs are
                      the keyboard path and this subtree is presentational) */}
                  {PROVIDERS.map((p, i) => {
                    const selected = i === active;
                    const hot = i === hovered;
                    const mark = MARK[p.id] ?? MARK.custom;
                    return (
                      <g
                        key={p.id}
                        data-node
                        aria-hidden="true"
                        className="cursor-pointer"
                        onMouseEnter={() => setHovered(i)}
                        onMouseLeave={() => setHovered((h) => (h === i ? null : h))}
                        onClick={() => setActive(i)}
                      >
                        <rect
                          x={NODE_X}
                          y={NODE_Y(i) - NODE_H / 2}
                          width={NODE_W}
                          height={NODE_H}
                          rx={10}
                          className={
                            selected
                              ? "fill-brand-soft stroke-brand"
                              : hot
                                ? "fill-surface stroke-brand/60"
                                : "fill-surface stroke-line"
                          }
                          strokeWidth={selected ? 1.8 : 1.3}
                        />
                        <circle cx={NODE_X + 20} cy={NODE_Y(i)} r={12} className={mark.bg} />
                        <text
                          x={NODE_X + 20}
                          y={NODE_Y(i)}
                          textAnchor="middle"
                          dominantBaseline="central"
                          fontSize="11"
                          fontWeight="700"
                          className={mark.fg}
                        >
                          {INITIALS[p.id]}
                        </text>
                        <text
                          x={NODE_X + 40}
                          y={NODE_Y(i)}
                          dominantBaseline="central"
                          fontSize="12.5"
                          fontWeight={selected ? 700 : 500}
                          className={selected ? "fill-ink" : "fill-ink-soft"}
                        >
                          {SHORT[p.id] ?? p.name}
                        </text>
                        {selected && (
                          <circle
                            cx={NODE_X + NODE_W - 14}
                            cy={NODE_Y(i)}
                            r={3.2}
                            className="fill-brand"
                          />
                        )}
                      </g>
                    );
                  })}

                  {/* gateway node */}
                  <g data-gateway-idle>
                    <g data-gateway-ring>
                      <rect
                        x={GATEWAY.x}
                        y={GATEWAY.y}
                        width={GATEWAY.w}
                        height={GATEWAY.h}
                        rx="14"
                        className="fill-brand-soft stroke-brand"
                        strokeWidth="1.5"
                      />
                      <text
                        x={GATEWAY.x + GATEWAY.w / 2}
                        y={GATEWAY_MID.y - 2}
                        textAnchor="middle"
                        className="fill-brand-strong"
                        fontSize="12.5"
                        fontWeight="700"
                      >
                        ToLLma
                      </text>
                      <text
                        x={GATEWAY.x + GATEWAY.w / 2}
                        y={GATEWAY_MID.y + 14}
                        textAnchor="middle"
                        className="fill-muted"
                        fontSize="9.5"
                      >
                        gateway
                      </text>
                    </g>
                  </g>
                  <circle className="prov-pulse" r={3.6} fill="var(--color-brand)" opacity={0} />
                </svg>
              </div>
            </div>
          </div>

          {/* --- Details panel --- */}
          <div
            id="provider-panel"
            ref={panelRef}
            role="tabpanel"
            aria-labelledby={`provider-tab-${provider.id}`}
            className="flex h-full min-w-0 flex-col gap-6 rounded-[var(--radius-xl)] border border-line bg-surface p-6 sm:p-8"
          >
            <div aria-hidden="true" className="relative h-1 overflow-hidden rounded-full bg-line">
              <div
                className="h-full rounded-full bg-brand transition-transform duration-[var(--dur-base)] ease-[var(--ease-out-expo)] motion-reduce:transition-none"
                style={{ width: `${segment}%`, transform: `translateX(${active * 100}%)` }}
              />
            </div>

            <div data-panel-item className="flex flex-wrap items-center gap-3">
              <h3 className="font-semibold tracking-tight text-ink" style={{ fontSize: "1.35rem" }}>
                {provider.name}
              </h3>
              <Badge tone="brand">Connected via ToLLma</Badge>
              <code translate="no" className="font-mono text-xs text-faint">
                {provider.id}/your-model
              </code>
            </div>

            <dl data-panel-item className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <dt className="text-xs font-medium uppercase tracking-wide text-faint">API interface</dt>
                <dd className="font-mono text-sm text-ink-soft">{provider.api}</dd>
              </div>
              <div className="flex flex-col gap-1">
                <dt className="text-xs font-medium uppercase tracking-wide text-faint">Endpoint(s)</dt>
                <dd className="flex flex-col gap-1">
                  {provider.endpoints.map((ep) => (
                    <span key={ep} translate="no" className="font-mono text-sm text-ink-soft">
                      {ep}
                    </span>
                  ))}
                </dd>
              </div>
            </dl>

            <div data-panel-item className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium uppercase tracking-wide text-faint">Tool calling</span>
              <Badge tone={provider.tools ? "ok" : "neutral"}>
                {provider.tools ? "Supported" : "Not yet"}
              </Badge>
              <span className="ml-4 text-xs font-medium uppercase tracking-wide text-faint">Streaming</span>
              <Badge tone={provider.streaming ? "ok" : "neutral"}>
                {provider.streaming ? "Supported" : "Not yet"}
              </Badge>
            </div>

            <p data-panel-item className="text-[0.95rem] leading-relaxed text-muted">
              {provider.note}
            </p>

            <div data-panel-item className="mt-auto">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-[0.7rem] font-semibold uppercase tracking-[0.1em] text-faint">
                  Example request
                </span>
                <CopyButton value={snippet} label="Copy curl" />
              </div>
              <pre
                tabIndex={0}
                aria-label={`${provider.name} example request`}
                className="w-full max-w-full overflow-x-auto rounded-2xl border border-line bg-surface-cool p-4 font-mono text-xs leading-relaxed text-ink-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              >
                <code translate="no">{snippet}</code>
              </pre>
            </div>
          </div>
        </div>
      </Container>
    </Section>
  );
}
