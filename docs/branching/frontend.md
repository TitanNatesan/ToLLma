# Branching Conversations — Frontend Report

## Request version navigation
- User messages with siblings show a compact `1 / N` selector
  (`request-version-nav-{id}`, `request-prev/next/page`), mirroring the
  response pager styling, placed after the message content. Switching calls
  `POST .../select` → `refreshAll` (path+tree+conversation+usage); composer
  draft preserved; streaming hides version actions.

## Response version navigation
- The existing runs-level pager (`generation-nav-{id}`, `Response N of M`,
  `generation-prev/next/page`) is kept byte-identical for old backends; when
  the tree reports same-parent siblings it drives the SAME testids, so one
  control serves both grains and existing e2e keeps passing. Failed/cancelled
  siblings stay selectable with the existing failure banner + retry.

## Branch restoration / main rendering
- Chat renders the ACTIVE PATH only: `pathData?.path ?? conversation.messages`
  (never blank on 404 — graceful while backend lands). Only rendered-path
  messages get edit/regenerate/branch handlers, so new sends, edits, and
  regens always route to the active leaf and never attach to inactive
  branches. Switching restores the valid descendant path via parent-chain.

## Intelligence graph
- `ConversationFlow.tsx` (custom SVG+HTML renderer, NO new dependency) in a
  new `Conversation Flow` section (`intelligence-flow`, GitBranch icon) between
  Current Conversation and Limits. Top-to-bottom layout (`conversationFlowLayout.ts`,
  cycle-safe): roots top, responses under requests, siblings horizontal.
- Nodes: icon + label + version + status dot (red failed / amber cancelled-or-
  running pulse / default) + React-escaped content-preview tooltip; active path
  highlighted (`data-active`, tollma ring/edges), others subdued. Click → select
  → refresh; graph and chat share the same tree/path queries (no second model).
- Zoom 50–200% via scaled dimensions (scroll-safe, no CSS transform), reset,
  show-active (reduced-motion aware), compact mode >24 nodes, `overflow-auto`
  pan/scroll, keyboard-accessible buttons with aria-labels, `<h3>` section
  headings. Responsive + mobile drawer compatible.

## Sidebar / history
- One entry per conversation (unchanged); switching restores the server-side
  leaf via the path endpoint; new conversations start independent trees.
