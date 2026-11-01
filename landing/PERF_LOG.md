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

## Fix 1 — (pending) eliminate render + paint work from transition path
- Drop `setActive` React state: write `data-active-page` (already done in
  paint) + aria-live text imperatively via refs. Zero re-renders on scroll.
- Shadow via dedicated faded layer (opacity only), not inline box-shadow.
- `contain: layout paint` on windows (static CSS); `will-change` only
  while a window is moving (raw in (0,1)).
## Fix 2 — (pending) exponential-approach scrub smoothing with retarget
## Fix 3 — (pending) R7 reduced-motion 150 ms opacity crossfade stack
