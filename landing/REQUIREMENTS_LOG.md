# REQUIREMENTS_LOG.md — landing requirements acceptance record

## R1 — Favicons with light/dark variants (2026-11-01)

Brand-mark mapping (decided from pixel data, NOT filenames):
- `src/components/sections/brand/tollma-mark-ink.png` (1024², transparent,
  opaque pixels avg luminance 0 = near-black mark) → dark-on-light mark →
  suits LIGHT UI → `favicon-{16x16,32x32}.png`, white-tile icons.
- `src/components/sections/brand/tollma-mark-white.png` (1024², transparent,
  opaque pixels avg luminance 255 = white mark, identical geometry: 680362
  opaque px each) → light-on-dark mark → suits DARK UI →
  `favicon-dark-{16x16,32x32}.png`.
- (`tollma-light-256.png` is an opaque tile for nav/footer surfaces, not used
  for icons. No `tollma-light/dark.png` files exist; SVG tile
  `public/brand/logo.svg` + route `src/app/icon.svg` kept as SVG fallback.)

Generated (PIL 12.3, LANCZOS, square sources resized — never stretched):
- `public/favicon-32x32.png` (668 B), `public/favicon-16x16.png` (391 B)
- `public/favicon-dark-32x32.png` (714 B), `public/favicon-dark-16x16.png` (410 B)
- `public/apple-touch-icon.png` (180², ink on opaque white, 1929 B)
- `public/icon-192.png` (1904 B), `public/icon-512.png` (3676 B, white tile)
- `public/favicon.ico` (16+32+48 multi-size, 1972 B)
- `public/manifest.webmanifest` (name/short_name, refs icon-192/512 `?v=2`)

Wiring (`src/app/layout.tsx`): `metadata.icons` with
`media: "(prefers-color-scheme: light|dark)"` (renders explicit
`<link rel="icon" … media="…">` per Next docs
`generate-metadata.md`), `shortcut: /favicon.ico?v=2`,
`apple: /apple-touch-icon.png?v=2`, `manifest: /manifest.webmanifest`.
Cache-bust `?v=2` on every icon href. No new deps; palette/typography untouched.

### Acceptance

- [x] PASS — marks inspected as images; mapping recorded above.
- [x] PASS — all 8 raster files + manifest in `public/`, exported to `out/`.
- [x] PASS — DOM contains 4 media-scoped icon links + svg + shortcut + apple + manifest.
- [x] PASS — `npx tsc --noEmit` clean, `npm run build` green.
- [x] PASS — served `out/` (py http 8931): all 10 icon/manifest URLs HTTP 200
  with correct content-type, zero 404s.
- [x] PASS — headless Chrome: zero `CONSOLE` (page) messages; only
  sandbox/dbus/NSS/GCM harness noise in stderr.
- [~] PARTIAL — 1440px screenshot captured (`/tmp/opencode/r1/landing-1440.png`,
  1440×2400); tab favicon itself not pixel-asserted (headless screenshot
  cannot show the browser chrome tab strip) — `<link media>` DOM tags verified instead.

Evidence: `/tmp/opencode/r1/landing-1440.png`, `/tmp/opencode/r1/console.log`,
`out/index.html` link tags.

## R2 — Center alignment: pill, headline, subcopy, CTA on one vertical axis (2026-11-01)

Change (`landing/src/components/sections/hero.tsx` only, copy/palette untouched):
- Hero copy wrapper (`driftRef` div) → `flex w-full flex-col items-center text-center`.
- Open-source pill → `mx-auto w-fit justify-center text-center`.
- `HeroHeadline` h1 → `w-full text-center` + explicit `textWrap: "balance"`
  (kept `text-balance` class + `max-w-4xl mx-auto`).
- Subcopy → `w-full text-center` (kept `max-w-2xl mx-auto`).
- CTA row → `w-full justify-center`. Transform/opacity-only motion kept;
  reduced-motion finals unchanged.

### Acceptance

- [x] PASS — `text-wrap: balance` on headline (computed `textWrap: balance`,
  `text-balance` class).
- [x] PASS — horizontal centers within 1px of viewport center at all widths
  (served `out/`, headless Chrome, `getBoundingClientRect` centers vs `innerWidth`):
  - 390px: pill/headline/subcopy/CTA cx=195.00, Δ=0 — PASS
  - 768px: cx=384.00, Δ=0 — PASS
  - 1440px: cx=720.00, Δ=0 — PASS
  - 1920px: cx=960.00, Δ=0 — PASS
- [x] PASS — `npx tsc --noEmit` clean, `npm run build` green.
- [x] PASS — zero console/page errors at all widths.

Evidence: `/tmp/opencode/r2r4/r2-390.png`, `/tmp/opencode/r2r4/r2-768.png`,
`/tmp/opencode/r2r4/r2-1440.png`, `/tmp/opencode/r2r4/r2-1920.png`.

## R3 — Remove equalizer row under hero CTA (2026-11-01)

Confirmed: `SKYLINE` in `landing/src/components/sections/hero.tsx` was the
equalizer — 28 black vertical bars (`span.sky-bar.bg-coal`, `h-16` flex row,
`scaleY` staggered entry + `0.3` scroll parallax) rendered directly under the
hero CTA via `<Skyline />`.

Change (`hero.tsx` only):
- Deleted `SKYLINE` const + `Skyline()` component (markup + `scaleY`/`stagger`
  JS + `useInViewOnce`/`Parallax` usage for that block) and the `<Skyline />`
  call site. Header comment updated to drop the skyline sentence.
- No import changes needed (`Parallax`, `useInViewOnce`, `animate`,
  `stagger`, `utils` all still used by backdrop/pills/headline/dashboard).
- Reflow: `DashboardCard` keeps its `mt-14` — normal section rhythm, no
  spacer left behind. Out-of-scope note: `get-started.tsx` has its own
  unrelated decorative band (no `sky-bar` classes); left untouched.

### Acceptance

- [x] PASS — no element with those classes/data attrs remains: `.sky-bar`
  count 0, `*skyline*`/`data-skyline` elements 0, `/sky-bar|SKYLINE|Skyline/i`
  in DOM HTML false — at 390/768/1440/1920 (served `out/`).
- [x] PASS — no gap larger than standard rhythm: CTA bottom → `#activity`
  top = 83px (390), 70px (768), 74px (1440/1920) — all within normal
  `mt-14` + card chrome rhythm (< 200px, > 0).
- [x] PASS — R2 centering retained: pill/headline/subcopy/CTA Δ=0 at all widths.
- [x] PASS — `npx tsc --noEmit` clean, `npm run build` green.
- [x] PASS — zero console/page errors at all widths.

Evidence: `/tmp/opencode/r2r4/r3-390.png`, `/tmp/opencode/r2r4/r3-768.png`,
`/tmp/opencode/r2r4/r3-1440.png`, `/tmp/opencode/r2r4/r3-1920.png`.

## R4 — Floating pills: glyph-free glassmorphism, no overlap (2026-11-01)

Change (`landing/src/components/sections/hero.tsx` only, copy/palette untouched):
- Removed `glyph` field from `Pill` type + all 6 `PILLS` entries
  (◆ U+25C8, ● U+25CF, ◆ U+25C6, ■ U+25A0, ≡ U+2261, ▲ U+25B2) and the
  badge `<span>` (`{p.glyph}`) from the chip render. Chip is now label-only
  with symmetric `px-4` padding (was `pl-1.5 pr-4` for the badge).
- Glassmorphic `.hero-chip`: translucent fill
  `color-mix(in srgb, var(--chip-bg) 38%, rgba(255,255,255,0.72))`,
  `backdrop-filter: blur(14px) saturate(160%)` (+ `-webkit-` prefix),
  1px highlight border `rgba(255,255,255,0.65)`, inner top highlight
  `inset 0 1px 0 rgba(255,255,255,0.7)`, soft shadow
  `0 12px 32px -12px rgba(23,25,20,0.25)`, full radius `999px`.
- `@supports not ((backdrop-filter: blur(14px)) or (-webkit-backdrop-filter: blur(14px)))`
  fallback to solid tint `color-mix(in srgb, var(--chip-bg) 72%, white)`.
- Kept faint bg shapes (`GHOSTS`, 6 blurred ghosts, markup untouched).
- Narrow fix: pills+ghosts visibility raised `min-[900px]:block` →
  `min-[1024px]:block` — at 900px `API keys` overlapped the subcopy;
  at ≥1024px all clear. Motion stays transform/opacity-only; reduced-motion
  finals unchanged.

### Acceptance

- [x] PASS — no glyph elements remain: `/[◆●◆■≡▲]/` in DOM HTML false,
  `.hero-chip *` child count 0, `glyph` occurrences in source 0.
- [x] PASS — glass active: computed `backdrop-filter: blur(14px) saturate(1.6)`,
  translucent bg (alpha 0.83), `border-radius: 999px`, `@supports` fallback
  rule present in stylesheets.
- [x] PASS — contrast text `text-coal` (#171914) vs worst-case chip-over-cream
  (#F7F7EE) fill: 14.45:1 (warm) – 16.27:1 (butter), all ≥ 4.5:1.
- [x] PASS — no overlap (chip boxes vs headline/subcopy/CTA boxes) at every
  tested width (served `out/`, headless Chrome): 390/768/900 hidden (0 chips,
  0 collisions), 1024/1100/1280/1440/1920 visible (6 chips, 0 collisions).
- [x] PASS — R2 centering retained: pill/headline/subcopy/CTA Δ=0 at all widths.
- [x] PASS — `npx tsc --noEmit` clean, `npm run build` green.
- [x] PASS — zero console/page errors at all widths.

Evidence: `/tmp/opencode/r2r4/r4-390.png`, `/tmp/opencode/r2r4/r4-768.png`,
`/tmp/opencode/r2r4/r4-1440.png`, `/tmp/opencode/r2r4/r4-1920.png`
(plus `/tmp/opencode/r2r4/r3-*.png` for the R3 baseline).

## R6 — In-card detail expansion, tile-free stroke icons (2026-11-01)

Change (`landing/src/components/sections/what-we-do.tsx` only, copy/palette untouched):
- Removed 40px gradient `.pillar-tile`; new `.pillar-icon` is a transparent
  24×24 container (`background: transparent`, ink `var(--color-coal)`) holding
  a 24×24 single-weight (1.7) stroke svg. Same three glyph paths, no new claims.
- Detail moved from a shared below-grid panel into each card (`CardDetail`
  inside `article.pillar`, unique ids `wwd-detail-secure/govern/observe`).
  Toggle is the title `button` (native click/Enter/Space) with `aria-expanded`
  + per-card `aria-controls`; `setOpen(open === i ? null : i)` keeps single-open
  with click-open-to-close. Closed detail collapses to 0px (`inert` when shut).
- Detail reuses on-page copy verbatim: uppercase label (SECURE/GOVERN/OBSERVE),
  the two existing `detail` sentences, existing link + `→` (Govern:
  "See guardrails on GitHub →", `GITHUB_URL` from `site.ts`).
- `+`/`−` caret replaced by a 12px chevron svg rotating 180° when
  `aria-expanded="true"`.
- Expansion is CSS-only (`grid-template-rows` 0fr→1fr + opacity, 320ms
  ease-out; `transition: none` under `prefers-reduced-motion`); removed the old
  JS `animate` mount tween and the shared `wwd-detail` panel. Grid/dividers/
  alignment/typography untouched.

### Acceptance

- [x] PASS — icon container computed `backgroundColor: rgba(0, 0, 0, 0)`,
  ink `rgb(23, 25, 20)`, svg 24×24; no `.pillar-tile`/`.pillar-caret` remains.
- [x] PASS — detail renders inside its card DOM (all 3 cards), closed height 0,
  open ≈194–220px; Govern text starts `GOVERN / Every request passes 10
  guardrail categories…`, link `See guardrails on GitHub →`.
- [x] PASS — column x-positions at 1440 within 1px of pre-change build:
  before [96.7969, 512.2656, 927.7344] → after [96.7969, 512.2656, 927.7344]
  (Δ ≤ 0.0001px), identical with a card open.
- [x] PASS — chevron `transform: none` → `matrix(-1, 0, 0, -1, 0, 0)` on open;
  `aria-expanded` toggles true/false; re-click closes; keyboard Enter and Space
  both open; opening a second card closes the first (single-open).
- [x] PASS — reduced-motion: `transition: none` on detail + chevron
  (duration serializes 1e-06s ≈ 0, incl. a bare `transition:none` probe —
  headless-Chrome zero serialization), `transition-property: none`,
  `matchMedia reduce: True`; detail still opens instantly.
- [x] PASS — `npx tsc --noEmit` clean, `npm run build` green, zero
  console/page errors at 390 + 1440.

Evidence: `/tmp/opencode/r6/r6-closed-{1440,390}.png`,
`/tmp/opencode/r6/r6-open-{secure,govern,observe}-{1440,390}.png`
(8 screenshots), `before-1440.png` baseline.

## R7 — Pinned outcomes heading + 4-card carousel (2026-11-01)

Change (`landing/src/components/sections/outcomes.tsx` only, copy/palette untouched):
- New exported `OUTCOME_STATS` (4 entries, ordered): `1 / One Proxy`
  (verified, keeps existing quote + attr verbatim), `200+ / API Providers`
  (`verified:false`), `9000+ / Models` (`verified:false`), `∞ / Endless
  Integrations` (symbol, no count-up). Slides 2–4 carry
  `/* DRAFT copy — unverified */` quotes in the same voice
  (provider-shape swap / switch-by-name / wire-once lines) with
  `ToLLma · Providers/Models/Integrations` attributions.
- Eyebrow ("Outcomes") + h2 ("One gateway. Every model. Fully governed.")
  moved inside the md+ sticky viewport via shared `OutcomeHeading` — pinned
  (ScrollTrigger-pin equivalent in CSS `sticky`, no new JS) the whole time
  cards show, released when the ~350vh region ends. Mobile keeps a static
  stacked list (pin would trap touch scroll); reduced-motion/no-JS keeps the
  single static card. Pin choice: CSS sticky reuses the file's existing
  scroll-stage convention — ScrollTrigger JS pin skipped, add only if a
  scrubbed pin is ever needed.
- Scroll driver thresholds thirds → quarters; `REGION_VH` 250 → 350;
  `CARD_SPEEDS` gains a 4th entry; progress ticks derive from
  `OUTCOME_STATS` (now 4 steps); ← → arrows unchanged (wrap-around).
  Removed dead `ticks` text field (never rendered). Mini-visuals remapped
  (0/3 pulse, 1 provider dots, 2 generic ticks — all `aria-hidden`, not
  counts). `CountStat` gains `suffix` ("+"); ∞ renders static.
- Subtle `DraftNote` ("Draft figures — 200+ providers and 9000+ models are
  placeholders pending verification.", `text-xs text-coal/45`) under the
  card in all branches so the draft figures never read as verified facts.
  `site.ts` untouched (verified-facts-only file must not hold draft figures).

### Draft copy (unverified — do not quote as fact)

- Card 2 (200+ API Providers): "Every provider behind one
  OpenAI-compatible shape — swap APIs without rewriting calls."
- Card 3 (9000+ Models): "Every model behind the same gateway — switch by
  name, never by SDK."
- Card 4 (Endless Integrations): "Wire agents, tools, and pipelines once —
  every integration speaks the same protocol."

### Flagged stats (unverified)

- `200+` providers — `verified:false` in `OUTCOME_STATS`.
- `9000+` models — `verified:false` in `OUTCOME_STATS`.

### Acceptance

- [x] PASS — heading pinned at section start/q1/q2/q3/end (1440, h2 rect
  inside viewport every sample; still pinned on last card).
- [x] PASS — card order at 1440 + 390: One Proxy → API Providers → Models →
  Endless Integrations; stats settle to `1`, `200+`, `9000+`, `∞`.
- [x] PASS — ← → arrows wrap both directions; 4 progress ticks, active tick
  tracks `Slide N of 4` live region.
- [x] PASS — count-up runs once per activation at ≥50% visibility
  (mid-flight samples `8987+`/`8323+` → settle `9000+`; ∞ static;
  reduced-motion renders finals).
- [x] PASS — `npx tsc --noEmit` clean, `npm run build` green; vitest N/A
  (no runner configured in landing).
- [x] PASS — zero page/console errors at 390 + 1440.

Evidence: `/tmp/opencode/r7/r7-pin-{start,q1,q2,q3,end}-1440.png`,
`/tmp/opencode/r7/r7-card{0..3}-{1440,390}.png` (13 screenshots).

## R8 — Dividers: no parallax, next-field + prev-teeth, 2px overlap, no hairlines (2026-11-01)

Change (4 files, copy/palette untouched):
- `src/components/sections/pixel-wipe.tsx`: deleted ALL parallax (per-block
  `depth` drift `translateY`, cursor-proximity `lift`, `pointermove/leave`
  listeners) and the `flip`/`band`/`cssDriven` props. Driver is now entry-only
  `scaleY` (bottom origin, left→right stagger, rAF scroll/resize) —
  transform-only; reduced-motion/no-JS render the full static pattern
  (no inline transforms). New overlap model: root `relative z-10 -mb-[2px]`
  sits 2px ON TOP of the next section (next bg extends underneath the teeth);
  teeth `band` = NEXT-section field, `block` = PREV-section color
  (new optional `block` prop; D1 decorative night-on-cream unchanged).
  Slots overlap 1px horizontally (`marginLeft: -1`, `gap-0`, track
  `w-[calc(100%+1px)]`) — no subpixel seams.
- `src/app/page.tsx`: D1 `tone="dark"` (unchanged); D2 `tone="light"
  block="bg-sage"` (sage teeth on night field); D3 `tone="dark"` (was light
  flip cssDriven); D4 `tone="light"` (was dark); D5 `tone="dark"` (was light).
- `src/app/globals.css`: deleted the `.wipe-css` view-timeline rules +
  `platform-exit-cover/lift` keyframes (scroll-linked translate — parallax by
  another name; the rAF driver is now the single owner). `.wipe-col` kept.
- `src/components/sections/marquee.tsx`: `border-y` → `border-b` (top hairline
  touched divider D1; bottom edge kept).

### Acceptance

- [x] PASS — `npx tsc --noEmit` clean, `npm run build` green (static `out/`).
- [x] PASS — 50 scroll positions × 5 boundaries × 2 widths (390/1440, served
  `out/`): no scanned row >90% uniform in an unexpected color (no
  previous-section band row, no 1px hairline); mechanics asserted per divider:
  `margin-bottom: -2px`, `z-index: 10`, 2.0px overlap, `animation-name: none`.
- [x] PASS — no parallax: every block computed transform is `none` or
  `matrix(1,0,0,sy,0,0)` at all 500 positions (translate components ≡ 0);
  `scaleY` spans 0.00→1.00 per divider (entry preserved, nothing else moves).
- [x] PASS — reduced-motion: all 70 blocks inline-transform-free and visible
  at 390 + 1440 (finals).
- [x] PASS — zero page/console errors at 390 + 1440.

Evidence: `/tmp/opencode/r8/b{1..5}-{390,1440}.png` (10 boundary shots),
`/tmp/opencode/r8/result2.log` (ALL PASS), `validate.py` + `shots.py`.

## R10 — Per-provider spotlight colors (2026-11-01)

Change (3 files, copy/palette/layout untouched):
- `src/components/sections/solutions.tsx`: new `SPOT` map
  (openai `#10A37F`, anthropic `#D97757`, gemini `#4285F4`,
  vertex `#1A73E8`, bedrock `#FF9900`, fallback/catch-all `#2563EB`)
  passed as `--spot` inline style (static per mount) to each
  `SpotlightCard`. Catch-all CTA anchor wrapped in a `SpotlightCard`
  (`--spot: #2563EB`) inside the existing `Parallax` so it gets the
  same cursor glow (its hover fill + dashed border kept as-is).
- `src/components/ui/spotlight-card.tsx`: new optional `style` prop,
  passed straight to the wrapper div (no re-render change — visuals
  stay in CSS pseudo-elements; hero usages get no `style`, so their
  glow falls back to `--color-brand` unchanged).
- `src/app/globals.css`: `.spotlight::after` glow now reads
  `color-mix(in srgb, var(--spot, var(--color-brand)) 20%, transparent)`
  (20% ∈ required 18–22%); added `.spotlight:focus-within::after`
  so keyboard/touch focus shows the same spotlight as hover
  (cursor-less focus renders centered via the existing
  `var(--mx, 50%) var(--my, 50%)` defaults). Unrelated `.cta-glow`
  left at its original brand-12% (a blanket replace briefly touched
  it and was reverted).

### Acceptance

- [x] PASS — each card sets its own `--spot` (computed values match
  the six hex codes above exactly).
- [x] PASS — hover pixel under cursor matches the 20%-alpha blend of
  the card's color over its hover bg within tolerance 48 (actual
  max delta 1; providers blend over white, catch-all over coal):
  openai (208,237,230), anthropic (247,228,222), gemini (218,231,253),
  vertex (210,228,251), bedrock (255,235,205), catch-all (25,39,62);
  glow visibly lifts pixel off the plain bg (lift 43–56).
- [x] PASS — focus (no hover) drives `::after` opacity to 1 on all 6
  cards (touch/keyboard path).
- [x] PASS — primary text contrast over the spotlight blend ≥ 4.5:1
  everywhere: 14.25 / 14.42 / 14.17 / 13.56 / 15.19 (coal on provider
  blends), 13.74 (cream on catch-all blend).
- [x] PASS — `npx tsc --noEmit` clean, `npm run build` green
  (static `out/`), zero page/console errors.
- [~] PARTIAL — secondary `text-coal/55` api line is 3.97:1 on plain
  white / 3.76:1 on the strongest (bedrock) wash: below 4.5:1
  independent of R10 (pre-existing type treatment, spotlight delta
  only 0.21). Primary text (name + Explore + CTA copy) passes;
  retyping the secondary line is out of scope.

Evidence: `/tmp/opencode/r10/r10-{openai,anthropic,gemini,vertex,bedrock,catch-all}-{hover,focus}.png`
(12 screenshots), `/tmp/opencode/r10/validate.py` (32 checks ALL PASS).

## R11 — Giant footer wordmark with scroll parallax (2026-11-01)

Change (2 files, copy/palette/layout untouched):
- `src/components/sections/closing.tsx`: new `foot-wordmark-clip` block
  between the link grid and the copyright bar — `aria-hidden` decorative
  duplicate of the logo wordmark (`ToLLma`, sans extrabold 800,
  `letter-spacing -0.045em`, `line-height 0.84`, centered). New page-local
  `useWordmarkRise` hook (not the shared `<Parallax>`: that wrapper
  self-measures its own transformed rect, which converges only asymptotically
  and returns ±2px off after a scroll cycle; measuring the untransformed
  clip parent makes the offset a pure function of scroll position).
  Negative speed (-0.5) rises from below the footer edge as the footer
  scrolls in; rAF-throttled scroll/resize listeners, transform cleared on
  cleanup, inert under `prefers-reduced-motion` (static wordmark stays
  visible). No new deps.
- `src/app/globals.css`: `.foot-wordmark-{clip,drift,wordmark}` —
  `overflow: hidden` clip (cuts the wordmark at the footer bottom),
  `font-size: clamp(5.5rem, 23vw, 20rem)` so the glyph line spans almost the
  full container at every width. Transform-only; no `outline: none` anywhere
  (global `:focus-visible` 2px ring kept on all footer links).

### Acceptance

- [x] PASS — glyph width / container content width ≥ 90% at all widths
  (served `out/`, headless Chrome, Range rect vs container content box):
  390px 92.1% (322/350), 768px 90.8% (635/699), 1440px 92.3% (1150/1246),
  1920px 93.4% (1150/1232).
- [x] PASS — no h-overflow: `documentElement.scrollWidth == innerWidth`
  at all 4 widths; clip `overflow: hidden`.
- [x] PASS — offset changes with scroll + exactly reverses: −400px scroll
  moves the drift +17–20px (rises from below), scrolling back to the same
  `scrollY` restores the bit-identical matrix; transform equals the
  closed-form function of the live clip rect to the centipixel at every
  sample (`pureFn: true`), so reversal holds by construction, not tolerance.
- [x] PASS — focus rings visible: programmatic focus on a footer link shows
  computed `outline: 2px solid` (global `:focus-visible` rule untouched);
  focus screenshots captured at all 4 widths.
- [x] PASS — reduced-motion: drift transform stays `none` across scroll,
  wordmark fully visible (static composition, no-JS likewise shows finals).
- [x] PASS — `npx tsc --noEmit` clean, `npm run build` green (static `out/`),
  zero page/console errors at all widths. Vitest N/A — no runner or test
  files configured in `landing/` (consistent with R7/R10 records).

Evidence: `/tmp/opencode/r11/r11-{390,768,1440,1920}.png`,
`/tmp/opencode/r11/r11-{390,768,1440,1920}-focus.png`, `validate{,2..8}.py`,
`dbg{,2..4}.py` (parallax self-measurement feedback diagnosis).

## R5 — Six-window scroll-stacked dashboard from one seeded dataset (2026-11-01)

Change (3 files, no new deps, copy/palette untouched):
- NEW `src/data/dashboard.ts`: single seeded dataset — 28 `REQUEST_LOGS`
  rows (openai 8, anthropic 6, gemini 4, bedrock 4, vertex 3, custom 3;
  Allowed 19, Warned 2, Blocked 3, Pending 1, Throttled 1, 401 1, 403 1),
  3 API keys (`tlm_live_••••3a9c/7f2e/b811`, global/per-key, limits
  0.50/0.25/0.05), guardrail modes/scopes per category. All KPIs, provider
  rows (p50 median, error = Blocked/Throttled/401/403, >5% → Degraded),
  key budgets, guardrail hits, spend/tokens/daily-cost/throughput/top/
  recent-blocked are pure derivations of `REQUEST_LOGS`. Surfaces +
  categories trace to `site.ts` (imported, never redeclared).
  `node scripts/reconcile-dashboard.mjs` (Node 24 type-stripping, tmp-copy
  for the extensionless `../lib/site` import) recomputes every number
  independently — 50/50 PASS.
- NEW `src/components/sections/dashboard-stack.tsx`: one ~620vh region
  with a sticky h-screen stage; scroll progress v is the only driver
  (pure function → scroll-up reverses exactly). Overview pins at center;
  each following window slides up 110vh→0 landing opaque on top;
  covered windows scale 0.96 + 22% night-veil (transform/opacity only);
  hold on Analytics for v in [0.86, 1]. Per-window chrome (traffic
  lights, `ToLLma — <Page>`, 6-item sidebar with `aria-current` on the
  top page, sample-data pill) + `data-allow-overlap` on every window
  (intentional stacking) and `data-active-page`/`data-progress` on the
  region. Reduced-motion/no-JS renders all six statically stacked.
- `src/components/sections/hero.tsx`: `DashboardCard` replaced by
  `<DashboardStack />` (tilt/flatten/StatusFlip removed with the single
  window). Pills layer constrained to the top 100vh and faded out by
  0.45vh of scroll (opacity-only, motion-safe) so chips never sit on the
  pinned windows. Section `overflow-hidden` → `overflow-x-clip` (any
  non-visible/non-clip overflow ancestor traps `position: sticky`; x-clip
  clips horizontal parallax spill without creating a scroll container —
  same reason outcomes keeps its clip off the section).

### Acceptance

- [x] PASS — 6 windows in spec order, each `data-page` top-state reached
  in scroll order; reverse 20-point sweep bit-identical (transform +
  visibility + active) at 1440 and 390; `data-active-page` matches the
  top window and its sidebar `aria-current` at all 6 top-states.
- [x] PASS — `node scripts/reconcile-dashboard.mjs`: 50/50 (KPIs,
  per-provider req/p50/error, per-key used<limit, 10 guardrail hits,
  spend/daily/tokens/throughput/top-provider sums, 7 status kinds).
- [x] PASS — no page-level h-scroll at 390/1440 (overflow 0); wide tables
  scroll inside their container (4 `overflow-x-auto` blocks, content wider
  than viewport at 390); 390 log rows wrap, nothing clipped.
- [x] PASS — R4 retained: 6 glass chips, no headline overlap at 1440,
  hidden below 1024px (fades are post-load scroll behavior only).
- [x] PASS — `npx tsc --noEmit` clean, `npm run build` green (static
  `out/`); zero console/page errors at both widths; reduced-motion shows
  all six windows statically. Vitest N/A (no runner in landing).
- [~] PARTIAL — 5/6 providers read Degraded (>5% error rule on a sample
  deliberately packed with denials): honest per the documented rule, kept.

Evidence: `/tmp/opencode/r5/` (12 top-state screenshots 1440+390,
`validate.py` ALL PASS), `scripts/reconcile-dashboard.mjs`.

### R5 follow-ups (2026-11-01, commits `c6f87ff`, `30af024`, `9abfc56`)
- Fixed windows: uniform `70rem×600px` desktop / full-width `740px`
  mobile, zero internal scroll (logs show latest 9 of 28 + count line;
  columns hide gracefully on narrow screens instead of x-scrolling).
- Single top-window shadow (covered windows drop theirs — shadows can no
  longer pool darker); smoothstep rise, depth sink (−12px/level,
  0.975→0.95) + graded veil; `Degraded` pill amber instead of red.
- Region 620→300vh so each window arrives faster and the slide reads;
  stage top-aligned, hero gap CTA→window ≈56px.
- Root-cause fix `9abfc56`: `transform` was in the React style prop, so
  every `setActive` commit reset the inline motion and windows popped
  instead of sliding. Centering moved to Tailwind classes; the paint
  loop fully owns `el.style.transform`. Verified mid-transition:
  incoming at partial `translate3d`/full `scale(1)` over covered at
  `scale(0.95–0.975)` + sink, reversing exactly on scroll-up.
- Re-ran reconcile after all changes: still all PASS
  (`/tmp/opencode/slide/` mid-transition screenshots desktop+mobile).

## R9 — Scripted camera over the how-it-works diagram (2026-11-02)

Change (`landing/src/components/sections/platform.tsx` only; diagram content,
labels, toggle, stepper, copy, palette untouched):

- Five-phase scrubbed timeline on the existing ~600vh pin
  (`PH = A .05 / B .30 / C .78 / D .93`): A entry — full diagram fades+scales
  .92→1 once, then holds; B first pass — all layers full emphasis, packets
  make one pass; C layer steps 01→08 — equal eighths, camera zooms to each
  layer's bbox, others dim to .35, in/out connectors highlight; D second
  pass — full emphasis, packets again; E exit — scales to .9 + fades to 0.
  `stageAt`/`activeAt`/`camAt` are pure functions of progress → scroll-up
  reverses exactly (20/20 round-trip identical).
- Camera = one transform on a single inner `<g data-camera>` (existing SVG,
  transform/opacity only, vector). Keyframes computed from `layoutNodes`
  bboxes — never hand-typed: `s = 0.65·min(Vw/rw, Vh/rh)` so the layer fills
  65% of the diagram frame; smoothstep blends between adjacent states.
  L05+injection unions the blocked badge so the coral branch stays in frame.
- Phase C emphasis: active layer opacity 1, rest .35; connector highlight via
  bbox-adjacency sets (endpoint within 10u of the layer bbox, computed);
  non-adjacent dim to .12. Lead packet parks at the active layer's input
  (hidden where injection blocks downstream); B/D follow the toggle
  (injection parks the lead at the L05 exit, downstream dimmed, coral lit).
- Pass routes redefined as continuous visual passes over EXISTING connector
  names (`PASS_WIDE`/`PASS_TALL`; the old list referenced non-existent
  `fan-0`/`route-fan0`, leaving the lead hidden mid-pass).
- `jumpTo` rail clicks now target the absolute pin range from the ScrollTrigger
  instance (was `wrap.offsetTop + frac·wrapHeight`, landing at wrong
  progress); rail driver fixed `scaleY`→`scaleX` (bar never filled).
- `setPkt` resets hidden packets to a canonical transform-less state, so the
  hidden reading is identical down and back up.
- Static contexts (tall / reduced-motion / unpinned): full diagram, camera
  identity, no fades; stepper clicks highlight + scrollIntoView (reduced-motion
  renders finals, zero camera/fade writes).
- Text: all SVG text ≥12u (11s→12, 10s→12, wide title 15→16), halo pills
  widened to fit (`7.2→7.8` factor, 24px tall), legend + stepper numbers to
  12px; FAN-OUT pill nudged `lx 900→890` (clears the return corridor at 12px);
  tall WORKSPACE TAP `lx 560→545` (stays inside the viewBox); lane frames
  moved INSIDE the camera group (they are diagram, not backdrop).
- Test hooks only: `data-camera`, `data-lbl`, `data-ledger`, `data-captures`.
  Verified zero zoom/pan/fit controls in DOM (10 clickables: toggle×2 +
  steppers×8; Explore link 11th tab stop).
- `data-allow-overlap` marks the four packet groups (they ride wires / park
  on the layer input edge by design). No node/pill pair overlaps, so nothing
  else needed the mark; the uniform camera transform introduces no new
  geometric overlaps by construction.

### Acceptance

- [x] PASS — entry `svgOp 0.4` mid-fade w/ scale .952; full pass all 8 layers
  `1`; exit `svgOp 0` at p=1 (`r9-entry/fullpass/exit.png`).
- [x] PASS — each C step spotlights exactly its layer (7 others at .35) with
  matching step label (`r9-step1..8.png`, S4.1–8).
- [x] PASS — camera fill exactly 65.0% of diagram height on all 8 steps, safe
  + injection L05 (union keeps badge in frame, coral=1, badge=1).
- [x] PASS — Safe↔Injection toggle: coral 0.15→1→0.12, aria-pressed flips,
  lead parks at L05 exit in passes / layer input in C.
- [x] PASS — scroll round-trip 20/20 exact (camera/stage/4 packets/rail/step/
  8 layers); entry rises 0→1, exit falls →0, rail monotonic.
- [x] PASS — pin spacer 6300 vs wrap 900 (~600%+viewport, `+=600%` intact);
  camera takes 14 distinct states across the pin.
- [x] PASS — node/pill pairwise 27 boxes wide + 26 tall, 0 overlaps; toggle
  and stepper rects disjoint from svg at full + zoomed (active layer fully
  inside svg viewport).
- [x] PASS — stepper clicks land on stages (observe@11859 step 08, register@
  9591 step 01); 10/10 clickables expected, zero extras.
- [x] PASS — keyboard tab-through 11/11 in order (Safe → Injection → 01..08
  → Explore), zero traps.
- [x] PASS — contrast 5.73–16.94 (AA) on all full-emphasis text/chrome.
- [x] PASS — no h-scroll at 390/768/1440/1920 (top + bottom); 400% zoom
  (360 CSS px) no h-scroll, svg 305px.
- [x] PASS — zero console errors; zero own warnings (2 external font-preload
  warnings, pre-existing per R8/V009, out of scope).
- [x] PASS — in-page selftest T1–T6 all PASS (endpoints worst 0.00px/28
  paths, packet-on-path 1066/0, no overlap, vocabulary clean).
- [x] PASS — reduced-motion: static full diagram, camera identity, all layers
  1, stepper click sets aria-current + description; 390 tall identical across
  p=0.02/0.55/0.97.
- [x] PASS — DPR3 vector-crisp: 72% of transitions carry a steep ≥60-grey
  step; sample text edges 73/74 grey levels over 3 device px.
- [x] PASS — `npx tsc --noEmit` clean, `npm run build` green at every step.
- [~] PARTIAL — full-overview micro-labels (12u) render ~9–11px CSS at 1440:
  geometrically infeasible to do otherwise (proof in VALIDATION_LOG) — an
  8-layer 1600u diagram at 1246 CSS px gives 137px per 29-char label.
  Mitigations shipped: titles render ≥12.5px, every zoomed step renders
  ≥50px, everything is vector (400% zoom + DPR3 verified crisp). Authored
  sizes ≥12u everywhere (measurement-verified).

Evidence: `/tmp/opencode/r9/` (20 PNGs: entry/fullpass/steps×8/pass2/
exitfade/exit/step5-injection/reduced + 390 full/inj/reduced + dpr3 + 400%),
`states.json`, `suite{1..5}.log`.
