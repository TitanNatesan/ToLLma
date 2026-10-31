"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Container, Section, SectionHeading } from "@/components/ui/layout";
import { Badge } from "@/components/ui/primitives";
import {
  animate,
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

// Provider nodes stacked on the left of the diagram; the ToLLma gateway
// sits centered on the right. One curve per provider, drawn on selection.
// Interaction model: the tab list above is the canonical (keyboard) path;
// SVG dots are mouse-only decoration (presentational role="img" subtree) —
// hover previews a curve, click selects the matching tab.
const NODE_X = 64;
const NODE_Y = (i: number) => 28 + i * 38;
const GATEWAY = { x: 214, y: 106, w: 88, h: 40 };
const GATEWAY_MID = { x: GATEWAY.x, y: GATEWAY.y + GATEWAY.h / 2 };
const GATEWAY_ORIGIN = `${GATEWAY.x + GATEWAY.w / 2} ${GATEWAY_MID.y}`;

function connectionPath(i: number) {
  const y = NODE_Y(i);
  return `M ${NODE_X + 8} ${y} C ${NODE_X + 66} ${y}, ${GATEWAY_MID.x - 60} ${GATEWAY_MID.y}, ${GATEWAY_MID.x} ${GATEWAY_MID.y}`;
}

// Short label for the diagram (SVG text has no room for the long names).
function shortName(name: string) {
  return name.split(" /")[0];
}

export default function Providers() {
  const [active, setActive] = useState(0);
  const [hovered, setHovered] = useState<number | null>(null);
  const reduced = useReducedMotion();
  const [viewRef, seen] = useInViewOnce<HTMLDivElement>(0.3);
  const tiltRef = usePointerTilt<HTMLDivElement>(4);
  const dotsRef = useParallax<HTMLDivElement>(0.05);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const diagramRef = useRef<SVGSVGElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const provider = PROVIDERS[active];

  // Keyboard: roving focus across the tab row (Home/End included).
  // Handled on the tablist (single listener); arrows auto-activate.
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

  // Hide entrance targets before first paint — but only when JS is alive and
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

  // Entrance choreography (once the section is in view): gateway scales in,
  // provider dots pop staggered (70ms), curves fade — then the gateway runs
  // a subtle idle pulse, paused whenever the section is off-screen.
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
    // 1) gateway scales in
    if (gatewayIdle) {
      tl.add(gatewayIdle, { ...scaleReveal(0.86, 650), svgOrigin: GATEWAY_ORIGIN }, 0);
    }
    // 2) provider dots pop, staggered 70ms
    nodes.forEach((el, i) => {
      tl.add(el, { ...scaleReveal(0.6, 460), svgOrigin: `${NODE_X} ${NODE_Y(i)}` }, 220 + i * 70);
    });
    // 3) curves fade in
    tl.add(conns, { opacity: [0, 1], duration: 550, delay: stagger(50, { start: 760 }) }, 0);
    // 4) idle pulse begins once the diagram has assembled
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

    // Gate the idle pulse on visibility (pause off-screen, resume on-screen).
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
      // revert() restores the pre-entrance (hidden) values — clear them so a
      // mid-flight reduced-motion toggle never leaves content hidden.
      utils.set(root.querySelectorAll("[data-node], [data-conn], [data-gateway-idle]"), {
        clear: "all",
      });
    };
  }, [seen, reduced, viewRef]);

  // Draw the active provider → gateway curve (and pulse the gateway) on
  // every selection. Reverts cleanly on unmount / next selection.
  useEffect(() => {
    if (reduced) return;
    const path = diagramRef.current?.querySelector<SVGPathElement>(
      `[data-conn="${provider.id}"]`
    );
    const ring = diagramRef.current?.querySelector<SVGGElement>("[data-gateway-ring]");
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
    return () => {
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

        <div className="mt-12 grid items-start gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-12">
          {/* --- Selector + diagram --- */}
          <div ref={viewRef} className="flex flex-col gap-6">
            <div
              role="tablist"
              aria-label="Supported providers"
              onKeyDown={onTabListKeyDown}
              className="flex flex-nowrap gap-2 overflow-x-auto px-1 py-1 sm:flex-wrap sm:overflow-x-visible"
            >
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
                    className={`h-9 shrink-0 rounded-full border px-4 text-sm font-medium transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
                      selected
                        ? "border-brand bg-brand text-white"
                        : "border-line-strong bg-surface text-ink-soft hover:border-brand hover:text-brand"
                    }`}
                  >
                    {shortName(p.name)}
                  </button>
                );
              })}
            </div>

            {/* Diagram card: pointer-tilt wrapper (the hook rotates its first
                child), --shadow-sm elevation, parallax dot-grid layer. */}
            <div
              ref={tiltRef}
              className="rounded-[var(--radius-xl)] border border-line bg-surface p-4 shadow-sm"
            >
              <div className="relative">
                <div
                  ref={dotsRef}
                  aria-hidden="true"
                  className="bg-dots pointer-events-none absolute inset-0 opacity-60"
                />
                <svg
                  ref={diagramRef}
                  viewBox="0 0 320 256"
                  className="relative h-auto w-full max-w-md"
                  role="img"
                  aria-label={`${provider.name} connects to the ToLLma gateway`}
                >
                  {/* provider → gateway curves (active is brand + drawn;
                      a hovered one previews in a lighter brand tone) */}
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

                  {/* provider dots — mouse-only preview/select (the tab list is
                      the keyboard path; this subtree is presentational) */}
                  {PROVIDERS.map((p, i) => {
                    const selected = i === active;
                    const hot = i === hovered;
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
                        {(selected || hot) && (
                          <circle
                            cx={NODE_X}
                            cy={NODE_Y(i)}
                            r={10}
                            className="fill-none stroke-brand transition-opacity duration-[var(--dur-fast)] motion-reduce:transition-none"
                            strokeWidth={1.5}
                            opacity={selected ? 0.35 : 0.6}
                          />
                        )}
                        <circle
                          cx={NODE_X}
                          cy={NODE_Y(i)}
                          r={selected ? 6 : hot ? 5.5 : 4.5}
                          className={
                            selected
                              ? "fill-brand"
                              : hot
                                ? "fill-brand-soft stroke-brand"
                                : "fill-faint"
                          }
                          strokeWidth={hot && !selected ? 1.5 : 0}
                        />
                        {(selected || hot) && (
                          <text
                            x={NODE_X + 14}
                            y={NODE_Y(i) - 9}
                            className={selected ? "fill-brand" : "fill-muted"}
                            fontSize="11"
                            fontWeight="600"
                          >
                            {shortName(p.name)}
                          </text>
                        )}
                      </g>
                    );
                  })}

                  {/* gateway node: idle-pulse wrapper > selection-beat ring */}
                  <g data-gateway-idle>
                    <g data-gateway-ring>
                      <rect
                        x={GATEWAY.x}
                        y={GATEWAY.y}
                        width={GATEWAY.w}
                        height={GATEWAY.h}
                        rx="12"
                        className="fill-brand-soft stroke-brand"
                        strokeWidth="1.5"
                      />
                      <text
                        x={GATEWAY.x + GATEWAY.w / 2}
                        y={GATEWAY_MID.y + 4}
                        textAnchor="middle"
                        className="fill-brand-strong"
                        fontSize="12"
                        fontWeight="600"
                      >
                        ToLLma
                      </text>
                    </g>
                  </g>
                  <text
                    x={GATEWAY.x + GATEWAY.w / 2}
                    y={GATEWAY.y + GATEWAY.h + 18}
                    textAnchor="middle"
                    className="fill-muted"
                    fontSize="10"
                  >
                    gateway
                  </text>
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
            className="flex flex-col gap-6 rounded-[var(--radius-xl)] border border-line bg-surface p-6 sm:p-8"
          >
            {/* active-provider indicator: one segment per provider, slides */}
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
              <code className="font-mono text-xs text-faint">{provider.id}/your-model</code>
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
                    <span key={ep} className="font-mono text-sm text-ink-soft">
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

            <pre
              data-panel-item
              tabIndex={0}
              aria-label={`${provider.name} example request`}
              className="overflow-x-auto rounded-2xl border border-line bg-surface-cool p-4 font-mono text-xs leading-relaxed text-ink-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
              <code>{snippet}</code>
            </pre>
          </div>
        </div>
      </Container>
    </Section>
  );
}
