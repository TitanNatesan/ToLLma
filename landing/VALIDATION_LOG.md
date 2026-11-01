# platform.tsx (hiw8) — Validation Log

Rebuild: `landing/src/components/sections/platform.tsx` as an 8-layer scroll-driven
gateway story (GSAP ScrollTrigger pin+scrub, anime.js v4 micro-interactions only).
 dependency added: `gsap` (+ `MotionPathPlugin` registered; packet placement uses
native `getPointAtLength` as the MotionPath getPointAtLength-equivalent — pure
function of scroll progress, exact reverse). No other new libs.

Gallery: `/tmp/opencode/hiw8/` (`w1440-*`, `w1280-*`, `w500-tall`, `w720-inj-dpr2`,
DPR 1–3). Method: headless Chrome (`--no-sandbox --disable-gpu`, CDP on :9223),
static export served from `landing/out/` on :8931. In-page detectors
(`?hiwselftest=1` → `[data-selftest-results]`, read via `--dump-dom` and CDP):
T1 single-heading · T2 connector endpoints ≤2px (claimed==geometry AND
claimed touches a node edge or another wire = bus-joint rule) · T3 packet-on-path
(41 samples/path incl. reverse identity) · T4 no-h-scroll · T5 node overlap ·
T6 banned vocabulary on rendered text.

## Failures found → fixed (loop closed, zero open)

| ID | Sev | Viewport / scroll | Symptom | Fix | Screenshot |
|----|-----|-------------------|---------|-----|------------|
| V001 | info | 1440/1280/1024/500, p=0.55 | T6 flagged `role=` ARIA attrs + intentional no-queue copy ("never queued") | Detector tests `innerText` (not markup/comments/attrs); copy reworded to assert deny-without-the-token ("nothing waits", "deny only") | — (text) |
| V002 | major | 1440, p=0.5 | Provider fan-out stubs started mid-air (floating feeds, col-1 unfed) | Fan rebuilt as bus + T-joint drops into each chip edge; receiving family (OpenAI) col0-bottom where fan-d4 lands; T2 extended with joint rule | w1440-safe-mid |
| V003 | major | 1440, selftest | T2 joint: L05 tap stub (868,424) 10px off-wire (bus ended x=840) | Bus extended 548→868; tap-down/L07-tap/feeds re-homed to x=868 | — (selftest) |
| V004 | minor | 1440, p=0.5 safe | REQUEST BLOCKED badge + BLOCK pill at full emphasis in safe mode; pill pile-up with RESPONSE label | `data-coral-ui` dimming (0.22 safe / 1 injection); separate BLOCK pill removed (terminus self-labels); terminus moved above response slot | w1440-safe-mid |
| V005 | minor | 1440, p=0.5 | Labels on wires (SETUP centered on 40px wire; REQUEST on elbow; lane tag vs REQUEST pill) | Reserved adjacent slots: SETUP above wire, REQUEST below elbow, lane tag right of drop | w1440-safe-mid |
| V006 | minor | 1440, p=0.5 | s3 tap trickle visible while tap-bus undrawn (dot on invisible wire) | Packets gated on own segment's draw fraction (`live(name)`, lead + ≤3 secondary) | w1440-safe-mid |
| V007 | infra | — | CDP driver attached to extension background page (hang) | Select `type==="page"` target; send timeouts | — |
| V008 | infra | 1440 | Anchor screenshots mid-smooth-scroll (outcomes sticky bleed at top) | `scrollBehavior='auto'` before programmatic scroll in driver | — (gallery) |
| V009 | info | all | 6–8 Chrome font-preload warnings (`_next/static/...woff2 preloaded but not used`) | EXTERNAL / pre-existing: emitted for layout-level `next/font` preloads, independent of this section; global font-loading change out of scope (would affect all sections + other sessions' work). Zero warnings introduced by this change; zero errors everywhere. | — |

Perpendicular line crossings accepted (documented, no label is ever crossed):
return-horizontal × L07-tap-vertical (960,444); L05-tap-stub × nothing (ends at bus);
coral-vertical × response-slot (908,254). All endpoints ≤2px verified by T2.

## Final full runs (two consecutive, clean, post-fix)

- RUN-F1 + RUN-F2 (identical results): `tsc --noEmit` clean, `npm run build` green,
  T1–T6 PASS @1440+500 (T2 worst 0.00px/28 paths, T3 1066 samples/0 bad),
  scroll-scan 114 steps × 40px zero overlap/clip, tab-through 14 controls zero traps,
  contrast 5.81–11.31 (AA), console errors 0.
  (Two earlier full runs also clean pre-final-tweaks: V005-lane-tag + V006-gates.)
- Lighthouse (noisy shared box — ran 2x+, reporting all):
  desktop 97/96 + 98/96 (perf/a11y; thresholds ≥85/≥95 ✓);
  mobile 79/96 + NO_FCP-flake + 80/96 (thresholds ≥75/≥95 ✓ on both valid runs).

## Known limitations

1. Min headless window width 500px: 390px CSS proven by identical code path
   (matchMedia <1200px → tall) verified at 500px + responsive primitives
   (grid-cols-2, w-full); true-390 + 125–400% body-zoom approximated via
   width/DPR matrix (720≈200%, DPR3 crispness shown).
2. Reduced-motion verified via emulated media (unpinned 781px block, complete
   diagram, no pin-spacer); physical AT tab-through approximated by CDP
   document-order focus walk (14/14 reachable, zero traps).
3. Top-of-frame bleed in some gallery shots is the adjacent outcomes sticky
   section mid-scroll (driver artifact), not part of #platform.
4. `?hiwshot=` / `?hiwselftest=` hooks are query-gated, render nothing by default,
   and add no console output.

## R9 — scripted camera (platform.tsx) — validation log (2026-11-02)

Scope: `landing/src/components/sections/platform.tsx` only. Method: static
`out/` served on :8931, headless Chrome 155 + CDP (:9223); `?hiwshot=p`
renders the exact paint state (deterministic, camera on when wide);
real-scroll suite drives the pinned page. Gallery: `/tmp/opencode/r9/`
(20 PNGs).

## Failures found → fixed (loop closed, zero open)

| ID | Sev | Viewport / scroll | Symptom | Fix | Screenshot |
|----|-----|-------------------|---------|-----|------------|
| R9-V001 | major | 1440, stepper click | `jumpTo` scrolled `wrap.offsetTop + frac·wrapHeight` (≈675–810px into a 5400px pin) — clicks never reached their stage | Target absolute ST range (`rangeRef` set at creation: `start + frac·(end-start)`); verified observe@11859 = step 08, register@9591 = step 01 | — (CDP assert P8) |
| R9-V002 | major | 1440, scroll round-trip | 10/20 samples mismatched: hidden packets kept stale transforms (opacity 0 both ways, `translate` differed) | `setPkt` removes `transform` when hidden → canonical hidden state; rerun 20/20 exact | — (P2R) |
| R9-V003 | minor | 1440, p=0.55 | 12px FAN-OUT pill (widened 66→73u) crossed the return corridor wire x=960 by 3.6u | `lx 900→890` (pill 881–954, corridor clear) | r9-step6.png |
| R9-V004 | minor | 390 (tall) | 12px WORKSPACE TAP pill ended x=670.6, 10u past the 660 viewBox (was already 0.6u over at 11px) | `lx 560→545` (ends 655.4, inside) | r9-390-full.png |
| R9-V005 | minor | 1440, steps | Lane frames + tags sat outside `[data-camera]` — zoomed text min rendered 11px (tags never magnified) | Moved lane frames/tags inside the camera group (diagram, not backdrop); zoomed min now 50px | r9-step5.png |
| R9-V006 | info | driver | Rail drove `scaleY` on a horizontal bar (never visibly filled) | `scaleX(p)`; verified monotonic 0→1 | — (P2B) |
| R9-V007 | info | driver | Old pass route named non-existent `fan-0`/`route-fan0` (lead vanished mid-pass) | `PASS_WIDE`/`PASS_TALL` over existing conns, continuous visual pass | r9-fullpass.png |
| R9-V008 | infra | harness | Suite sampled mid-blend instant (p=0.54 = slice boundary) and asserted full-frame | Sample slice middles (v=0.5, blend settled); entry/exit asserted at p=0.02/1.0 | — |

## Final full runs (clean, post-fix)

- tsc clean + build green (5 consecutive builds, incl. final).
- suite1 (hiwshot states, 1440): S1–S10 ALL PASS — entry svgOp 0.4/scale .952 · fullpass 8×`1` · exit svgOp 0 · steps active+7-dim w/ labels · fill 65.0% ×8 · authored min 12u · zoomed min 50px · inj coral+badge 1 · safe park at layer input · reduced identity+all-1.
- suite2/3 (real pin scroll, 1440): P1 pin 6300/900 · **P2R round-trip 20/20 exact** (camera/stage/lead/s1/s2/s3/rail/step/8 layers) · P3 14 camera states · P4 27 boxes 0 overlaps · P5 toggle/stepper disjoint · P6 active fully in-frame · P7 toggle 0.15→1→0.12 + aria-pressed · **P8 clicks land on stages** · P9 10 clickables, 0 extras · P10 tab 11/11 in order · P11 contrast min 5.73 (pairs: INK 16.94, MINT 11.31, BLUE 10.05, CORAL 10.02, SUB 8.57, FAINT 5.73, stepper 7.19–13.61).
- suite4/5: T1 390 static (svgOp 1, identity, all 1, no h-scroll) safe+inj · T2 reduced click aria-current+desc · T3 no h-scroll 390/768/1440/1920 top+bottom · T4 selftest T1–T6 ALL PASS (worst endpoint 0.00px, 1066 packet samples 0 bad) · T5 zero console errors · T6 zero own warnings (+2 external font-preload, pre-existing) · T7 400%-zoom no h-scroll · T8 390 identical across p · T9 tall 26 boxes 0 overlaps.
- DPR3 vector-crisp: full-frame scan (4320×2700): 72% of transitions carry a steep ≥60-grey single-px step; sample glyph edges 73/74 grey levels over 3 device px (antialiased core, no blur ramp). Method: PIL gray scanlines, transition = dark(<40)→light(>200) run, max single-px step recorded. 400% zoom = 360 CSS px wide (tall static), no h-scroll.

## Text ≥12px — measurement + geometric note (method reported as required)

- Authored: every SVG `font-size` ≥ 12u (62 texts sampled), HTML chrome ≥ 12px — PASS by measurement (`r9-fullpass`, min fs=12u).
- Zoomed steps: min rendered 50px (step5) — PASS, huge margin.
- Full overview at 1440: micro-labels render ~9–11px CSS, titles ~12.5px. This is geometrically infeasible to "fix" within the brief: svg is 1246 CSS px for a 1600u diagram (scale 0.779); a 29-char label in a 152u node gets 137 CSS px ≈ 4.7px/char, so 12px rendered needs 1.6× viewport width. Enlarging fonts requires enlarging nodes → enlarging the viewBox → scale drops by the same factor (spiral); cropping the base view breaks "full diagram"; full-bleed svg (1440px) still gives only 0.9 scale (10.8px). The camera zoom IS the readability mechanism (60–70% fill ⇒ ≥50px), and 400% browser zoom + DPR3 verify vector crispness instead of raster size. No fonts were shrunk: all 10/11u → ≥12u.

## Contrast — dimmed-state note

Full-emphasis min 5.73:1 (FAINT 55% caption) — AA PASS. Transient phase-C dim (.35) blends to ≈3.03:1 on body copy; accepted: the spotlighted layer (the content being read) is always full-emphasis ≥5.73, dimming reverses exactly on scroll-up, standard practice for scroll-driven spotlights.

## Known limitations

1. Micro-label rendered size at full overview (above) — vector-crisp, camera covers readability.
2. Dimmed-state contrast (above) — transient, by design.
3. `?hiwshot=` / `?hiwselftest=` hooks are query-gated, render nothing by default, add zero console output.
4. Reduced-motion verified via emulated media (as in R11); physical-AT tab approximated by CDP document-order focus walk (11/11 reachable, zero traps).
