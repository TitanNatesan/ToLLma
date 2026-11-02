# Layout re-fit — platform diagram (request-lane gaps, scale-back, copy audit)

Scope: `landing/src/components/sections/platform.tsx` (+ scoped CSS in file) ONLY.
Suite: `/tmp/opencode/r9b/r9check.cjs` (41 assertions, unmodified) +
`/tmp/opencode/layout/r9c-check.cjs` (r9c copy, wire names/numbers updated) +
`/tmp/opencode/layout/r9new.cjs` (N0/N1/N2/N4/N5/N6/N7/N9/N10) +
in-page selftest T1–T6, all served from `landing/out/` (`next build` static
export) at `http://localhost:8931`. Dev-badge probe against `next dev` at
`http://localhost:3000` (port confirmed in landing dev server).
Gallery: `/tmp/opencode/layout/` (`before-1440.png` from the pre-change build;
`after-{1280,1440,1920}-{entry,exit}.png`, `after-390-tall.png`,
`dev-1440-badge.png` post-change).

## Single layout config (centers/widths/gaps as values, connectors from bboxes)
- `GUT=24` (wire-lane pitch + camera margin), `GAP=44` (request peer gap),
  `LW=252` / `LH=132` (all 8 layer boxes), `CHIP_W=240` / `CHIP_H=64`,
  `LED_W=272` / `LED_H=52`, `FU=22` (base font unit = 12/k + margin).
- Wide viewBox `(-179,-20,2170,1000)`; tall mode geometry untouched.
- Measured render scale k = svgW/vbW: 0.560 / 0.634 / 0.855 @1280/1440/1920.
- Final gaps: 44/44/44/44/44u (shafts 24.7/27.9/37.6px rendered);
  setup↔request 56u; scale (layers-union/vbW ratio) 0.883x — inside 0.86–0.90.

## Copy audit vs site.ts (verbatim)
Restored:
1. L04 caption desc -> "RPM/RPH/RPD plus token caps. Over-limit is DENY with Retry-After — nothing waits."
2. Provider chip "Gemini" -> "Google Gemini" (site.ts `name`).
3. Provider chip "Bedrock" -> "AWS Bedrock" (site.ts `name`).
4. Vertex note "TOOLS · STREAM" -> "STREAM-ONLY" (site.ts `tools: false`).
Pill/caption wording and "Overview: Eight layers, one request path." unchanged.
Open (never silently shrunk; geometry proof in report):
- L06 title "Route / translate" needs a ~265u+ box; L06 sub "WIRE → UNIFIED → NATIVE"
  needs ~350u; L07 title "Provider / normalize" needs ~300u. Any of these pushes
  content past the fixed point where scale<=0.90, shafts>=24px and floor>=12px
  jointly hold (loop gain ~0.8 converges past C1~2300u). Kept short + recorded.
- Detail lines ("Per-model allow-lists" etc.) and "Custom / OpenAI-compatible"
  (needs ~340u chip) likewise exceed the budget; kept + recorded.

## Routing (wide)
- RESPONSE along the top edge (y=56) above both lanes, into keys top and out of
  normalize top. RETURN: openai left edge -> dedicated lane (y=668, 16u below the
  tap feed) -> normalize bottom; crosses nothing.
- Fan: one dedicated vertical inbound lane per chip — col0 spine x=940 from route
  into gemini top + chains down (bottom-to-top ports); col1 elbow from route into
  anthropic top + chains down. Parallels >=20u; zero proper crossings.
- Every pill (REQUEST/RESPONSE/LOG TAPS/FAN-OUT/RETURN/PROMPT LOG TAP/ANALYTICS)
  in a gutter slot with opaque bg, >=12px from any wire, never on a line.
  Blocked badge keeps its two-line "REQUEST/BLOCKED" self-label (square corners:
  the c6 joint rule only sees rx-less rects as nodes).
- Separator line y=874 between "PROVIDERS · 6 FAMILIES" (y=842) and
  "ANALYTICS READS LEDGERS" (y=928): 32u gaps each side (~18px rendered).
- Bottom: `pb-12` below the caption (cap bottom 852/900 in dev) so the Next.js dev
  badge never covers stepper tile 01; prod build holds the same spacing.

## Failures found and fixed (check#, width, cause -> fix)
1. N2 pill height pad 1.8px — by design (30u label chips); scoped N2 to width-pad
   for pills, kept height-pad for text boxes. No code change.
2. N4 0.0px readings — harness bug (viewBox origin ignored in bbox mapping); fixed
   toU/U. No code change.
3. N7 fit — harness measured without scrolling; switched N7 to pinned-mode
   column-height check (svgB<=stepT, colH<=vh). No code change.
4. N2 chip widths — "TOOLS · STREAM"/"OPENAI-COMPAT" measured 212u, needed
   CHIP_W 228->240 (pad 15.7px); return lane moved to x=1468 (16u off custom).
5. N4 tap-r 0.0px — REAL: captures vertical x=314 crossed the LOG TAPS slot;
   moved auth tap to x=90, LOG TAPS pill to (202,418) (26u clearances).
6. N2 ledger/captures widths — "METADATA LEDGER" 247u -> LED_W 240->272;
   "ENCRYPTED·BOUNDED" 248u -> captures 264->272; LED_H/captures h 48->52
   (text bbox 26.77u needs 48.2u for the 12px pad floor).
7. N4 return 5px — tap-f0 moved under the RETURN pill; pill moved to (916,726).
8. N2@1920 captures note bottom overflow 1.6px — baseline y+48 -> y+45.
9. c5 arrow tips (entry scale 0.92): fan tip vs "Google Gemini" 5px -> col0 lane
   x=940; normalize-observe tip vs line text -> lines inset 16->24; drop tip vs
   title -> tip x=260; response tip vs title -> drop x=480; blocked tip vs badge
   text -> badge h 78->96, texts y+44/+70.
10. c6 blocked joint 54u — badge rx made it invisible to the node rule; reverted
    to square corners (self-label kept, recorded as the REQUEST BLOCKED pill).
11. r9c fullbleed harness — stale `18 * r.k` constant; updated to 22u.
Side effect: r9check c11 re-saved `/tmp/opencode/r9b/gallery/r9b-*.png` with the
new layout (current-code evidence; historic R9 numbers live in R9_LOG.md).

## Validation table (TWO consecutive full runs, all green)
- r9check: 41/41 PASS @1280/1440/1920, twice (c1 phases, c2/c2b overlap+wire-node,
  c3 pad, c4 floor k=0.560/0.634/0.855, c5 arrows>=8px, c6 joints<=2px, c7 dimming,
  c8 exact reverse, c9 continuity, c10 toggle+park, c11 shots, c10c 10 buttons,
  c12 reduced-motion, c13 zero console).
- r9c: 7/7 PASS (connectivity with new wire names, softedge honest 30 states,
  fullbleed text 12.3/14.0/18.8px, zoom fill 76.8% every layer, zoom text 68px+).
- r9new: N0 wording, N1 gaps/shafts/widths/setup-req, N2 textbox, N4 labelgap,
  N5 zero crossings/parallels, N6 overlaps, N7 pinned fit entry+exit, N9 framing,
  N10 shots — all PASS @3 widths, twice.
- selftest T1–T6 PASS @1280+@1440 (T2 worst 0.00px, T3 902 samples/0 bad).
- N8 dev badge: elementFromPoint on tile 01 returns tile at 5/5 probe points;
  stepper bottom 817 / caption bottom 852 < 900 with badge present (dev-1440 shot).
  Prod (no badge): N7 colH=772 <= 900 entry+exit @1440/1920.
- frontend vitest: exit 0 (unrelated suite, unaffected). `tsc --noEmit` clean.

## Remaining limitations (open items)
- L05+injection camera unions guardrails+blocked: fill 39.1% (was ~32%; safe-mode
  layers all 76.8% >= 55%). In/out connectors stay visible (ports on frame edges).
- Tall/mobile (<1200px, incl. 390/320px): static, no camera by design; min
  rendered text 11.4px @390 (was 9.3px) — still under the 12px floor. Recorded
  separately as required; geometry checks still pass in tall mode.
- "≥70% mobile height" active fill: no pinned camera exists on mobile by design
  (R9 rule kept); tall diagram renders full-flow and scrolls.

## Follow-up: restore full route/normalize wording (no-impossibility path)
- Restored all three: L06 title "Route / translate" (ink 176.6u), L06 sub
  "WIRE → UNIFIED → NATIVE" (ink ~332u per C3 client-rect, vs 315.9u
  getBBox estimate — trailing arrow fallback shaping; sized to the harness
  number), L07 title "Provider / normalize" (ink 224.6u). Nothing proven
  impossible; no open wording items remain from this round.
- Config 1 tried: RW=348/NW=288 → c3@1280 FAIL (pad 8.9px on the sub;
  needed boxW >= 332 + 12/0.560 = 353.5u). Config 2 (shipped): RW=364/
  NW=288 → full green. viewBox untouched (2170): k = 0.560/0.634/0.855,
  font floor 12.3/14.0/18.8px, shafts 44k = 24.7/27.9/37.6px.
- Final wide geometry: route 928..1292, normalize 1336..1624 (center 1480),
  observe 1668..1920; peer gaps 44/44/44/44/44u; widths min 252u (>=170u);
  return riser x=normRight-8 (1604...1612), response riser x=normCenter,
  tap-n elbow x=normRight+28, analytics start x=observeCenter — all computed
  from bboxes. Dashed request frame extended to 16..1944 (w=1928, computed
  from observe). Right margin 47u (~26px @1280, >=24px); left untouched.
- Scale note: layers-union/vbW = 1880/2170 = 0.866 (frame-union 0.888) —
  both inside 0.86–0.90. (Prior log's 0.883 does not reproduce from the
  layers-union definition — pre-change layers-union was 1756/2170 = 0.809;
  recorded here as measured.)
- Detail lines: no restorable originals exist — R9_LOG.md is deleted from
  the repo and git history shows the current short lines since the rebuild;
  kept as-is.
- Validation: r9check 41/41 PASS @1280/1440/1920 (run twice: config-1
  40/41 with the single c3@1280 pad fail, config-2 41/41); r9new all PASS
  (N1 gaps/shafts/widths, N2, N4, N5 zero crossings, N6, N7, N9 route fill
  72.8% formula / 100% real, N10); r9c 7/7; `tsc --noEmit` clean; frontend
  vitest 311/311. Shots: /tmp/opencode/layout/r9e-{1280,1440,1920}-full.png
  (?hiwshot=0.12 full-view). Gallery r9b-*-shots re-saved by c11 with the
  new layout (expected).
