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
