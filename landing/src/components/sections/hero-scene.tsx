"use client";

import { useEffect, useRef, useState } from "react";
import type { HeroNodeMeta, HeroSceneApi } from "./hero-scene-engine";
import markWhite from "./brand/tollma-mark-white.png";
import markInk from "./brand/tollma-mark-ink.png";

// ============================================================
// Hero scene: a lazy-loaded three.js gateway with a premium static
// SVG fallback (also used for reduced motion and no-WebGL). The 3D
// engine lives in hero-scene-engine.ts and is only imported once the
// scene is near the viewport.
// ============================================================

const CLIENTS: HeroNodeMeta[] = [
  { id: "app", label: "App", position: [-2.9, 1.5, 0.8] },
  { id: "agent", label: "Agent", position: [-3.0, 0, 0.2] },
  { id: "cli", label: "CLI", position: [-2.85, -1.5, 0.9] },
];

const PROVIDERS: HeroNodeMeta[] = [
  { id: "openai", label: "OpenAI", position: [2.9, 2.0, 0.9], color: "#10a37f" },
  { id: "anthropic", label: "Anthropic", position: [3.5, 1.2, 0.05], color: "#d97757" },
  { id: "gemini", label: "Gemini", position: [3.7, 0.4, 0.75], color: "#4285f4" },
  { id: "vertex", label: "Vertex AI", position: [3.5, -0.45, -0.15], color: "#34a853" },
  { id: "bedrock", label: "Bedrock", position: [3.0, -1.3, 0.55], color: "#ff9900" },
  { id: "custom", label: "Custom", position: [2.55, -2.1, 0.25], color: "#7c3aed" },
];

function detectGL(): { ok: boolean; software: boolean } {
  const fail = { ok: false, software: false };
  try {
    const canvas = document.createElement("canvas");
    const gl = (canvas.getContext("webgl2") ||
      canvas.getContext("webgl")) as WebGLRenderingContext | null;
    if (!gl) return fail;
    // Software rasterizers (headless CI, weak iGPUs) get a lean tier:
    // smaller buffer + fewer fps, same composition and labels.
    let software = false;
    try {
      const ext = gl.getExtension("WEBGL_debug_renderer_info");
      const renderer = ext
        ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL))
        : "";
      software = /swiftshader|llvmpipe|software|basic render|angle \(google/i.test(renderer);
    } catch {
      software = false;
    }
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return { ok: true, software };
  } catch {
    return fail;
  }
}

// ------------------------------------------------------------
// Static SVG fallback — no animation, same story and labels.
// ------------------------------------------------------------
function HeroFallback() {
  const clients = [
    { label: "App", y: 170 },
    { label: "Agent", y: 280 },
    { label: "CLI", y: 390 },
  ];
  const providers = [
    { label: "OpenAI", y: 75, color: "#10a37f" },
    { label: "Anthropic", y: 153, color: "#d97757" },
    { label: "Gemini", y: 231, color: "#4285f4" },
    { label: "Vertex AI", y: 309, color: "#34a853" },
    { label: "Bedrock", y: 387, color: "#ff9900" },
    { label: "Custom", y: 465, color: "#7c3aed" },
  ];

  return (
    <svg
      viewBox="0 0 640 560"
      className="h-full w-full"
      role="img"
      aria-labelledby="hero-fallback-title hero-fallback-desc"
      preserveAspectRatio="xMidYMid meet"
    >
      <title id="hero-fallback-title">ToLLma gateway overview</title>
      <desc id="hero-fallback-desc">
        App, agent and CLI requests flow through the ToLLma gateway to OpenAI, Anthropic, Gemini,
        Vertex AI, AWS Bedrock and custom OpenAI-compatible providers.
      </desc>
      <defs>
        <radialGradient id="hero-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#60a5fa" stopOpacity="0.42" />
          <stop offset="55%" stopColor="#818cf8" stopOpacity="0.16" />
          <stop offset="100%" stopColor="#f8fbff" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="hero-floor" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#93c5fd" stopOpacity="0.26" />
          <stop offset="100%" stopColor="#93c5fd" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="hero-hex" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#1d4ed8" />
          <stop offset="52%" stopColor="#2563eb" />
          <stop offset="100%" stopColor="#06b6d4" />
        </linearGradient>
        <linearGradient id="hero-hex-top" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#bfdbfe" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.55" />
        </linearGradient>
        <filter id="hero-card-shadow" x="-30%" y="-30%" width="160%" height="180%">
          <feDropShadow dx="0" dy="7" stdDeviation="9" floodColor="#0b1b34" floodOpacity="0.1" />
        </filter>
        <pattern id="hero-dots" width="22" height="22" patternUnits="userSpaceOnUse">
          <circle cx="1.5" cy="1.5" r="1.1" fill="#bfd3ea" />
        </pattern>
      </defs>

      <ellipse cx="322" cy="282" rx="270" ry="216" fill="url(#hero-glow)" />
      <rect x="0" y="0" width="640" height="560" fill="url(#hero-dots)" opacity="0.22" />
      <ellipse cx="322" cy="452" rx="238" ry="40" fill="url(#hero-floor)" />
      <ellipse
        cx="322"
        cy="452"
        rx="200"
        ry="30"
        fill="none"
        stroke="#93c5fd"
        strokeOpacity="0.24"
        strokeDasharray="3 7"
      />

      {/* client → gateway */}
      {clients.map((c) => (
        <g key={c.label}>
          <path
            d={`M152 ${c.y} C 196 ${c.y}, 206 288, 240 288`}
            fill="none"
            stroke="#2563eb"
            strokeOpacity="0.3"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
          <circle cx="196" cy={c.y + (288 - c.y) * 0.42} r="2.4" fill="#3b82f6" />
          <circle cx="221" cy={c.y + (288 - c.y) * 0.72} r="2" fill="#93c5fd" />
        </g>
      ))}

      {/* gateway → providers */}
      {providers.map((p) => (
        <g key={p.label}>
          <path
            d={`M404 288 C 432 288, 440 ${p.y}, 472 ${p.y}`}
            fill="none"
            stroke={p.color}
            strokeOpacity="0.32"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
          <circle cx="438" cy={288 + (p.y - 288) * 0.55} r="2.3" fill={p.color} />
          <circle cx="458" cy={288 + (p.y - 288) * 0.82} r="1.9" fill={p.color} opacity="0.7" />
        </g>
      ))}

      {/* clients */}
      {clients.map((c) => (
        <g key={`card-${c.label}`} filter="url(#hero-card-shadow)">
          <rect
            x="16"
            y={c.y - 22}
            width="136"
            height="44"
            rx="12"
            fill="#ffffff"
            stroke="#dbe6f3"
          />
          <rect x="30" y={c.y - 10} width="20" height="20" rx="6" fill="#e7eeff" stroke="#bfdbfe" />
          <circle cx="40" cy={c.y} r="3" fill="#2563eb" />
          <text x="60" y={c.y + 4} fontSize="12.5" fontWeight="600" fill="#0b1b34">
            {c.label}
          </text>
        </g>
      ))}

      {/* gateway prism */}
      <g>
        <ellipse cx="320" cy="288" rx="152" ry="140" fill="none" stroke="#93c5fd" strokeOpacity="0.2" strokeDasharray="2 8" />
        <polygon
          points="320,186 396,226 320,266 244,226"
          fill="url(#hero-hex-top)"
          stroke="#dbeafe"
          strokeOpacity="0.7"
        />
        <polygon
          points="320,202 400,246 400,330 320,374 240,330 240,246"
          fill="url(#hero-hex)"
          stroke="#bfdbfe"
          strokeOpacity="0.55"
          strokeWidth="1.2"
        />
        <polygon
          points="320,220 380,254 380,322 320,356 260,322 260,254"
          fill="#ffffff"
          fillOpacity="0.06"
          stroke="#ffffff"
          strokeOpacity="0.22"
        />
        <image
          href={markWhite.src}
          x="272"
          y="222"
          width="96"
          height="96"
          preserveAspectRatio="xMidYMid meet"
        />
        <text
          x="320"
          y="350"
          textAnchor="middle"
          fontSize="23"
          fontWeight="700"
          fill="#ffffff"
          letterSpacing="-0.4"
        >
          ToLLma
        </text>
        <ellipse cx="320" cy="378" rx="112" ry="18" fill="none" stroke="#38bdf8" strokeOpacity="0.35" />
      </g>

      {/* providers */}
      {providers.map((p) => (
        <g key={`provider-${p.label}`} filter="url(#hero-card-shadow)">
          <rect
            x="472"
            y={p.y - 18}
            width="152"
            height="36"
            rx="10"
            fill="#ffffff"
            stroke="#dbe6f3"
          />
          <circle cx="488" cy={p.y} r="4" fill={p.color} />
          <text x="500" y={p.y + 4} fontSize="11.5" fontWeight="600" fill="#2b3d5c">
            {p.label}
          </text>
          <circle cx="608" cy={p.y} r="3" fill="#12a150" />
        </g>
      ))}
    </svg>
  );
}

export default function HeroScene() {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const labelRefs = useRef<Record<string, HTMLElement | null>>({});
  const apiRef = useRef<HeroSceneApi | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    const root = rootRef.current;
    if (!host || !root) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const gl = detectGL();
    if (!gl.ok) {
      root.dataset.sceneState = "fallback";
      return;
    }

    let cancelled = false;
    let api: HeroSceneApi | null = null;

    const load = async () => {
      try {
        const { initHeroScene } = await import("./hero-scene-engine");
        if (cancelled) return;
        api = initHeroScene({
          host,
          labels: labelRefs.current,
          clients: CLIENTS,
          providers: PROVIDERS,
          markWhiteUrl: markWhite.src,
          markInkUrl: markInk.src,
          software: gl.software,
          onFail: () => {
            setReady(false);
            root.dataset.sceneState = "fallback";
          },
        });
        if (cancelled || !api) {
          root.dataset.sceneState = "fallback";
          return;
        }
        apiRef.current = api;
        setReady(true);
        root.dataset.sceneState = "ready";
      } catch {
        root.dataset.sceneState = "fallback";
      }
    };

    // Defer the three.js download/parse until the main thread is idle so
    // the hero text paints and stays interactive first. The static fallback
    // is complete content, so the scene can arrive late with no layout shift
    // and no interactivity cost. The generous timeout only binds loaded
    // machines — exactly where deferral matters most.
    const requestIdle: (cb: () => void, opts?: { timeout: number }) => void =
      typeof window !== "undefined" && "requestIdleCallback" in window
        ? (cb, opts) => window.requestIdleCallback(cb, opts)
        : (cb) => window.setTimeout(cb, 4000);
    // Start loading on the first sign of a real user (any pointer
    // activity) — intent prefetch. Otherwise wait for idle, with a long
    // backstop so automated runs still get the scene after TTI.
    let started = false;
    const start = () => {
      if (started) return;
      started = true;
      io.disconnect();
      window.removeEventListener("pointermove", start);
      window.removeEventListener("pointerdown", start);
      window.removeEventListener("touchstart", start);
      requestIdle(() => void load(), { timeout: 7000 });
    };
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) start();
      },
      { rootMargin: "240px" }
    );
    io.observe(root);
    window.addEventListener("pointermove", start, { passive: true });
    window.addEventListener("pointerdown", start, { passive: true });
    window.addEventListener("touchstart", start, { passive: true });

    return () => {
      cancelled = true;
      io.disconnect();
      window.removeEventListener("pointermove", start);
      window.removeEventListener("pointerdown", start);
      window.removeEventListener("touchstart", start);
      api?.dispose();
      apiRef.current = null;
    };
  }, []);

  return (
    <div
      ref={rootRef}
      data-scene-ready={ready ? "true" : "false"}
      data-scene-state={ready ? "ready" : "fallback"}
      className="hero-scene relative h-[380px] w-full min-[900px]:h-[520px]"
    >
      <div
        aria-hidden={ready}
        className={`absolute inset-0 transition-opacity duration-700 ${
          ready ? "pointer-events-none opacity-0" : "opacity-100"
        }`}
      >
        <HeroFallback />
      </div>

      <div
        ref={hostRef}
        aria-hidden={!ready}
        className={`absolute inset-0 transition-opacity duration-700 ${
          ready ? "opacity-100" : "opacity-0"
        }`}
      />

      <div
        aria-hidden={!ready}
        style={{ visibility: ready ? "visible" : "hidden" }}
        className="pointer-events-none absolute inset-0"
      >
        {CLIENTS.map((client) => (
          <span
            key={client.id}
            data-node-label
            ref={(el) => {
              labelRefs.current[client.id] = el;
            }}
            className="hero-node-label hero-node-label--client"
          >
            {client.label}
          </span>
        ))}
        {PROVIDERS.map((provider) => (
          <button
            key={provider.id}
            data-node-label
            ref={(el) => {
              labelRefs.current[provider.id] = el;
            }}
            type="button"
            aria-label={`${provider.label} provider node`}
            onMouseEnter={() => apiRef.current?.setHovered(provider.id)}
            onMouseLeave={() => apiRef.current?.setHovered(null)}
            onFocus={() => apiRef.current?.setHovered(provider.id)}
            onBlur={() => apiRef.current?.setHovered(null)}
            className="hero-node-label hero-node-label--provider pointer-events-auto"
          >
            <span
              aria-hidden="true"
              className="hero-node-dot"
              style={{ backgroundColor: provider.color }}
            />
            {provider.label}
          </button>
        ))}
      </div>
    </div>
  );
}
