# ToLLma Landing Page

Static marketing site for ToLLma — **"One Gateway For All Your AI Models &
Agents"**. Deployed to GitHub Pages. Fully static: no backend, no API
routes, no auth, no server runtime.

## Stack

| Tool | Pinned version | Why |
|---|---|---|
| `next` | 16.3.5 | Same major as `frontend/`; static export via `output: "export"` |
| `react` / `react-dom` | 19.2.8 | Matches `frontend/` |
| `framer-motion` | 12.43.0 | Scroll reveals, tab transitions (client-side only) |
| `lucide-react` | 1.45.0 | Icons (**note:** v1.x removed brand icons — the GitHub mark lives in `src/components/icons.tsx` as inline SVG) |
| `tailwindcss` / `@tailwindcss/postcss` | 4.3.3 | Same Tailwind v4 setup as `frontend/` |
| `typescript` | 5.9.3 | Type checking during `next build` |

> **Approach decision (a):** the npm registry was reachable (`npm ping`
> succeeded), so this is a Next.js static-export app rather than
> hand-written HTML. There is no `landing/` fallback to migrate — but if
> you ever need a zero-dependency version, each section component maps 1:1
> to a static HTML section and all animation is progressive enhancement.

## Develop

```bash
cd landing
npm install
npm run dev      # http://localhost:3000
```

## Build & preview the static export

```bash
cd landing
npm run build    # emits static files to landing/out/
npx serve out    # preview exactly what GitHub Pages will serve
```

`next.config.mjs` sets `output: "export"` and `trailingSlash: true`, so
every route becomes a portable `…/index.html` (e.g. `out/index.html`).
`images.unoptimized` is on because `next/image` optimization needs a
server — the page uses inline SVG/CSS visuals only, so nothing is lost.

## Deploy (GitHub Pages)

Workflow: `.github/workflows/deploy-pages.yml` — builds `landing/`,
uploads `landing/out/` via `upload-pages-artifact`, deploys via
`deploy-pages`. Triggers on pushes to `main` touching `landing/**`,
plus manual `workflow_dispatch`. Concurrency cancels superseded runs;
permissions are least-privilege (`contents: read`, `pages: write`,
`id-token: write`).

One-time setup: **Settings → Pages → Source → "GitHub Actions"**.

### `BASE_PATH`

Project Pages sites live under `<owner>.github.io/<repo>/`, so asset
paths need a prefix. The workflow sets
`BASE_PATH=/<repo-name>` automatically from the repository name.
If you deploy to a **user/org site** (`<org>.github.io`) or a **custom
domain** instead, override it to empty — e.g. set the workflow env to
`BASE_PATH: ""`:

```yaml
env:
  BASE_PATH: ""
```

## Link placeholders (important)

The public home of ToLLma does not exist yet, so **every outbound link
is a placeholder** under `https://github.com/TitanNatesan/tollma`, defined
once in `src/lib/site.ts`:

| Constant | Placeholder |
|---|---|
| `GITHUB_URL` | `https://github.com/TitanNatesan/tollma` |
| `DOCS_URL` | `https://github.com/TitanNatesan/tollma#readme` |
| `ROADMAP_URL` | `https://github.com/TitanNatesan/tollma#roadmap` |
| `COMMUNITY_URL` | `https://github.com/TitanNatesan/tollma/discussions` |
| `LICENSE_URL` | `https://github.com/TitanNatesan/tollma/blob/main/LICENSE` |
| `GET_STARTED_URL` | `https://github.com/TitanNatesan/tollma#quickstart` |

The footer states this explicitly. When the real org/repo exists, update
`src/lib/site.ts` only — no component changes needed.

## Sections (all 10)

1. **Hero** — headline, sub-copy, Get Started / GitHub / Docs buttons,
   animated User → ToLLma → Providers SVG (declarative SMIL
   `<animateMotion>`, no JS required)
2. **Problem** — 5 pain points + "ToLLma unifies everything" card
3. **Feature Grid** — 9 items
4. **Architecture** — interactive Route / Govern / Ground tabs
5. **Screenshots** — 5 CSS/SVG UI mockups (chat, providers, repository,
   analytics, gateway logs), each labeled *"UI mockup — illustrative"*
6. **Why ToLLma** — objective Open WebUI / LiteLLM / ToLLma category
   comparison with a scope disclaimer
7. **Roadmap** — Now / Next / Future, no dates
8. **Open Source** — Apache 2.0, community
9. **CTA** — Get Started + Docs
10. **Footer** — License / GitHub / Docs / Roadmap / Community links

## Brand

- Primary `#2563EB` · Secondary `#EAB308` · Accent `#10B981`
- Positioning: "The Open Source AI Gateway for Models and Agents"

## Constraints respected

- `landing/` is standalone: it does **not** import from or modify
  `backend/` or `frontend/`.
- No data fetching, no route handlers, no server actions, no cookies —
  everything unsupported under `output: "export"` (see Next docs on
  static exports) is avoided by construction.
