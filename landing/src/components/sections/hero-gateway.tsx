"use client";

import { useEffect, useLayoutEffect, useState } from "react";
import {
  animate,
  animatePackets,
  createTimeline,
  drawSvgPaths,
  float,
  gatewayPulse,
  haloBreathe,
  scaleReveal,
  useInViewOnce,
  useParallax,
  usePointerTilt,
  useReducedMotion,
  utils,
  type PacketFlow,
} from "@/lib/animations";

// ============================================================
// Hero gateway illustration — 3 stacked SVG layers (viewBox
// 0 0 680 520) in one aspect-stable container:
//   bg layer  parallax 0.08  dot grid + faint network lines
//   mid layer parallax 0.15  paths + client/provider nodes + packets
//   fg layer  parallax 0.25  gateway core, halo, usage + float chips
// Tilt wrapper (usePointerTilt) applies perspective+rotate to the
// stack container. Static state (no JS / reduced motion) renders
// every layer fully visible; animation is progressive enhancement.
// ============================================================

// Geometry: clients on the left (x 20..132), gateway hexagon centered
// at (340, 260) with left/right vertices at x 260 / 420, providers right (x 532..660).
const CLIENTS = [
  { label: "App", y: 109, d: "M132 109 C190 109 205 260 260 260" },
  { label: "Agent", y: 260, d: "M132 260 C176 260 216 260 260 260" },
  { label: "CLI", y: 411, d: "M132 411 C190 411 205 260 260 260" },
];

const PROVIDERS = [
  { label: "OpenAI", y: 65, d: "M420 260 C470 260 486 65 532 65" },
  { label: "Anthropic", y: 183, d: "M420 260 C470 260 486 183 532 183" },
  { label: "Gemini", y: 301, d: "M420 260 C470 260 486 301 532 301" },
  { label: "Bedrock", y: 419, d: "M420 260 C470 260 486 419 532 419" },
];

// Reversed OpenAI path — strokeless, used only for the returning packet.
const RETURN_D = "M532 65 C486 65 470 260 420 260";

export default function HeroGateway() {
  const [viewRef, seen] = useInViewOnce<HTMLDivElement>(0.25);
  const [hot, setHot] = useState<string | null>(null);
  const reduced = useReducedMotion();
  const tiltRef = usePointerTilt<HTMLDivElement>(5);
  const bgRef = useParallax<HTMLDivElement>(0.08);
  const midRef = useParallax<HTMLDivElement>(0.15);
  const fgRef = useParallax<HTMLDivElement>(0.25);

  // Hide animated targets before first paint — but only when JS is alive
  // and motion is allowed, so reduced-motion + no-JS stay fully visible.
  useLayoutEffect(() => {
    const root = viewRef.current;
    if (!root || reduced) return;
    const hidden = root.querySelectorAll(".gw-client, .gw-provider, .gw-core, .pkt");
    utils.set(hidden, { opacity: 0 });
    return () => {
      utils.set(hidden, { clear: "all" });
    };
  }, [reduced, viewRef]);

  useEffect(() => {
    const root = viewRef.current;
    if (!root || !seen || reduced) return;

    // Compositing hint only while motion is allowed — never forced for
    // reduced-motion or no-JS (parallax transforms stay cheap regardless).
    const layers = [bgRef.current, midRef.current, fgRef.current];
    layers.forEach((l) => {
      if (l) l.style.willChange = "transform";
    });

    const cleanups: Array<() => void> = [];
    const idle: Array<ReturnType<typeof animate>> = [];
    const flow: PacketFlow[] = [];
    let visible = true;
    let disposed = false;

    const clients = Array.from(root.querySelectorAll<SVGGElement>(".gw-client"));
    const core = root.querySelectorAll(".gw-core");
    const providers = root.querySelectorAll(".gw-provider");
    const dots = root.querySelectorAll(".gw-status");
    const paths = Array.from(root.querySelectorAll<SVGPathElement>(".gw-path"));
    const packets = Array.from(root.querySelectorAll<SVGCircleElement>(".pkt"));

    // 1) connection paths draw — 900ms, staggered; delayed so hero text
    //    (own reveal, starts at 0ms) is visible first.
    cleanups.push(drawSvgPaths(root, ".gw-path", { duration: 900, staggerMs: 70, delay: 120 }));

    // packets flow once the diagram has assembled (first 7 packets map 1:1
    // to the 7 visible paths in document order; the 8th is the response).
    const startFlow = () => {
      // Fade packets in as they launch so none pops at full opacity.
      const fadeIn = animate(packets, { opacity: [0, 1], duration: 450, ease: "linear" });
      cleanups.push(() => fadeIn.revert());
      paths.forEach((path, i) => {
        const pkt = packets[i];
        if (pkt) {
          const f = animatePackets(path, [pkt], { duration: i < 3 ? 2600 : 3200 });
          flow.push(f);
          cleanups.push(() => f.revert());
        }
      });
      const back = root.querySelector<SVGPathElement>("#gw-return");
      const backPkt = packets[7];
      if (back && backPkt) {
        const f = animatePackets(back, [backPkt], { duration: 2600 });
        flow.push(f);
        cleanups.push(() => f.revert());
      }
      if (!visible) flow.forEach((f) => f.pause());
    };

    // Idle loops — exactly 3 concurrent (halo breathe, core pulse, chip
    // float) plus 8 looping packet flows. All are created after assembly
    // and paused while off-screen.
    const startIdle = () => {
      const halo = root.querySelector(".gw-halo");
      if (halo) idle.push(animate(halo, { ...haloBreathe(), svgOrigin: "340 260" }));
      const pulse = root.querySelector(".gw-pulse");
      if (pulse) idle.push(animate(pulse, { ...gatewayPulse(), svgOrigin: "340 260" }));
      const chips = root.querySelectorAll(".gw-chip");
      if (chips.length) idle.push(animate(chips, float(6, 2800)));
      if (!visible) idle.forEach((a) => a.pause());
    };

    const tl = createTimeline({ defaults: { ease: "outExpo" } });
    // 2) clients pop — scale reveal, stagger 120, origin per card center
    clients.forEach((el, i) => {
      tl.add(
        el,
        { ...scaleReveal(0.9, 550), x: [-14, 0], svgOrigin: `76 ${CLIENTS[i].y}` },
        700 + i * 120
      );
    });
    // 3) gateway core scales in (idle pulse starts after assembly)
    tl.add(core, { ...scaleReveal(0.86, 700), svgOrigin: "340 260" }, 1250);
    // 4) providers light up, staggered — slide + settle around card center
    providers.forEach((el, i) => {
      tl.add(
        el,
        { ...scaleReveal(0.92, 500), x: [16, 0], svgOrigin: `596 ${PROVIDERS[i].y}` },
        1550 + i * 100
      );
    });
    // 5) status dots light — opacity + pop at each dot's center
    Array.from(dots).forEach((el, i) => {
      const dot = el as SVGCircleElement;
      tl.add(
        dot,
        {
          opacity: [0.15, 1],
          scale: [0.4, 1],
          duration: 380,
          ease: "outBack",
          svgOrigin: `${dot.cx.baseVal.value} ${dot.cy.baseVal.value}`,
        },
        1950 + i * 80
      );
    });
    // 6) packets flow + idle loops begin once assembly is complete
    const gate = { t: 0 };
    tl.add(
      gate,
      { t: 1, duration: 1, onComplete: () => { if (disposed) return; startFlow(); startIdle(); } },
      2500
    );
    cleanups.push(() => tl.revert());

    // Pause idle + packet loops whenever the illustration is off-screen.
    const io = new IntersectionObserver(
      (entries) => {
        visible = entries.some((e) => e.isIntersecting);
        idle.forEach((a) => (visible ? a.play() : a.pause()));
        flow.forEach((f) => (visible ? f.play() : f.pause()));
      },
      { threshold: 0 }
    );
    io.observe(root);

    return () => {
      disposed = true;
      io.disconnect();
      layers.forEach((l) => {
        if (l) l.style.willChange = "";
      });
      cleanups.forEach((fn) => fn());
      idle.forEach((a) => a.revert());
      flow.forEach((f) => f.revert());
    };
  }, [seen, reduced, viewRef]);

  return (
    <div ref={viewRef} role="img" aria-labelledby="gw-title gw-desc" className="w-full">
      {/* pointer-tilt target; the stack container below is its first child,
          so the hook writes perspective+rotate on it */}
      <div ref={tiltRef} className="mx-auto w-full max-w-[44rem]">
        {/* aspect-ratio keeps layout stable with or without JS */}
        <div className="relative aspect-[680/520]">
          {/* far layer: dot grid + faint network lines */}
          <div ref={bgRef} className="pointer-events-none absolute inset-0" aria-hidden="true">
            <svg viewBox="0 0 680 520" className="block h-full w-full">
              <defs>
                <pattern id="gw-dotgrid" width="26" height="26" patternUnits="userSpaceOnUse">
                  <circle cx="1.5" cy="1.5" r="1.5" fill="var(--color-line-strong)" />
                </pattern>
                <radialGradient id="gw-fade" cx="50%" cy="48%" r="58%">
                  <stop offset="0" stopColor="#fff" />
                  <stop offset="1" stopColor="#000" />
                </radialGradient>
                <mask id="gw-fade-mask">
                  <rect width="680" height="520" fill="url(#gw-fade)" />
                </mask>
              </defs>
              <rect
                width="680"
                height="520"
                fill="url(#gw-dotgrid)"
                mask="url(#gw-fade-mask)"
                opacity="0.6"
              />
              <g fill="none" stroke="var(--color-line)" strokeWidth="1">
                <path d="M84 70 L340 44 L596 78" />
                <path d="M110 462 L340 486 L572 452" />
              </g>
              <g fill="var(--color-line-strong)">
                <circle cx="84" cy="70" r="3" />
                <circle cx="340" cy="44" r="3" />
                <circle cx="596" cy="78" r="3" />
                <circle cx="110" cy="462" r="3" />
                <circle cx="340" cy="486" r="3" />
                <circle cx="572" cy="452" r="3" />
              </g>
            </svg>
          </div>

          {/* mid layer: connections + nodes + packets (exposed: holds title/desc) */}
          <div ref={midRef} className="absolute inset-0">
            <svg viewBox="0 0 680 520" className="block h-full w-full">
              <title id="gw-title">ToLLma gateway architecture</title>
              <desc id="gw-desc">
                Apps, agents, and CLI tools send requests through the ToLLma gateway, which routes
                them to OpenAI, Anthropic, Gemini, and Bedrock while tracking tokens and usage.
              </desc>

              {/* connection paths: brand-tinted inbound, teal-tinted outbound */}
              <g fill="none" strokeWidth="2" strokeLinecap="round">
                {CLIENTS.map((c) => (
                  <path
                    key={c.label}
                    className="gw-path"
                    d={c.d}
                    stroke="var(--color-brand)"
                    strokeOpacity="0.65"
                  />
                ))}
                {PROVIDERS.map((p) => (
                  <path
                    key={p.label}
                    className="gw-path"
                    d={p.d}
                    stroke="var(--color-teal)"
                    strokeOpacity={hot === p.label ? 1 : 0.65}
                    strokeWidth={hot === p.label ? 3 : 2}
                  />
                ))}
                <path id="gw-return" d={RETURN_D} stroke="none" />
              </g>

              {/* client nodes */}
              {CLIENTS.map((c) => (
                <g key={c.label} className="gw-client">
                  <rect
                    x="20"
                    y={c.y - 23}
                    width="112"
                    height="46"
                    rx="12"
                    fill="var(--color-surface)"
                    stroke="var(--color-line-strong)"
                    style={{ filter: "drop-shadow(var(--shadow-sm))" }}
                  />
                  <rect
                    x="34"
                    y={c.y - 7}
                    width="14"
                    height="14"
                    rx="4"
                    fill="var(--color-brand-soft)"
                    stroke="var(--color-brand)"
                    strokeWidth="1.5"
                  />
                  <text
                    x="58"
                    y={c.y}
                    dominantBaseline="middle"
                    fontSize="14"
                    fontWeight="600"
                    fill="var(--color-ink-soft)"
                  >
                    {c.label}
                  </text>
                </g>
              ))}

              {/* provider nodes with status dots */}
              {PROVIDERS.map((p) => (
                <g
                  key={p.label}
                  className="gw-provider"
                  onMouseEnter={() => setHot(p.label)}
                  onMouseLeave={() => setHot((h) => (h === p.label ? null : h))}
                >
                  <rect
                    x="532"
                    y={p.y - 21}
                    width="128"
                    height="42"
                    rx="11"
                    fill="var(--color-surface)"
                    stroke="var(--color-line-strong)"
                    style={{ filter: "drop-shadow(var(--shadow-sm))" }}
                  />
                  <text
                    x="550"
                    y={p.y}
                    dominantBaseline="middle"
                    fontSize="14"
                    fontWeight="600"
                    fill="var(--color-ink-soft)"
                  >
                    {p.label}
                  </text>
                  <circle className="gw-status" cx="644" cy={p.y} r="4.5" fill="var(--color-ok)" style={{ filter: "drop-shadow(0 0 4px var(--color-ok))" }} />
                </g>
              ))}

              {/* request packets (hidden in the static state) */}
              <g aria-hidden="true">
                {CLIENTS.map((c) => (
                  <circle
                    key={`pkt-${c.label}`}
                    className="pkt"
                    r="5"
                    fill="var(--color-brand)"
                    stroke="var(--color-surface)"
                    strokeWidth="1.5"
                    opacity="0"
                    style={{ filter: "drop-shadow(0 0 5px var(--color-brand))" }}
                    transform={`translate(132 ${c.y})`}
                  />
                ))}
                {PROVIDERS.map((p) => (
                  <circle
                    key={`pkt-${p.label}`}
                    className="pkt"
                    r="4"
                    fill="var(--color-teal)"
                    stroke="var(--color-surface)"
                    strokeWidth="1.5"
                    opacity="0"
                    style={{ filter: "drop-shadow(0 0 5px var(--color-teal))" }}
                    transform="translate(420 260)"
                  />
                ))}
                <circle
                  className="pkt"
                  r="5"
                  fill="var(--color-teal)"
                  stroke="var(--color-surface)"
                  strokeWidth="1.5"
                  opacity="0"
                  style={{ filter: "drop-shadow(0 0 6px var(--color-teal))" }}
                  transform="translate(532 65)"
                />
              </g>
            </svg>
          </div>

          {/* near layer: gateway core halo, hexagon, chips */}
          <div ref={fgRef} className="pointer-events-none absolute inset-0" aria-hidden="true">
            <svg viewBox="0 0 680 520" className="block h-full w-full">
              <defs>
                <linearGradient
                  id="tollma-gw-grad"
                  x1="260"
                  y1="190"
                  x2="420"
                  y2="330"
                  gradientUnits="userSpaceOnUse"
                >
                  <stop offset="0" stopColor="var(--color-brand)" />
                  <stop offset="1" stopColor="var(--color-teal)" />
                </linearGradient>
                <filter id="gw-core-shadow" x="-40%" y="-40%" width="180%" height="180%">
                  <feDropShadow
                    dx="0"
                    dy="10"
                    stdDeviation="14"
                    floodColor="var(--color-brand)"
                    floodOpacity="0.28"
                  />
                </filter>
              </defs>

              {/* gateway core: halo + hexagon + usage chip + float chips */}
              <g className="gw-core">
                <circle
                  className="gw-halo"
                  cx="340"
                  cy="260"
                  r="104"
                  fill="var(--color-brand-soft)"
                  opacity="0.5"
                />
                <g className="gw-pulse" filter="url(#gw-core-shadow)">
                  <polygon
                    points="420,260 380,329.3 300,329.3 260,260 300,190.7 380,190.7"
                    fill="url(#tollma-gw-grad)"
                  />
                  <text
                    x="340"
                    y="252"
                    textAnchor="middle"
                    fontSize="23"
                    fontWeight="700"
                    fill="var(--color-surface)"
                  >
                    ToLLma
                  </text>
                  <text
                    x="340"
                    y="277"
                    textAnchor="middle"
                    fontSize="11"
                    fontWeight="500"
                    letterSpacing="0.04em"
                    fill="var(--color-surface)"
                    opacity="0.85"
                  >
                    OpenAI-compatible
                  </text>
                </g>

                {/* static usage chip */}
                <g transform="translate(268 374)">
                  <rect
                    width="144"
                    height="36"
                    rx="10"
                    fill="var(--color-surface)"
                    stroke="var(--color-line-strong)"
                    style={{ filter: "drop-shadow(var(--shadow-sm))" }}
                  />
                  <path
                    d="M14 22 L20 22 L24 12 L29 28 L34 17 L38 22 L52 22"
                    fill="none"
                    stroke="var(--color-teal)"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <text x="62" y="23" fontSize="12" fontWeight="500" fill="var(--color-muted)">
                    tokens · usage
                  </text>
                </g>

                {/* floating accent chips (idle float, motion only) */}
                <g className="gw-chip">
                  <rect
                    x="176"
                    y="56"
                    width="104"
                    height="30"
                    rx="8"
                    fill="var(--color-surface)"
                    stroke="var(--color-line-strong)"
                    style={{ filter: "drop-shadow(var(--shadow-sm))" }}
                  />
                  <circle cx="191" cy="71" r="3.5" fill="var(--color-brand)" />
                  <text x="203" y="71" dominantBaseline="middle" fontSize="11" fontWeight="600" fill="var(--color-ink-soft)">
                    1 endpoint
                  </text>
                </g>
                <g className="gw-chip">
                  <rect
                    x="424"
                    y="440"
                    width="104"
                    height="30"
                    rx="8"
                    fill="var(--color-surface)"
                    stroke="var(--color-line-strong)"
                    style={{ filter: "drop-shadow(var(--shadow-sm))" }}
                  />
                  <circle cx="439" cy="455" r="3.5" fill="var(--color-teal)" />
                  <text x="451" y="455" dominantBaseline="middle" fontSize="11" fontWeight="600" fill="var(--color-ink-soft)">
                    cost control
                  </text>
                </g>
              </g>
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}
