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
