"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { Container, Section, SectionHeading } from "@/components/ui/layout";
import { Badge } from "@/components/ui/primitives";
import {
  IconActivity,
  IconArrowRight,
  IconChart,
  IconCheck,
  IconGateway,
  IconKey,
  IconLayers,
  IconLock,
  IconOrg,
} from "@/components/ui/icons";
import {
  animate,
  createTimeline,
  fadeUp,
  scaleReveal,
  stagger,
  svg,
  useInViewOnce,
  useReducedMotion,
  utils,
} from "@/lib/animations";
import { GATEWAY_BASE } from "@/lib/site";

// ============================================================
// Problem -> solution section.
// Composition: asymmetric split - a "scattered slips" column of pain
// points (deliberately misaligned, desaturated) vs. one confident
// ToLLma gateway panel. Below: an animated SVG convergence diagram
// (scattered nodes -> funnel -> gateway). Static state is fully readable.
//
// Choreography: one coordinated timeline tells the story in ~3.4s -
// heading, pain slips stagger in fragmented, converging lines draw,
// nodes settle (ease-out-back), gateway emphasis, caption lands.
// Hovering or keyboard-focusing a pain slip highlights its matching
// line + node in the diagram and dims the rest.
// ============================================================

const PAINS = [
  { icon: IconLayers, title: "A different API per provider", note: "Chat, Messages, Converse — each shape is yours to adapt.", nudge: "" },
  { icon: IconKey, title: "Credentials everywhere", note: "A key per vendor, scattered across envs and repos.", nudge: "sm:ml-7" },
  { icon: IconActivity, title: "Fragmented usage data", note: "Every console reports usage differently, if at all.", nudge: "sm:ml-3" },
  { icon: IconChart, title: "Cost tracked by hand", note: "Spend reconciled after the invoice, not before it.", nudge: "sm:ml-9" },
  { icon: IconLock, title: "Inconsistent guardrails", note: "Security controls that change with every provider.", nudge: "sm:ml-2" },
  { icon: IconOrg, title: "Blind across your apps", note: "No single view of who calls what, with which key.", nudge: "sm:ml-6" },
] as const;

const SOLUTION = [
  { title: "One endpoint", note: "OpenAI-compatible, every provider behind it" },
  { title: "One key model", note: "Issue, scope, and revoke gateway keys centrally" },
  { title: "One usage view", note: "Tokens, requests, and cost across all apps" },
  { title: "One policy layer", note: "Guardrails enforced on every request" },
] as const;

// Diagram geometry: six nodes settle into a tidy column (x 40..168),
// converge into a funnel at (600,162), flow through process chevrons
// into the ToLLma gateway panel (x 712..920). Scattered start offsets
// (data-dx/dy) are applied in JS only when motion is allowed.
const NODES = [
  { label: "APIs", cy: 44, dx: -16, dy: -28 },
  { label: "Keys", cy: 91, dx: 26, dy: 20 },
  { label: "Usage", cy: 138, dx: -30, dy: 14 },
  { label: "Cost", cy: 186, dx: 18, dy: -22 },
  { label: "Guardrails", cy: 233, dx: -12, dy: 28 },
  { label: "Visibility", cy: 280, dx: 30, dy: -16 },
] as const;

export default function Problem() {
  const [rootRef, seen] = useInViewOnce<HTMLDivElement>(0.1);
  const reduced = useReducedMotion();
  const highlightRef = useRef<(() => void) | null>(null);

  // Pre-state: hide sequenced elements and scatter the nodes - only when
  // JS is alive and motion is allowed, so reduced-motion + no-JS show the
  // settled, fully readable composition.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || reduced) return;
    const heading = root.querySelector<HTMLElement>("[data-pf-heading]");
    const slips = Array.from(root.querySelectorAll<HTMLElement>("[data-pf-slip]"));
    const panel = root.querySelector<HTMLElement>("[data-pf-panel]");
    const caption = root.querySelector<HTMLElement>("[data-pf-caption]");
    const nodes = Array.from(root.querySelectorAll<SVGElement>(".pf-node"));

    if (heading) utils.set(heading, { opacity: 0, y: 20 });
    // Slips start tilted and nudged off their mark: fragmentation, before
    // they settle into their (still misaligned) resting positions.
    slips.forEach((el, i) => {
      utils.set(el, { opacity: 0, y: 14, x: i % 2 ? 10 : -10, rotate: i % 2 ? 1.5 : -1.5 });
    });
    if (panel) utils.set(panel, { opacity: 0, scale: 0.96 });
    if (caption) utils.set(caption, { opacity: 0, y: 12 });
    nodes.forEach((el) => {
      utils.set(el, {
        opacity: 0,
        x: Number(el.dataset.dx ?? 0),
        y: Number(el.dataset.dy ?? 0),
      });
    });

    return () => {
      if (heading) utils.set(heading, { clear: "all" });
      slips.forEach((el) => utils.set(el, { clear: "all" }));
      if (panel) utils.set(panel, { clear: "all" });
      if (caption) utils.set(caption, { clear: "all" });
      nodes.forEach((el) => utils.set(el, { clear: "all" }));
    };
  }, [rootRef, reduced]);

  // Coordinated sequence (~3.5s): heading -> pain slips (fragmented
  // stagger) -> panel -> lines draw -> nodes settle (ease-out-back) ->
  // gateway emphasis -> caption lands. Non-blocking: every beat is
  // transform/opacity, content is readable throughout and fully static
  // when reduced.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !seen || reduced) return;

    const heading = root.querySelector<HTMLElement>("[data-pf-heading]");
    const slips = Array.from(root.querySelectorAll<HTMLElement>("[data-pf-slip]"));
    const panel = root.querySelector<HTMLElement>("[data-pf-panel]");
    const caption = root.querySelector<HTMLElement>("[data-pf-caption]");
    const nodes = Array.from(root.querySelectorAll<SVGElement>(".pf-node"));
    const lines = Array.from(root.querySelectorAll<SVGPathElement>(".pf-line"));
    const gate = root.querySelectorAll<SVGElement>(".pf-gate");

    const drawables = lines.flatMap((p) => svg.createDrawable(p));
    const tl = createTimeline({ defaults: { ease: "outExpo" } });

    // (a) heading
    if (heading) tl.add(heading, { ...fadeUp(20, 600) }, 0);
    // (b) pain slips stagger in, tilts straightening as they land
    if (slips.length) {
      tl.add(
        slips,
        { opacity: [0, 1], x: 0, y: 0, rotate: 0, duration: 600, delay: stagger(70) },
        250
      );
    }
    // unified panel settles in with a gentle pop
    if (panel) tl.add(panel, { ...scaleReveal(0.96, 700) }, 900);
    // (c) converging lines draw
    tl.add(
      drawables,
      { duration: 750, delay: stagger(60, { start: 250 }), ease: "inOutQuad" },
      1050
    );
    // nodes fade in scattered (overlapping the drawing)
    tl.add(nodes, { opacity: [0, 1], duration: 400, delay: stagger(60) }, 1150);
    // (d) settle into the unified column - ease-out-back polish
    tl.add(
      nodes,
      { x: 0, y: 0, duration: 850, delay: stagger(60), ease: "outBack" },
      1950
    );
    // (e) gateway emphasis, then the fragmented -> unified caption
    tl.add(gate, { ...scaleReveal(0.94, 600) }, 2800);
    if (caption) tl.add(caption, { ...fadeUp(12, 600) }, 3000);

    return () => {
      tl.revert();
      highlightRef.current?.();
      if (heading) utils.set(heading, { clear: "all" });
      slips.forEach((el) => utils.set(el, { clear: "all" }));
      if (panel) utils.set(panel, { clear: "all" });
      if (caption) utils.set(caption, { clear: "all" });
      nodes.forEach((el) => utils.set(el, { clear: "all" }));
      highlightRef.current = null;
    };
  }, [rootRef, seen, reduced]);

  // Highlight anims from hover/focus must not leak across unmount.
  useEffect(() => {
    return () => {
      highlightRef.current?.();
      highlightRef.current = null;
    };
  }, []);

  // Interaction: hovering or keyboard-focusing a pain slip highlights its
  // matching converging line + node in the diagram and dims the rest -
  // visually linking each fragmentation to the unified side. Instant style
  // swaps when reduced motion is preferred (no animation).
  const highlight = (index: number | null) => {
    const root = rootRef.current;
    if (!root) return;
    highlightRef.current?.();
    highlightRef.current = null;
    const lines = Array.from(root.querySelectorAll<SVGPathElement>(".pf-line[data-index]"));
    const nodes = Array.from(root.querySelectorAll<SVGElement>(".pf-node[data-index]"));
    const setStroke = (el: SVGPathElement, on: boolean) => {
      el.style.stroke = on ? "var(--color-brand)" : "";
      el.style.strokeWidth = on ? "2.4" : "";
    };
    const reset = () => {
      lines.forEach((el) => {
        setStroke(el, false);
        el.style.opacity = "";
      });
      nodes.forEach((el) => {
        el.style.opacity = "";
      });
    };
    if (reduced) {
      if (index === null) return;
      lines.forEach((el) => {
        const on = Number(el.dataset.index) === index;
        setStroke(el, on);
        el.style.opacity = on ? "1" : "0.22";
      });
      nodes.forEach((el) => {
        const on = Number(el.dataset.index) === index;
        el.style.opacity = on ? "1" : "0.3";
      });
      highlightRef.current = reset;
      return;
    }
    const anims: Array<{ revert: () => void }> = [];
    lines.forEach((el) => {
      const on = index !== null && Number(el.dataset.index) === index;
      setStroke(el, on);
      anims.push(animate(el, { opacity: index === null ? 1 : on ? 1 : 0.22, duration: 220, ease: "outQuad" }));
    });
    nodes.forEach((el) => {
      const on = index !== null && Number(el.dataset.index) === index;
      anims.push(animate(el, { opacity: index === null ? 1 : on ? 1 : 0.3, duration: 220, ease: "outQuad" }));
    });
    highlightRef.current = () => {
      anims.forEach((a) => a.revert());
      lines.forEach((el) => setStroke(el, false));
    };
  };

  return (
    <Section id="problem" tone="canvas" className="overflow-clip">
      <Container width="wide" className="relative">
        <div ref={rootRef} className="flex flex-col gap-12 lg:gap-16">
          <div data-pf-heading>
            <SectionHeading
              eyebrow="The problem"
              title={
                <>
                  Every new model adds <span className="text-muted">a new mess.</span>
                </>
              }
              lead="Each provider ships its own API, its own credentials, its own usage format, and its own security model. Add a second, third, fifth provider and your team maintains integrations instead of shipping features."
            />
          </div>

          {/* Asymmetric split: scattered slips vs. one unified panel */}
          <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,6fr)_minmax(0,5fr)] lg:gap-14 xl:gap-20">
            {/* Side A - fragmented */}
            <div className="flex min-w-0 flex-col gap-5">
              <p className="text-xs font-semibold tracking-[0.14em] text-faint uppercase">
                Without a gateway
              </p>
              <ul className="flex flex-col gap-3">
                {PAINS.map(({ icon: Icon, title, note, nudge }, i) => (
                  <li
                    key={title}
                    data-pf-slip
                    onMouseEnter={() => highlight(i)}
                    onMouseLeave={() => highlight(null)}
                    className={`flex max-w-md cursor-default items-start gap-3.5 rounded-xl border border-dashed border-line-strong bg-surface/70 px-4 py-3.5 shadow-xs transition-shadow duration-[var(--dur-fast)] ease-[var(--ease-out-expo)] hover:shadow-sm ${nudge}`}
                  >
                    <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-surface-cool text-faint">
                      <Icon size={17} />
                    </span>
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="text-[0.95rem] font-medium text-ink-soft">{title}</span>
                      <span className="text-sm leading-relaxed text-muted">{note}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Side B - unified */}
            <div
              data-pf-panel
              className="relative flex min-w-0 flex-col gap-6 rounded-2xl border border-line bg-surface p-6 shadow-md ring-1 ring-brand/15 lg:sticky lg:top-24"
            >
              <div className="absolute inset-x-8 -top-px h-px bg-gradient-to-r from-transparent via-brand to-transparent" />
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="grid size-10 place-items-center rounded-xl bg-brand text-white">
                    <IconGateway size={20} />
                  </span>
                  <span className="text-lg font-semibold text-ink">With ToLLma</span>
                </div>
                <Badge tone="teal">One gateway</Badge>
              </div>

              <p
                className="font-semibold tracking-tight text-balance text-ink"
                style={{ fontSize: "var(--t-h3)", lineHeight: 1.2 }}
              >
                One gateway unifies everything.
              </p>

              <ul className="flex flex-col divide-y divide-line">
                {SOLUTION.map((row) => (
                  <li key={row.title} className="flex items-start gap-3 py-3.5 first:pt-0 last:pb-0">
                    <IconCheck size={18} className="mt-0.5 shrink-0 text-brand" />
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="text-[0.95rem] font-medium text-ink">{row.title}</span>
                      <span className="text-sm leading-relaxed text-muted">{row.note}</span>
                    </span>
                  </li>
                ))}
              </ul>

              <p className="block max-w-full overflow-x-auto rounded-lg bg-surface-cool px-3.5 py-2.5 font-mono text-xs whitespace-nowrap text-ink-soft">
                <code translate="no">POST {GATEWAY_BASE}/chat/completions</code>
              </p>
            </div>
          </div>

          {/* Animated convergence: scattered -> funnel -> gateway */}
          <div className="relative min-w-0">
            <svg
              viewBox="0 0 960 340"
              className="block h-auto w-full max-w-full"
              role="img"
              aria-label="Scattered provider concerns converging through the ToLLma gateway into one unified system"
            >
              {/* Converging lines + process chevrons + arrow (drawn on scroll) */}
              {NODES.map((n, i) => (
                <path
                  key={`l-${n.label}`}
                  className="pf-line stroke-line-strong"
                  data-index={i}
                  d={`M168 ${n.cy} C 320 ${n.cy} 420 162 600 162`}
                  fill="none"
                  strokeWidth={1.6}
                  strokeLinecap="round"
                />
              ))}
              {[616, 636, 656].map((x) => (
                <path
                  key={`c-${x}`}
                  className="pf-line stroke-brand/60"
                  d={`M${x} 148 l10 14 -10 14`}
                  fill="none"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ))}
              <path
                className="pf-line stroke-brand"
                d="M678 162 h26 M698 155 l8 7 -8 7"
                fill="none"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />

              {/* Scattered -> settled nodes */}
              {NODES.map((n, i) => (
                <g key={n.label} className="pf-node" data-index={i} data-dx={n.dx} data-dy={n.dy}>
                  <rect
                    x={40}
                    y={n.cy - 16}
                    width={128}
                    height={32}
                    rx={9}
                    className="fill-surface stroke-line-strong"
                    strokeWidth={1.4}
                  />
                  <circle cx={58} cy={n.cy} r={3.5} className="fill-faint" />
                  <text
                    x={72}
                    y={n.cy}
                    dominantBaseline="middle"
                    className="text-[11px] font-medium fill-muted"
                  >
                    {n.label}
                  </text>
                </g>
              ))}

              {/* ToLLma gateway */}
              <g className="pf-gate [transform-box:fill-box] [transform-origin:center]">
                <rect
                  x={712}
                  y={104}
                  width={208}
                  height={116}
                  rx={18}
                  className="fill-brand-soft stroke-brand"
                  strokeWidth={1.6}
                />
                <rect
                  x={734}
                  y={138}
                  width={48}
                  height={48}
                  rx={14}
                  className="fill-surface stroke-brand"
                  strokeWidth={1.6}
                />
                <path
                  d="M746 162h24M758 150v24"
                  className="stroke-brand"
                  fill="none"
                  strokeWidth={1.8}
                  strokeLinecap="round"
                />
                <text x={798} y={158} className="text-[15px] font-semibold fill-ink">
                  ToLLma Gateway
                </text>
                <text x={798} y={178} className="text-[11px] fill-muted">
                  one endpoint · one policy
                </text>
              </g>
            </svg>

            <div
              data-pf-caption
              className="mx-auto mt-5 flex max-w-2xl flex-wrap items-center justify-center gap-x-6 gap-y-2 text-center text-sm text-balance text-muted"
            >
              <span>6 integrations, 6 dashboards, 6 security models.</span>
              <IconArrowRight size={16} className="hidden shrink-0 text-brand sm:block" />
              <span className="font-medium text-ink">One of each.</span>
            </div>
          </div>
        </div>
      </Container>
    </Section>
  );
}
