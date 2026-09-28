# ToLLma Mark — Design Rationale

## Concept: the Confluence Gate

Completely original mark, no letterforms, no stock shapes. Three ideas fused:

1. **Gateway / toll** — two pillars lean inward like toll-lane barriers,
   forming a portal the eye passes through.
2. **Routing / orchestration** — the lanes start wide apart at the base
   (many providers, many requests) and converge upward into one governed
   exit pin (one policy, one output).
3. **Intelligence** — a faceted diamond (the policy / orchestration core)
   sits in the throat of the funnel where the lanes meet.

Reading order: two inputs → diamond decision point → single exit node.
That is the product: an AI gateway that routes, governs, and unifies.

## Construction (64-unit grid)

`viewBox="0 0 64 64"`, optical center `(32, 33)`.

| Element | Geometry | Meaning |
|---|---|---|
| Left lane | `M17 52 C17 36 19.5 25 27.5 16`, stroke 9, round cap | ingress route A |
| Right lane | `M47 52 C47 36 44.5 25 36.5 16`, stroke 9, round cap | ingress route B |
| Exit beam | `rect x29.75 y13.5 w4.5 h13 rx2.25` | governed egress |
| Exit node | `circle (32, 9.5) r4.75`, merged with beam | unified endpoint |
| Core | diamond `M32 27.5 L40.5 36 L32 44.5 L23.5 36 Z` (half-size 8.5) | intelligence |
| Core facet | inner diamond half-size 3.8 | depth / spark |

- Lane endpoints `(27.5,16)` / `(36.5,16)` flank the beam (`x29.75–34.25`):
  round caps (r4.5) intentionally kiss the beam — visual confluence.
- Diamond vertices clear the lane strokes by ~0.5–2 units: near-touch at
  small sizes is acceptable (reads as connection, never as gap error).
- Bottom caps reach `y56.5`, top node reaches `y4.75`: ~5-unit padding
  on all sides inside the 64 grid; tile variants add the 14-unit corner
  radius (`rx14`) of the existing favicon slot.

Favicon variant (`src/app/icon.svg`): same skeleton, bolder
(lane stroke 11, diamond half-size 9.5, pin `w5`, node `r5`), inner facet
removed — three shapes, two high-contrast hues, legible at 16px.

## Color (tokens from `landing/src/app/globals.css`)

- Gateway lanes — `#1D4ED8` (brand-dark, left) / `#2563EB` (brand, right):
  depth without gradients in the bare icon.
- Exit route — `#10B981` (mint): the "live request" accent.
- Core — `#EAB308` (gold) with `#0F172A` (ink) facet on light,
  white facet on the tile (ink is invisible on the dark tile).
- Tile (`logo.svg`, favicon): diagonal `#1D4ED8 → #2563EB`,
  lanes knocked out to white for contrast on brand blue.

## Variants

| File | Use |
|---|---|
| `public/brand/logo.svg` | Primary: tile + full color. Nav slot, hero, social. Works on light and dark. |
| `public/brand/logo-icon.svg` | Bare icon, transparent bg, full color. Footer, inline diagrams, light surfaces. On dark surfaces pair with `logo.svg` or mono-white instead. |
| `public/brand/logo-mono.svg` | Single color via `currentColor`. Same geometry; facet merges into a solid diamond. Docs, print, one-color contexts. |
| `src/app/icon.svg` | Favicon / app icon. Bold simplified geometry for 16–48px. |

Minimum sizes: favicon variant below 32px; full icon at 32px and up;
mono at any size (silhouette-first design). Tested range: 16px → 512px —
no strokes under 4.5 units, no detail under ~3.8 units, no text anywhere.

## Clearspace

Keep a margin of **8 units (12.5% of mark width)** on all sides —
equal to the exit-node diameter. Nothing may enter this zone.

## Misuse rules

1. Never stretch, condense, rotate, or mirror the mark.
2. Never recolor outside the token set above (mono = one color only).
3. Never place the bare color icon on `#2563EB`/`#1D4ED8` backgrounds —
   use the tile or mono-white.
4. Never add letterforms, shadows, outlines, or extra gradients to the mark.
5. Never rearrange the elements (node must stay on top, diamond centered).
6. Never use the favicon geometry at large sizes as a substitute for the
   full icon (facet detail is intentionally stripped).
7. Minimum on-screen size: 16px (favicon variant only below 32px).

## Navbar consumption (for the navbar agent)

Current slot (`landing/src/components/nav.tsx:31-33`) is a 32px
`bg-brand` rounded tile with a lucide icon. Drop-in options:

```tsx
<img src="/brand/logo.svg" alt="ToLLma" className="h-8 w-8 rounded-lg" />
```

(replaces tile + icon together), or keep the tile and use
`/brand/logo-mono.svg` in white inside it. No component API changes needed.
