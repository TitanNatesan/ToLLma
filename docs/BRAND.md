# ToLLma Brand Guide

> The Open Source AI Gateway for Models and Agents.

## Name and Meaning

- **ToLLma** — "Toll to your Large Language Models & Agents": the metered gateway through which all model and (future) agent usage passes.
- Always write **ToLLma** (capital T, capital LL, lowercase ma). Never "Tollma", "TOLLMA", or "tollma" in prose. The Python package stays `tollms` for technical reasons — that is not the brand spelling.
- Positioning line (use verbatim): **The Open Source AI Gateway for Models and Agents**.
- Never describe ToLLma as a ChatGPT clone, an OpenAI wrapper, or an OpenWebUI clone. Emphasize provider management, unified gateway, model intelligence, usage tracking, and future agent support.

## Tagline

Primary: **Toll to your Large Language Models & Agents.**

## Colors

| Role | Hex | Usage |
|---|---|---|
| Primary | `#2563EB` | Brand actions, links, primary buttons |
| Secondary | `#EAB308` | Highlights, warnings, secondary accents |
| Accent | `#10B981` | Success, live/healthy states, cost figures |
| Neutrals | zinc scale (light/dark themes) | Surfaces, text, borders |

Rules: white text on Primary 600+ passes contrast; red/amber keep their semantic meaning (errors, pending deletion); never use green/red as the sole signal — pair with icons or labels.

## Typography

- **Sans**: Space Grotesk (geometric, non-cursive) for UI and headings.
- **Mono**: JetBrains Mono for code, model ids, key prefixes, and badges.
- Never use cursive or decorative fonts in product surfaces.

## Logo Rules

- The logo is a stylized **"T" square badge** + "ToLLma" wordmark (see the `Logo` component).
- Keep clear space around the logo equal to the badge's cap height; never stretch, recolor outside the palette, add shadows beyond the theme default, or place on low-contrast backgrounds.
- The favicon and app icon derive from the same "T" badge.

## Spacing and Layout

- Base unit 4px; section rhythm `gap-4`, card padding `p-4`/`p-6`.
- Chat reading column: max ~960px centered; admin/analytics use full-width section layouts.
- Dark-first design: every surface must be reviewed in both themes before merge.
