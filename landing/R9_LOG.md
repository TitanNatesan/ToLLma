# R9 validation log — platform diagram rebuild to spec

Scope: `landing/src/components/sections/platform.tsx` (+ scoped CSS in file) only.
Suite: `/tmp/opencode/r9b/r9check.cjs` (Playwright 1.63 from `frontend/node_modules`),
served from `landing/out/` (`next build` static export) at `http://localhost:8931`.
Gallery: `/tmp/opencode/r9b/gallery/r9b-{1280,1440,1920}-{entry,pass1,l05-safe,l05-inj,pass2,exit}.png`.

## Spec implementation notes
- Phases: entry 0–6 / pass1 6–18 / layers 18–82 (8×8%: 2% power2.inOut move-in,
  4% hold, 2% move-out) / pass2 82–92 / exit 92–100. Pin `+=420%`, scrub `0.8`,
  pinned stage `paddingTop: 80px` (nav ~60px + 16px).
- Camera: single inner-`<g>` transform from layer bbox + 18u gutter per side
  (one inter-node gutter); wide fill 56.8% (spec >=55%); tall width-fill ~92%.
- Dimming: active layer + adjacent connectors 1.0, ALL else 0.35. Safe blocked
  branch 0.35 except when adjacent to the active layer. Injection: lead parked
  at the L05 block through passes AND layer windows; downstream 0.35 in passes.
- L05+injection camera unions the blocked badge so the branch stays in frame
  (zoom reads ~32% width there — see limitations).
- Reduced motion / tall / unpinned: no pin/camera/fades, full flow, stepper
  click dims others to static 0.35. No +/-/Fit elements (10 buttons: 2 traffic + 8 stepper).

## Shortened node copy (verbatim originals)
- L04 desc: was "RPM/RPH/RPD plus token caps. Over-limit is DENY with Retry-After — nothing waits."
- L06 title "Route / translate" -> "Route"; sub "WIRE → UNIFIED → NATIVE" -> "WIRE→NATIVE".
- L07 title "Provider / normalize" -> "Normalize".
- Detail lines replace longer originals, e.g. "Personal + org workspaces"->"Personal + org",
  "Per-model allow-lists"->"Allow-lists", "6 families · OpenAI +7 adapters"->"6 families",
  "Unified result shape"->"Unified result". Full mapping in LAYERS `lines` + R9_LOG history.

## Failures found and fixed (chronological)
1. c1 p=0.18 camera-zoom assert — harness: window-start blends from identity by design; check now skips fu<0.03.
2. c2 PROMPT LOG TAP / METADATA LEDGER overflow — source: pill width ignored letter-spacing
   (measured 13.5–14.4u/char); formula is now len*14.5+26; METADATA LEDGER (199.9u) forced
   ledgers 190->210 wide; PROVIDERS caption moved to (972,708).
3. c5 tip-vs-text 0.0px — harness bug: tips mapped with svg CTM (misses camera g); now uses
   in-camera element CTM. Real fixes: layer text +14u->+18u inset; fan top entries moved
   off-center (spine x1040, d1 x1240); side entries to upper-third (+16).
4. c6 joints — source: fan verticals did not reach moved branches (c0 extend to 628, c1 cut
   to 628); tap-f0 started mid-air (replaced: auth tap runs 404,412->724 to feed meta top);
   response crossed keys interior (rerouted above setup, y=56); harness sampling 8u->2u.
5. c7 w4 blocked=0.35 — source: safe-blocked rule overrode active adjacency; phase-C is now
   strictly adjacency-driven (1.0 vs 0.35).
6. c10 TypeError — harness: spread key collision (`tr`); renamed to `pkt`.
7. NEW c2b wire-vs-node (added after finding fan-c0b1 mis-targeted at vertex/col1 through the
   bedrock chip): fixed target to providers[4]; tap-n dropped 660->684 (was through custom chip).
8. Gallery showed hero/outcomes (smooth-scroll timeout) — shots use instant scroll now; gallery reviewed.
9. Injection parked at active input during layer windows — now parks at blocked end for all inj p in [A,D).

## Validation table (checks × widths; full 41 assertions: 13 checks + c2b + c10b-controls)
- Run 1 (after all fixes): 41/41 PASS — `results.json` run stamp 1.
- Run 2 (consecutive): 41/41 PASS — `results.json` run stamp 2.
- Per-check: c1 phases@1% PASS | c2 overlap PASS | c2b wire-node PASS | c3 pad PASS |
  c4 font>=12px PASS (k=0.707/0.756/0.748) | c5 arrows>=8px PASS | c6 joints<=2px PASS |
  c7 1.0vs0.35 PASS | c8 reversal exact PASS | c9 motion maxIdenticalRun=1 PASS |
  c10 toggle+park PASS | c11 6×3 shots reviewed PASS | c10b controls PASS |
  c12 reduced-motion PASS | c13 zero console PASS.
- Evidence: `/tmp/opencode/r9b/results.json`, gallery PNGs listed above.

## Remaining limitations
- L05-injection camera frames the guardrails+blocked union (~32% width fill); every other
  layer/mode fills >=55% width, and the zoomed text stays large (42px+ rendered).
- Tall/mobile has no pinned camera by design; its 17–18u type renders <12px on ~390px phones
  (desktop >=1280 meets >=12px rendered); tall geometry still passes layout-unit checks.
- c9 measures paint continuity via 110 rAF-driven setP steps (max 1 identical frame), not a
  captured-video consecutive-frame diff.

## Close-out
- Final code (tsc + build green): two consecutive full runs 41/41 at 1280/1440/1920
  (41 assertions = 13 spec checks + wire-vs-node + controls; gallery 18 PNGs reviewed).
- Commits: rebuild -> validation closed. No other sections touched.

## R9c — five-item follow-up (2026-11-02; platform.tsx only)

Suite: same `/tmp/opencode/r9b/r9check.cjs` (41 assertions), same origin
`landing/out/` @ `http://localhost:8931`. Extra probes:
`/tmp/opencode/r9b/r9c-check.cjs` (connectivity audit + soft-edge honesty +
full-bleed metrics). Gallery: `/tmp/opencode/r9b/gallery/r9c-{1280,1440,1920}-{full,layer04zoom}.png`.
tsc + build green; frontend vitest 36 files / 311 tests pass; no new libs; copy/palette/order unchanged.

1. ARROWS OVER WBOXES (fixed defect): probe found the solid `return` lane
   (y690) grazing the "PROVIDERS · 6 FAMILIES" caption box top (1u), and the
   tap-feed dashed lane 7u above it. Rerouted: return exits OpenAI's left
   edge west into an x-gap corridor, runs a dedicated lane between the tap
   feed and the ledger row (crosses nothing), and rises into normalize's
   bottom edge; tap feed runs its own lane below the providers and branches
   into ledger tops via T-joints. Fan redrawn on x-gap corridors (one GUT
   left of each chip column, stubs into left edges +16) with off-center top
   entries (spine x1040, drop col1+24). Post-fix probe: zero wire-vs-text
   hits. Orthogonal wire-wire crossings kept bare on purpose: a bridge gap
   would leave mid-air endpoints and violate the <=2px joint rule (c6).
2. CONNECTIVITY AUDIT (fixed defect): DOM audit (endpoint within node
   bbox+2.5) confirms every specified edge — setup 01→02→lane; request lane
   03→04→05→06→07→08; fan-out to all 6 chips (each >=1 inbound; drop fixed
   off-center so fan-d1 tip keeps >=8px from chip text); single return from
   OpenAI (prov0) into 07; per-layer log taps into all 3 ledger tops +
   workspace tap into captures; coral blocked 05→REQUEST BLOCKED; response
   07→02; analytics observe→tokens. Fixed in this pass: ledger cost/tokens
   4u overlap (now 16u), return/caption crossing, fan-d1 7.9px clearance.
   The 5 non-receiving providers are fan-out leaves by design; the single
   return leg is the specified provider→07 edge.
3. UNIFORM SPACING: single `GUT=16` token drives all peer gaps
   (layer-layer 16, chip-chip 16x16, ledger-ledger 16x16, captures-ledger 16)
   and the camera margin; larger separations are wire lanes stacked as GUT
   multiples below the request row (bus +16, providers +16, tap feed +16,
   return +16, caption row, ledgers). Tall mode pitches aligned to GUT
   (provider rows 80, ledger stack 64).
4. FULL-BLEED: diagram + stepper break out of the 1376px Container to full
   viewport width with px-6 (24px) / md:px-8 (32px) margins (legend/CTA stay
   contained). Pinned stage height-fits the svg (flex-1 + w/h 100%, ratio
   preserved via meet) so the taller full-bleed figure never overlaps the
   toggle — this also fixed a real c10 click interception at 1920. Camera
   math untouched (bbox-derived): zoom fill 72.9% every layer (>=55%);
   rendered 18u text 13.3/15.0/20.3px @1280/1440/1920 (>=12px).
5. SOFT EDGES: screen-space CSS mask (28px feather, all four sides) toggled
   via `data-zoomfade` as a pure function of progress — on only while camOn
   and zoomed, never in reduced-motion/tall/static (plus a
   prefers-reduced-motion guard). No layout change; checks unaffected (mask
   != opacity/geometry). Honesty probe over 30 states (8 layer windows x
   safe + L05 injection + full, x3 widths): zero hard clips (no text bbox
   crossing the viewport edge with opacity >0.6 unless the fade is on).

## Validation table (runs 1+2 consecutive, post-fix)
- r9check: 41/41 PASS @1280/1440/1920, twice consecutively (run stamps 3, 4).
- r9c-check: 7/7 PASS (audit x3, softedge, fullbleed-text, zoom-fill, zoom-text).
- c5 note: first post-reroute run flagged fan-d1 7.9px @1280; fixed by the
  off-center drop; clean since.

## Remaining limitations (carried + new)
- Previous R9 limitations still hold (L05+inj union framing; tall/mobile
  type <12px rendered on phones; c9 rAF-based).
- Pinned live stage height-fits the svg, so at very wide/short viewports
  the diagram letterboxes with side gutters (ratio preserved, no crop);
  unpinned/hiwshot rendering stays true full-bleed.
- Orthogonal wire-wire crossings (return x tap feed, spine x bus) are
  intentional bare crosses, not bridges (joint-rule rationale above).
