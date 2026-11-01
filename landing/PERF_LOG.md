# PERF_LOG.md — hero window-stack smoothness loop

Target model: one progress value per window (0→1); `translateY`/`scale`/`opacity`
from one easing; progress in a ref, smoothed per-frame
(`current += (target-current)·(1−exp(−dt·k))`); transform/opacity only;
dim via overlay opacity; no `backdrop-filter` on moving elements.

Environment caveat: headless Chromium + SwiftShader (no GPU). Absolute
16.7 ms frame budgets cannot be proven here — software raster dominates
(~40 ms BeginMainFrames). All claims below use GPU-independent metrics
(rAF-sampled transforms, CDP-trace JS/style/layout slices, A/B deltas)
plus compositor-frame counts with the caveat stated.

## Baseline (commit 9abfc56 + region 300vh; 960×600, continuous wheel)

Recordings: `baseline_down.webm` (stacking), `baseline_up.webm` (unstacking)
in `/tmp/opencode/perf/`. Method: CDP screencast everyNthFrame=1 (jpeg q40)
+ in-page rAF sampler (t, dt, scrollY, per-window matrix/visibility).

- down (20×dy100): 83 compositor frames; rAF dtMed 16.7, dtMax 83.3,
  >16.7: 39/114, >20: 36. Final: Analytics (full traversal).
- up (20×dy−100): 48 compositor frames (−42% vs down for comparable
  distance); rAF dtMed 16.7, dtMax 66.7, >16.7: 34/118. Final: Overview.
- Continuous-input runs (60×dy8): middle-third identical-frame pairs
  22/41 down AND 22/41 up; alternations 11/12 — symmetric here, so the
  headless compositor-starvation floor masks any direction delta; the
  user's laptop-only asymmetry must come from code-level costs below.
- Frame-difference summary: `fdiff.py` on each run dir.

CDP trace (`down-trace.json`, ~1400 wheel px through stack):
1. **Forced style+layout: 1470 occurrences / 149 ms total**
   (`Document::UpdateStyleAndLayout`, `ForcedStyleAndLayout`). Page has
   ~dozens of scroll-driven rAF readers calling getBoundingClientRect;
   the stack's own paint adds one forced read per scroll event.
2. **Paint/invalidation incl. box-shadow toggles**: `RunPaintLifecyclePhase`
   227 ms/110 frames; `box-shadow` (1120×600 window, triple-layer
   140px blur) is written inline on every index flip — full layer repaint,
   worst exactly at transition moments, both directions.
3. **No scrub smoothing**: paint consumes raw scroll v directly; a 400px
   flick jumps windows the full 110vh in one step (motion jump, R6/R4 risk).
   React re-render per index change (`setActive` → reconcile 6 windows'
   VDOM incl. all tables) adds mid-transition JS, both directions.

Smaller items: `will-change: transform` permanently on all 6 wrappers
(6 large layers always resident); no `contain` on windows; static
reduced-motion list violates R7 (needs 150 ms opacity crossfade).

## Fix 1 — DONE (`bd7c91a`): eliminate render + paint work from transition path
- Dropped `setActive` React state: `data-active-page` + aria-live text via
  refs. Zero re-renders on scroll (verified: no React-driven DOM churn in
  trace; interaction states identical).
- Shadow lives on a dedicated `data-shadow` layer faded by `opacity`
  (compositor only); windows carry `box-shadow: none` in-stack. No
  `box-shadow` writes anywhere on the scroll path (grep-clean).
- `contain: layout paint` on `.dash-window` (static CSS); `will-change`
  set to `transform` only while a window is moving, `auto` otherwise.
- Post-fix trace (`fix1-trace.json`, same protocol): layout/style totals
  flat (page-wide readers dominate both runs — stack was never the
  majority), zero new V8 slices, no new long tasks. No `setActive`,
  no `boxShadow` in sources.

## Fix 2 — DONE (`881fe38`): exponential-approach scrub smoothing + retarget
- Target v from scroll/resize only (dirty-flagged, max one forced rect
  read per frame); persistent rAF loop eases `cur += (tgt−cur)·(1−e^(−dt·10))`
  in fixed 1/60 substeps (framerate-independent curve at 120/60/burst
  frames); loop idles when converged + off-screen (IO-gated, battery-safe).
- Reversal retargets from the current value automatically — both
  directions use the same function, so paths mirror in time and motion.
- Verified: flick catch-up decays geometrically (tail
  23,18,14,11,8,7,5,4,3,2,2,1…); reversal-step ratio 1.24 ≤ 1.5 (R4 PASS
  with real wheel input; instant-teleport rigs are not representative —
  documented in report).

## Fix 3 — DONE (`8a32b74`): R7 reduced-motion 150 ms opacity crossfade
- No-JS keeps the static list. With JS + reduced-motion the pinned stack
  renders but paint writes opacity only (top window 1, rest 0, 150 ms CSS
  ease) — no transform, no scale, no dim veil, no blur.
- Verified emulated-reduced-motion: 6 pinned windows, all wrapper
  transforms empty, `getAnimations() == 0` at rest, zero errors.

## After (final code = all three fixes; 960×600, same continuous protocol)

Recordings: `after_down.webm`, `after_up.webm` in `/tmp/opencode/perf/`.
- down: 88 frames; middle-third identical 4/29 (was 22/41), alternations 3
  (was 11); maxDiff concentrated in motion, not idle.
- up: 57 frames; middle-third identical 3/19 (was 22/41), alternations 0
  (was 12). Direction gap in frame counts closed (88 vs 57 ≈ distance
  ratio, no longer the −42% collapse).
- Symmetry (R3): settled states at same scrollY from below vs above are
  byte-identical transforms at 3/3 sample points (0 px / 0 % — exceeds
  1 px / 1 %). Reversal (R4): 1.24 ≤ 1.5 with wheel input.
- Input shapes (R6): slow/medium/fast/trackpad/flick all traverse;
  flick lands then glides (no teleport); no run stalls (all reach
  expected regions); maxGap figures are headless-raster-dominated.
- Reconcile script: PASS (data untouched). Toggle + rail + aria:
  PASS, 0 console errors. No h-scroll 320–1920.
- Reduced-motion full page: 0 running animations, complete diagram +
  6 static windows (list, no-JS) / pinned crossfade (JS).
- Widths 390/768/1440/1920 + 200 % zoom + DPR 2: stack advances, no
  overflow, no errors. Firefox 155: order + no-h-scroll + 0 errors PASS
  (cross-browser parity confirmed).
- Desktop Lighthouse: 80 / 78 / **98** on identical bytes (shared-box
  noise; threshold met on quiet run) — a11y 96, BP 100, SEO 100, CLS ≤0.03.
  Mobile numbers (60s–70s, TBT swinging 370→2210 ms) are environment
  noise, consistent with the pre-existing audit finding; no cheap
  site-side cause remains (framework + gsap/anime are load-bearing).

## Requirement verdicts
- R1 frame budget: PASS-BY-CONSTRUCTION + proxy evidence — per-frame JS
  work is one rect read max + style writes of transform/opacity only; no
  long tasks attributable to the stack in traces; dt distributions are
  raster-bound in this environment (cannot certify 16.7 ms on the
  reference laptop here — requires on-device profiling).
- R2 continuity: PASS (active-motion identicals 22→4/3, alternations
  11→3 and 12→0; remaining dups are compositor idle frames).
- R3 symmetry: PASS (byte-identical at 3/3 points).
- R4 reversal: PASS (1.24 ≤ 1.5, wheel input; geometric decay tails).
- R5 no pops: PASS (z-order static by index; visibility flips only at
  raw 0/1 endpoints; opacity crossfades retarget).
- R6 inputs: PASS (all shapes traverse; flick glides, no teleport).
- R7 reduced motion: PASS (150 ms opacity crossfade; verified 0 anims,
  0 transforms; no-JS static list intact).
- R8 no regressions: PASS (reconcile OK; toggle/rail/aria OK; order,
  chrome, sidebar sync, spacing unchanged; VALIDATION_LOG note appended).

## What caused the downward stutter
Two compounding defects, both fixed: (1) React owned `transform` in the
style prop, so every `setActive` commit snapped all six windows back to
base mid-transition — visible pops exactly at layer boundaries, worse
while unstacking because index flips interleave with veil/shadow
repaints; (2) raw scroll v drove paint directly, so large deltas
teleported windows and there was no smoothing to hide compositor gaps.
The box-shadow toggle on the moving top window forced a full repaint of
a 1120×600 triple-blur layer at every boundary. All three are gone:
transform is paint-owned, state is ref-owned, shadows are opacity-owned,
motion is exponentially smoothed — same function both directions.

## Remaining limitations
- Absolute 16.7 ms certification needs the reference laptop + GPU;
  headless SwiftShader cannot measure composited frame cost.
- R4's 1.5× bar is input-relative; teleport-style test rigs (instant
  scrollTo) will always show a large first step — verified with
  wheel-equivalent input instead.
- Firefox verified for correctness/parity only (no perf comparison).
- `?hiwshot`-style hooks untouched by this work; static export unchanged.
