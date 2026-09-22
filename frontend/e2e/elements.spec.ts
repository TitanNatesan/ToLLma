// AI SDK Elements-inspired upgrades: reasoning states/duration, attachment
// drag&drop + upload states, scroll-to-bottom. ToLLma-native, no new deps.
import { expect, test, type Page } from "@playwright/test";
import { startMockLLM } from "./mock-server";
import { apiCreateModel, apiCreateProvider, apiLoginAs, selectProviderModel, sendMessage } from "./helpers";

test.beforeAll(async () => {
  await startMockLLM();
});

async function setup(
  page: Page,
  tag: string,
  modelExtra: Record<string, unknown> = {},
  modelPrefix = "thinker",
) {
  await apiLoginAs(page, tag);
  const stamp = Date.now();
  const p = await apiCreateProvider(page.request, `pw-el-${stamp}`);
  const m = await apiCreateModel(page.request, p.id, `${modelPrefix}-${stamp}`, "2", "8", modelExtra);
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await selectProviderModel(page, p.id, m.id);
  return { p, m };
}

test("reasoning states: streaming label, duration, tokens slot, refresh", async ({ page }) => {
  await setup(page, "elreason");
  await sendMessage(page, "think slowly");

  // Streaming: pill appears before the answer, status=streaming, live label.
  const assistant = page.getByTestId("message-assistant").last();
  const toggle = assistant.getByTestId("reasoning-toggle");
  await expect(toggle).toBeVisible({ timeout: 5000 });
  await expect(toggle).toHaveAttribute("data-status", "streaming");
  await expect(toggle).toContainText("Thinking…");

  // Complete: durated label + persisted duration after refresh.
  await expect(assistant).toContainText("Thoughtful answer.", { timeout: 20000 });
  await expect(toggle).toHaveAttribute("data-status", "complete", { timeout: 10000 });
  await expect(toggle).toContainText(/Thought for/);
  await page.reload();
  await page.waitForLoadState("networkidle");
  const restored = page.getByTestId("message-assistant").last();
  await expect(restored.getByTestId("reasoning-toggle")).toHaveAttribute("data-status", "complete");
  await expect(restored.getByTestId("reasoning-toggle")).toContainText(/Thought for/);
  // Expanded panel exposes duration (and token count when the provider reports it).
  await restored.getByTestId("reasoning-toggle").click();
  await expect(restored.getByTestId("reasoning-duration")).toBeVisible();
  await expect(restored.getByTestId("reasoning-panel")).toContainText("Considering");
});

test("attachment drag & drop uploads and reaches ready state", async ({ page }) => {
  await setup(page, "eldrop", {
    supports_vision: true,
    metadata: { supports_files: true },
  });

  // Drag enters the composer → capability-gated dropzone appears.
  await page.dispatchEvent('[data-testid="chat-composer"]', "dragenter", {});
  await expect(page.getByTestId("composer-dropzone")).toBeVisible();
  await page.dispatchEvent('[data-testid="chat-composer"]', "dragleave", {});
  await expect(page.getByTestId("composer-dropzone")).not.toBeVisible();

  // Drop a text file → chip appears immediately, uploads, becomes ready.
  const dataTransfer = await page.evaluateHandle(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(["hello from drop"], "notes.txt", { type: "text/plain" }));
    return dt;
  });
  await page.dispatchEvent('[data-testid="chat-composer"]', "drop", { dataTransfer });
  const chip = page.locator("[data-testid^='attachment-chip-']").first();
  await expect(chip).toBeVisible({ timeout: 5000 });
  await expect(chip).toHaveAttribute("data-status", "ready", { timeout: 10000 });
  await expect(chip).toContainText("notes.txt");

  // Send works with the uploaded attachment; message shows it.
  await sendMessage(page, "see attached");
  await expect(page.getByTestId("message-user").last()).toContainText("see attached");
  await expect(page.getByTestId("message-user").last().getByTestId("message-attachments")).toContainText(
    "notes.txt",
    { timeout: 15000 },
  );
});

test("attachment reply renders sources and inline citation markers", async ({ page }) => {
  await setup(
    page,
    "elcite",
    { supports_vision: true, metadata: { supports_files: true } },
    "cite",
  );

  const dataTransfer = await page.evaluateHandle(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(["region,total\nEU,42"], "report.csv", { type: "text/csv" }));
    return dt;
  });
  await page.dispatchEvent('[data-testid="chat-composer"]', "drop", { dataTransfer });
  const chip = page.locator("[data-testid^='attachment-chip-']").first();
  await expect(chip).toHaveAttribute("data-status", "ready", { timeout: 10000 });

  await sendMessage(page, "summarize the report");
  const assistant = page.getByTestId("message-assistant").last();
  await expect(assistant).toContainText("the answer is 42.", { timeout: 20000 });

  // The attachment turn becomes the reply's Sources section (expandable)…
  const sources = assistant.getByTestId("message-sources");
  await expect(sources).toContainText("Used 1 sources");
  await sources.getByRole("button").click();
  await expect(sources).toContainText("report.csv");
  // …and the [1] marker renders through the InlineCitation component.
  await expect(assistant.getByTestId("citation-marker-1")).toBeVisible();

  // Both survive a refresh, rebuilt from persisted attachment rows.
  await page.reload();
  await page.waitForLoadState("networkidle");
  const restored = page.getByTestId("message-assistant").last();
  await restored.getByTestId("message-sources").getByRole("button").click();
  await expect(restored.getByTestId("message-sources")).toContainText("report.csv");
  await expect(restored.getByTestId("citation-marker-1")).toBeVisible();
});

test("scroll-to-bottom affordance appears when user scrolls away", async ({ page }) => {
  await setup(page, "elscroll");
  await sendMessage(page, "scroll probe");
  await expect(page.getByTestId("message-assistant").last()).toContainText("Thoughtful answer.", {
    timeout: 20000,
  });
  // Shrink the viewport so the list overflows, let the app settle at the
  // latest message, then scroll up like a user.
  await page.setViewportSize({ width: 1000, height: 320 });
  const list = page.getByTestId("message-list");
  await expect
    .poll(() => list.evaluate((el) => el.scrollHeight - el.clientHeight), { timeout: 10000 })
    .toBeGreaterThan(50);
  await expect
    .poll(() => list.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight), { timeout: 10000 })
    .toBeLessThan(5);
  await list.evaluate((el) => el.scrollTo({ top: 0 }));
  await expect(page.getByTestId("scroll-to-bottom")).toBeVisible({ timeout: 10000 });
  await page.getByTestId("scroll-to-bottom").click();
  await expect(page.getByTestId("scroll-to-bottom")).not.toBeVisible({ timeout: 10000 });
});
