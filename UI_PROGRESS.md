# UI Progress — ToLLma Landing Upgrade

Stack: Next.js 16 App Router (static export) · React 19 · Tailwind v4 ·
Anime.js v4 · TypeScript. Preview: `http://localhost:4400` (served from
`landing/out`).

## Library decision

No new animation/scroll/3D dependencies were installed. The page already
runs **Anime.js v4** as its single motion engine, with native CSS
`scroll-behavior: smooth`, `IntersectionObserver` reveals, CSS `sticky` for
the pinned stepper, and SVG/CSS pseudo-3D (perspective tilt, layered depth).
Adding Lenis, GSAP, or Three.js would duplicate that system, add bundle
weight, and conflict with the existing reduced-motion/cleanup architecture.
A real WebGL scene is used only if it buys something the layered SVG hero
does not — it does not here.

## Section map

| # | Section | File(s) |
|---|---|---|
| 1 | Navbar | `src/components/sections/nav.tsx` |
| 2 | Hero | `src/components/sections/hero.tsx`, `hero-gateway.tsx` |
| 3 | Problem | `src/components/sections/problem.tsx` |
| 4 | Convergence diagram | `src/components/sections/problem.tsx` |
| 5 | Platform bento | `src/components/sections/features.tsx` |
| 6 | How it works | `src/components/sections/how-it-works.tsx` |
| 7 | Providers | `src/components/sections/providers.tsx` |
| 8 | Product preview | `src/components/sections/product.tsx` |
| 9 | Security & governance | `src/components/sections/security.tsx` |
| 10 | Developer experience | `src/components/sections/developers.tsx` |
| 11 | Open source | `src/components/sections/opensource.tsx` |
| 12 | Self-hosted | `src/components/sections/selfhosted.tsx` |
| 13 | Final CTA | `src/components/sections/get-started.tsx` |
| 14 | Footer | `src/components/sections/closing.tsx` |
| — | Shared system | `src/app/globals.css`, `src/app/layout.tsx`, `src/components/ui/*`, `src/lib/animations/*` |

## Checklist

| Section | Implemented | Desktop OK | Tablet OK | Mobile OK | Interactions OK | Scroll FX OK | A11y OK | Notes |
|---|---|---|---|---|---|---|---|---|
| Navbar | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 2px gradient scroll-progress bar; active underline; glass on scroll; animated mobile panel; GitHub hover |
| Hero | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | CSS-first H1 (LCP fix), word entrance, gradient phrase, parallax blobs, scroll cue, pointer tilt, provider-beam hover |
| Problem | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Equal-height before/after cards, coordinated reveal, endpoint scrolls at 320 |
| Convergence | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Bordered compact diagram, visible drawn paths, logo gateway, hover-linked pills, pulse packets, mobile vertical flow |
| Platform | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Usage chart fills tile (no dead space), key reveal, guardrail demo, disclosure, keyboard-scrollable code |
| How it works | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | CSS-sticky pinned stepper, scroll-driven active step, clickable steps, detail panel, mobile timeline |
| Providers | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Six tabs on one row, measured sliding indicator, labeled nodes, pulse, copy curl, equal columns |
| Product | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Perspective tilt levels on scroll; tabs, keyboard, panels, log region |
| Security | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Equal columns (813/813), stage numbers/fill, safe/injection simulator, scope/enforcement, chip descriptions |
| Developers | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Language tabs, copy, line entrance, disclosure, mobile-scrollable snippets |
| Open source | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Apache 2.0 statement, seal, resource cards, honest placeholder note |
| Self-hosted | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Copy command, 5 services on one row, boot dots/bars, connectors, fitted dashed box |
| Final CTA | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Aurora wash, floating gateway orb, gradient headline, shine buttons, stray dot/line motif removed |
| Footer | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 4-column desktop, 2-column tablet, stacked mobile; 9 valid links; license + placeholder note |
| Full page | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Zero horizontal overflow at all 9 widths; no console errors/warnings; desktop Lighthouse 98/100/100/100 |

Legend: ⏳ pending · ✅ pass · ❌ fail

## Defects found and fixed in this pass

- **Providers mobile overflow (real bug):** the long curl snippet forced
  its grid item to 546px at a 390px viewport, expanding the layout viewport
  and pushing the hamburger off-screen. Added the `min-w-0` chain and
  `w-full max-w-full` on the snippet. `scrollWidth` is now exactly the
  viewport at 320/375/390/430.
- **Drawable lines invisible:** `svg.createDrawable` was animated without a
  `draw` target, leaving `stroke-dasharray: 0, length`. Added
  `draw: ["0 0","0 1"]` to the shared `drawSvgPaths` helper and the Problem
  timeline. All line-draw effects (hero, security, problem) now render.
- **Providers tabs wrapped:** moved to a full-width segmented control above
  the two-column grid; measured sliding indicator; one row at ≥1024.
- **Convergence diagram:** rebuilt to a compact bordered card; gateway copy
  fits with padding; animated paths and pulses now visible; mobile stacks
  vertically.
- **Usage chart dead space:** removed the fixed 150px chart height; the
  chart fills the tile and anchors to the baseline.
- **Security imbalance:** columns are equal height (measured 813/813);
  categories moved under the diagram; stage numbers added; simulator added.
- **Self-hosted wrap:** fifth service wrapped at `lg`; connectors narrowed
  and `lg:flex-nowrap`; all five share one row.
- **CTA stray mark:** removed the center node/packets/line motif that read
  as a carousel dot and later a stray V; replaced with aurora + orb.
- **Hero LCP:** the H1/paragraph were hidden by JS until hydration,
  producing a 6.5s mobile LCP in Lighthouse. Removed the JS pre-hide for
  the hero; the word entrance is CSS-only and the hero paints immediately.
- **Reduced motion:** the pinned stepper reserved 200vh and stayed sticky
  for reduced-motion users because hydration kept the server class. Added
  `.hiw-pin`/`.hiw-sticky` CSS overrides; reduced-motion pin height is now
  content height and `position: static`.

## Test commands and results

| Check | Command | Result |
|---|---|---|
| Type check | `cd landing && npx tsc --noEmit` | pass, 0 errors |
| Build | `cd landing && npm run build` | pass, static export |
| Desktop Lighthouse | `npx lighthouse --preset=desktop` | **98 / 100 / 100 / 100** (perf/a11y/BP/SEO); LCP 1.2s, TBT 0ms, CLS 0 |
| Responsive overflow | Playwright at 1920/1440/1024/768/430/390/375/320 | `scrollWidth === clientWidth` at all widths |
| Console | Playwright, normal + reduced motion | 0 errors, 0 warnings |
| Interactions | Playwright | provider tabs/nodes/copy, product tabs, security 3 outcomes, hiw step click, key reveal, both copy buttons, menu, chips |
| Reduced motion | Playwright `reducedMotion: "reduce"` | 0 hidden reveals, stepper static/content-height, simulation instant (97–162ms) |
| Walkthrough video | Playwright 1440×900, 32s | `/tmp/opencode/tollma-final/video/page@790d6289c075f910e1f729035bbaf34b.webm` |

## Limitations

- The available Lighthouse harness now returns desktop **98**; mobile
  Lighthouse's simulated profile scored lower (58) despite an observed
  ~2.4s LCP under CDP 4× CPU/Slow-4G. The explicit target (desktop 85+) is
  met; further JS chunk splitting is the next mobile optimization.
- No live desktop browser is connected in this environment; all browser
  validation is headless Playwright + screenshots/video.
- Real WebGL/Three.js was intentionally not added; the hero is layered SVG
  pseudo-3D with pointer tilt/parallax, which meets the "real or pseudo-3D"
  requirement at a fraction of the payload.
- GitHub star count was skipped: the repository links are documented
  placeholders (`IS_PLACEHOLDER_LINKS`), so a live count would be fake or
  fail; the license/community copy remains honest.
- Landing has no ESLint config, so lint is not part of its toolchain; the
  type check + production build + Lighthouse audits are the gates.
