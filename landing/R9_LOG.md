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
