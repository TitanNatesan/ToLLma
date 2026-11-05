// Empty-state, sample prompts, streaming-indicator contracts, and per-model
// thinking-level persistence. Live tests use the mock LLM + API helpers like
// the other chat specs; the streaming skeletons (message-model-loading,
// typing-indicator) are timing-transient by design, so they are covered by
// static selector-contract tests below instead of a flaky live harness.
import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { startMockLLM } from "./mock-server";
import { API, apiCreateModel, apiCreateProvider, apiLoginAs, selectProviderModel } from "./helpers";

test.beforeAll(async () => {
  await startMockLLM();
});

test("no-provider empty state links the providers page", async ({ page }) => {
  await apiLoginAs(page, "emptystate");
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  const state = page.getByTestId("empty-state");
  await expect(state).toBeVisible({ timeout: 15000 });
  const cta = page.getByTestId("empty-state-cta");
  await expect(cta).toBeVisible({ timeout: 15000 });
  await expect(cta).toContainText("Set up a provider");
  await cta.click();
  await expect(page).toHaveURL(/\/providers/);
});

test("sample-prompt chips fill the composer", async ({ page }) => {
  await apiLoginAs(page, "sampleprompt");
  const stamp = Date.now();
  const p = await apiCreateProvider(page.request, `pw-sample-${stamp}`);
  await apiCreateModel(page.request, p.id, `sample-${stamp}`, "2", "8");
  // Sample prompts render once a provider and at least one chat key exist.
  await page.request.post(`${API}/api/v1/keys`, { data: { name: `e2e-sample-${stamp}` } });

  await page.goto("/");
  await page.waitForLoadState("networkidle");

  for (const i of [0, 1, 2]) {
    await expect(page.getByTestId(`sample-prompt-${i}`)).toBeVisible({ timeout: 15000 });
  }
  const chip = page.getByTestId("sample-prompt-0");
  const label = (await chip.innerText()).trim();
  expect(label.length).toBeGreaterThan(0);
  await chip.click();
  await expect(page.getByTestId("chat-input")).toHaveValue(label);
});

test.describe("streaming indicator contracts (static)", () => {
  // Live observation would need a paced mock stream plus millisecond timing:
  // message-model-loading only renders while streaming with unresolved
  // model/provider names, and typing-indicator only while streaming with
  // still-empty content (reasoning deltas already fill content with a think
  // span, see elements.spec.ts). Assert the selector contract statically.
  const messageView = readFileSync(
    join(__dirname, "..", "src", "app", "components", "MessageView.tsx"),
    "utf8",
  );

  test("message-model-loading skeleton contract", () => {
    expect(messageView).toContain('data-testid="message-model-loading"');
    expect(messageView).toContain('aria-label="Loading model info"');
  });

  test("typing-indicator contract", () => {
    expect(messageView).toContain('data-testid="typing-indicator"');
    expect(messageView).toContain('aria-label="Responding"');
  });
});

async function setLevel(page: Page, level: "low" | "medium" | "high" | "none"): Promise<void> {
  const indicator = page.getByTestId("reasoning-value");
  await indicator.hover();
  await page.getByTestId(`reasoning-level-${level}`).click();
  await expect(indicator).toContainText(level);
}

test("thinking level persists per model across switches", async ({ page }) => {
  await apiLoginAs(page, "thinkpersist");
  const stamp = Date.now();
  const p = await apiCreateProvider(page.request, `pw-persist-${stamp}`);
  const a = await apiCreateModel(page.request, p.id, `persist-a-${stamp}`, "2", "8", {
    supports_reasoning: true,
  });
  const b = await apiCreateModel(page.request, p.id, `persist-b-${stamp}`, "2", "8", {
    supports_reasoning: true,
  });
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  // Model A defaults to low; pin it to high.
  await selectProviderModel(page, p.id, a.id);
  await expect(page.getByTestId("reasoning-value")).toContainText("low");
  await setLevel(page, "high");

  // Model B starts at the default; pin it to medium.
  await selectProviderModel(page, p.id, b.id);
  await expect(page.getByTestId("reasoning-value")).toContainText("low");
  await setLevel(page, "medium");

  // Switching back restores each model's own level (localStorage-backed store).
  await selectProviderModel(page, p.id, a.id);
  await expect(page.getByTestId("reasoning-value")).toContainText("high");
  await selectProviderModel(page, p.id, b.id);
  await expect(page.getByTestId("reasoning-value")).toContainText("medium");

  const stored = await page.evaluate(() => localStorage.getItem("tollma-chat"));
  expect(stored).not.toBeNull();
  const levels = (JSON.parse(stored as string) as { thinkingLevels: Record<string, string> }).thinkingLevels;
  expect(levels[a.id]).toBe("high");
  expect(levels[b.id]).toBe("medium");
});
