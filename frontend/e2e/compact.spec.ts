// Manual /compact command + summary-node presentation (spec 9 + 12.7).
// Deterministic and fully local: no provider, no model, no LLM traffic.
// The compact endpoint and the conversation path are stubbed via page.route;
// the only real calls are localhost auth + conversation setup.
import { expect, test, type Page } from "@playwright/test";
import { API, apiLoginAs } from "./helpers";

async function compactSetup(page: Page, tag: string): Promise<string> {
  await apiLoginAs(page, tag);
  const created = await page.request.post(`${API}/api/v1/conversations`, {
    data: { title: "compact me" },
  });
  if (!created.ok()) throw new Error(`create conversation failed: ${await created.text()}`);
  const conv = (await created.json()) as { id: string };
  await page.goto(`/c/${conv.id}`);
  await expect(page.getByTestId("chat-input")).toBeVisible({ timeout: 15000 });
  return conv.id;
}

async function enterCompact(page: Page): Promise<void> {
  // Keyboard submit: the send button gates on key readiness, but Enter
  // always reaches handleSend (which routes /compact first).
  await page.getByTestId("chat-input").fill("  /compact  ");
  await page.getByTestId("chat-input").press("Enter");
}

test("below-threshold compaction explains the 20% gate and sends nothing", async ({ page }) => {
  const id = await compactSetup(page, "compactth");
  const compacted = page.waitForResponse(
    (r) => r.url().includes(`/conversations/${id}/compact`) && r.request().method() === "POST",
  );
  await page.route(`**/api/v1/conversations/${id}/compact`, async (route) => {
    await route.fulfill({
      status: 422,
      contentType: "application/json",
      body: JSON.stringify({ error: { message: "usage 3% below 20% threshold" } }),
    });
  });
  await enterCompact(page);
  await compacted;

  // No user message, no LLM send: the draft clears and history stays empty.
  await expect(page.getByTestId("chat-input")).toHaveValue("");
  await expect(page.getByTestId("message-user")).toHaveCount(0);
  await expect(page.locator('[data-sileo-toast]', { hasText: "Not enough context" })).toBeVisible({
    timeout: 10000,
  });
});

test("successful compaction toasts the token delta and reloads history", async ({ page }) => {
  const id = await compactSetup(page, "compactok");
  const compacted = page.waitForResponse(
    (r) => r.url().includes(`/conversations/${id}/compact`) && r.request().method() === "POST",
  );
  await page.route(`**/api/v1/conversations/${id}/compact`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "compacted",
        summary_message_id: "sum-seed-1",
        tokens_before: 10000,
        tokens_after: 2000,
        context_window: 128000,
        usage_before: 0.08,
        usage_after: 0.02,
        coverage_through_message_id: "m-seed-9",
        trigger: "manual",
      }),
    });
  });
  await enterCompact(page);
  await compacted;
  await expect(page.locator('[data-sileo-toast]', { hasText: "10,000" })).toBeVisible({ timeout: 10000 });
});

test("summary nodes render distinctly with trigger badge and toggle", async ({ page }) => {
  const id = await compactSetup(page, "compactsum");
  const summary = {
    id: "sum-seed-1",
    role: "summary",
    content: "Seeded summary: the user asked about entanglement.",
    conversation_id: id,
    parent_message_id: null,
    version_number: 1,
    status: "completed",
    created_at: new Date().toISOString(),
    metadata: { compaction_trigger: "manual" },
  };
  await page.route(`**/api/v1/conversations/${id}/path`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ path: [summary], active_leaf_id: summary.id }),
    });
  });
  await page.reload();
  const node = page.getByTestId("message-summary");
  await expect(node).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId("summary-header-sum-seed-1")).toContainText("Summary");
  await expect(page.getByTestId("summary-trigger-sum-seed-1")).toContainText("Manual");
  await expect(page.getByTestId("summary-body-sum-seed-1")).toContainText("entanglement");
  await page.getByTestId("summary-toggle-sum-seed-1").click();
  await expect(page.getByTestId("summary-body-sum-seed-1")).toBeHidden();
});

test("compacted history renders the full chain with the summary inline and toggle round-trips", async ({
  page,
}) => {
  const id = await compactSetup(page, "compactchain");
  const chain = [
    {
      id: "m-seed-1",
      role: "user",
      content: "Seeded question: what is entanglement?",
      conversation_id: id,
      parent_message_id: null,
      version_number: 1,
      status: "completed",
      created_at: new Date().toISOString(),
      metadata: {},
    },
    {
      id: "m-seed-2",
      role: "assistant",
      content: "Seeded answer: correlated measurement outcomes.",
      conversation_id: id,
      parent_message_id: "m-seed-1",
      version_number: 1,
      status: "completed",
      created_at: new Date().toISOString(),
      metadata: {},
    },
    {
      id: "sum-seed-1",
      role: "summary",
      content: "Seeded summary: the user asked about entanglement.",
      conversation_id: id,
      parent_message_id: "m-seed-2",
      version_number: 2,
      status: "completed",
      created_at: new Date().toISOString(),
      metadata: { compaction_trigger: "manual" },
    },
  ];
  await page.route(`**/api/v1/conversations/${id}/path`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ path: chain, active_leaf_id: "sum-seed-1" }),
    });
  });
  await page.reload();
  // Full chain renders in order: user, then assistant, then the summary base.
  await expect(page.getByTestId("message-user")).toContainText("entanglement");
  await expect(page.getByTestId("message-assistant")).toContainText("correlated");
  const node = page.getByTestId("message-summary");
  await expect(node).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId("summary-trigger-sum-seed-1")).toContainText("Manual");
  // Toggle round-trips: collapse hides the body, expanding restores it.
  await page.getByTestId("summary-toggle-sum-seed-1").click();
  await expect(page.getByTestId("summary-body-sum-seed-1")).toBeHidden();
  await page.getByTestId("summary-toggle-sum-seed-1").click();
  await expect(page.getByTestId("summary-body-sum-seed-1")).toBeVisible();
  // Covered history stays intact beside the summary (nothing rewritten).
  await expect(page.getByTestId("message-user")).toHaveCount(1);
});

test("slow compaction shows progress until the token-delta toast lands", async ({ page }) => {
  const id = await compactSetup(page, "compactslow");
  const compacted = page.waitForResponse(
    (r) => r.url().includes(`/conversations/${id}/compact`) && r.request().method() === "POST",
  );
  await page.route(`**/api/v1/conversations/${id}/compact`, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "compacted",
        summary_message_id: "sum-seed-1",
        tokens_before: 10000,
        tokens_after: 2000,
        context_window: 128000,
        usage_before: 0.08,
        usage_after: 0.02,
        coverage_through_message_id: "m-seed-9",
        trigger: "manual",
      }),
    });
  });
  await enterCompact(page);
  // In-flight progress is a lightweight toast, then the delta toast lands.
  await expect(page.locator('[data-sileo-toast]', { hasText: "Compacting" })).toBeVisible({
    timeout: 10000,
  });
  await compacted;
  await expect(page.locator('[data-sileo-toast]', { hasText: "10,000" })).toBeVisible({
    timeout: 10000,
  });
  // The command never becomes a user message and the draft clears.
  await expect(page.getByTestId("chat-input")).toHaveValue("");
  await expect(page.getByTestId("message-user")).toHaveCount(0);
});
