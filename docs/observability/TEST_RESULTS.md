# Observability Test Results (orchestrator)

- New: test_observability_scores (10) + ledger (19, incl. H1 unpriced-plane test) + export (10) = 39/39 green (isolated DBs, serial).
- Pre-existing prompt-log suites: test_prompt_logging*, retention, privacy retention — green (incl. after H-fixes).
- Full backend suite: 1313 passed / 1 stale head-pointer (updated to e615516d69e7, verified solo). Acceptance-round code (internal keyed-plane wiring, drop counters, single-pane copy) covered by targeted re-runs: 78/78 obs+gateway+purge batch green; e2e trust-privacy + prompt-logs 7/7 on final build.
- Frontend: tsc clean, eslint clean (touched scope), vitest 38 files / 324 tests green, `next build` green (rebuilt twice; final build served on :3000).
- E2E (fresh prod build on :3000): prompt-logs-observability 2/2; trust-legal + center + privacy 15 passed / 1 flake (trust-privacy DSR+export, 6/6 in isolation re-run). One transient failure investigated: rebuild-under-running-server chunk mismatch — resolved by clean server restart, spec green after.
- Migration: 44e09f1438c5 → 88def8fea1b7 → e615516d69e7 applied on dev; upgrade + downgrade(-1) + re-upgrade verified; `alembic check` green.
- Live probes: filters/scores-404/export-CSV verified against :8000 with verified user.
- Reviewer pass: no Critical; H1/H2/H3 + M1/M4/L1 fixed and re-tested; M2/M3/M5/M6/L documented.
- Perf: new capture helpers 25µs/call (level+scrub); queue bounds unchanged (MAXSIZE 1000, fail-open sync fallback); per-row growth ≈ 15 small/NULL columns.
- NOT run: mock-egress seeded-ledger e2e (blocked, see KNOWN_RISKS 10); real-concurrency score race (UQ + loser path code-reviewed, serial test only).
