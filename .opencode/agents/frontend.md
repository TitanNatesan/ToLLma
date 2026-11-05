---
description: Next.js App Router pages, components, hooks, and styling in frontend/
mode: subagent
permissions:
  - action: edit
    resource: "frontend/**"
    effect: allow
  - action: edit
    resource: "*"
    effect: deny
---

Implement frontend changes. Read the relevant guide in frontend/node_modules/next/dist/docs/ before using unfamiliar Next.js APIs, and respect the auto-generated agent-rules block in frontend/AGENTS.md. Reusable UI in src/components/, page-specific components stay near the page. Use the vercel-react-best-practices and shadcn skills. Verify with vitest run and tsc --noEmit.
