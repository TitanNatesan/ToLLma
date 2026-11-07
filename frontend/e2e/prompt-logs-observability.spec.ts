// Prompt-logs observability ledger (empty-state): no API mocking — the
// backend is the source of truth throughout.
//
// NOTE: a seeded-row test (chat via the mock LLM -> ledger row -> drawer,
// scores, non-empty export) is intentionally absent: seeding needs a CUSTOM
// provider pointed at the host mock LLM, which the live backend's SSRF
// guard rejects (`backend/src/tollms/core/egress.py` refuses `.internal`
// hosts). The pre-existing `e2e/chat.spec.ts` fails identically at provider
// creation, proving this is environmental, not spec rot. Revisit if the
// environment ever allowlists mock egress. Score-form validation itself is
// covered by vitest (`promptLogLogic.validateScoreForm`); the ScoresPanel
// only renders inside a row's detail drawer, so it needs a row too.
import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { apiLoginAs } from "./helpers";

test("empty ledger renders filters, validates filter round-trip, exports header-only CSV", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await apiLoginAs(page, "plogsempty");

  await page.goto("/prompt-logs");
  await expect(page.getByRole("heading", { name: "Prompt Logs" })).toBeVisible();
  await expect(page.getByTestId("prompt-logs-panel")).toBeVisible();
  await expect(page.getByTestId("no-prompt-logs")).toContainText("No prompt logs yet");

  // Observability filter legs (trace/session/cost/token/level) + export actions.
  await expect(page.getByTestId("prompt-log-filter-trace")).toBeVisible();
  await expect(page.getByTestId("prompt-log-filter-session")).toBeVisible();
  await expect(page.getByTestId("prompt-log-export-csv")).toBeVisible();
  await expect(page.getByTestId("prompt-log-export-jsonl")).toBeVisible();

  // A trace filter that matches nothing is honest: empty state + clear restores.
  await page.getByTestId("prompt-log-filter-trace").fill("no-such-trace-xyz");
  await expect(page.getByTestId("no-prompt-logs")).toContainText("No matching logs");
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page.getByTestId("no-prompt-logs")).toContainText("No prompt logs yet");

  // Real backend export of an empty ledger: single header row, never bodies.
  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("prompt-log-export-csv").click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/prompt-logs.*\.csv$/);
  const csv = await readFile((await download.path())!, "utf-8");
  const lines = csv.split("\n").filter((l) => l.trim() !== "");
  expect(lines).toHaveLength(1);
  expect(lines[0]).toContain("trace_id");
  expect(lines[0]).toContain("total_cost");
});
