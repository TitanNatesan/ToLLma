// Phase B: conversation intelligence end-to-end — search, edit/regenerate,
// branching, sharing, exports, analytics widgets.
import { expect, test, type Page } from "@playwright/test";
import { startMockLLM } from "./mock-server";
import { apiCreateModel, apiCreateProvider, apiLoginAs, selectProviderModel, sendMessage } from "./helpers";

test.beforeAll(async () => {
  await startMockLLM();
});

async function setup(page: Page, tag: string) {
  await apiLoginAs(page, tag);
  const stamp = Date.now();
  const p = await apiCreateProvider(page.request, `pw-intel-${stamp}`);
  const m = await apiCreateModel(page.request, p.id, `thinker-${stamp}`, "2", "8", {});
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await selectProviderModel(page, p.id, m.id);
  return { p, m, stamp };
}

test("global search finds messages and opens the conversation", async ({ page }) => {
  await setup(page, "intelsearch");
  await sendMessage(page, "quantum entanglement primer");
  await expect(page.getByTestId("message-assistant").last()).toContainText("Thoughtful answer.", { timeout: 20000 });

  await page.keyboard.press("Control+Shift+F");
  const modal = page.getByTestId("search-modal");
  await expect(modal).toBeVisible({ timeout: 10000 });
  await page.getByTestId("search-modal-input").fill("quantum entanglement");
  await expect(page.getByTestId("search-result-0")).toBeVisible({ timeout: 10000 });
  await page.getByTestId("search-result-0").click();
  await expect(modal).not.toBeVisible();
  await expect(page.getByTestId("message-user").last()).toContainText("quantum entanglement primer");
});

test("editing a message keeps versions and regenerates the response", async ({ page }) => {
  await setup(page, "inteledit");
  await sendMessage(page, "original prompt");
  await expect(page.getByTestId("message-assistant").last()).toContainText("Thoughtful answer.", { timeout: 20000 });

  // Fresh messages carry no version history, so no history action exists.
  await expect(page.locator('[data-testid^="history-button-"]')).toHaveCount(0);

  const userMessage = page.getByTestId("message-user").last();
  await userMessage.hover();
  await userMessage.locator('[data-testid^="edit-button-"]').click();
  await userMessage.locator('[data-testid^="edit-input-"]').fill("edited prompt with new intent");
  await userMessage.locator('[data-testid^="edit-save-"]').click();

  await expect(page.getByTestId("message-user").last()).toContainText("edited prompt with new intent", {
    timeout: 15000,
  });
  await expect(page.getByTestId("message-assistant").last()).toContainText("Thoughtful answer.", { timeout: 25000 });

  // History appears on the edited message and on the regenerated response.
  const editedMessage = page.getByTestId("message-user").last();
  await expect(editedMessage.locator('[data-testid^="history-button-"]')).toBeVisible();
  await expect(
    page.getByTestId("message-assistant").last().locator('[data-testid^="history-button-"]'),
  ).toBeVisible();
  await editedMessage.hover();
  await editedMessage.locator('[data-testid^="history-button-"]').click();
  const dialog = page.getByTestId("message-history-dialog");
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId("history-version-1")).toBeVisible();
  await expect(page.getByTestId("history-version-2")).toBeVisible();
  await expect(page.getByTestId("history-version-2")).toContainText(/\d{1,2}:\d{2}/);
  await expect(page.getByTestId("history-diff")).toContainText("edited prompt with new intent");
});

test("regeneration preserves every response and navigates between them", async ({ page }) => {
  await setup(page, "intelregen");
  await sendMessage(page, "first attempt");
  await expect(page.getByTestId("message-assistant").last()).toContainText("Thoughtful answer.", { timeout: 20000 });

  // One generation, no versions → no history affordance yet. Per-message
  // delete/share no longer exist at all (conversation level owns both).
  await expect(page.locator('[data-testid^="generation-nav-"]')).toHaveCount(0);
  await expect(page.locator('[data-testid^="history-button-"]')).toHaveCount(0);
  await expect(page.locator('[data-testid^="delete-message"]')).toHaveCount(0);
  await expect(page.locator('[data-testid^="share-button-"]')).toHaveCount(0);

  const assistant = page.getByTestId("message-assistant").last();
  await assistant.hover();
  await assistant.locator('[data-testid^="regenerate-button-"]').click();

  const nav = page.locator('[data-testid^="generation-nav-"]').last();
  await expect(nav).toBeVisible({ timeout: 25000 });
  await expect(page.getByTestId("generation-page")).toContainText("Response 2 of 2");
  await page.getByTestId("generation-prev").click();
  await expect(page.getByTestId("generation-page")).toContainText("Response 1 of 2");
});

test("branching from a message creates a linked conversation", async ({ page }) => {
  await setup(page, "intelbranch");
  await sendMessage(page, "branch source");
  await expect(page.getByTestId("message-assistant").last()).toContainText("Thoughtful answer.", { timeout: 20000 });

  const source = page.getByTestId("message-assistant").last();
  await source.hover();
  await source.locator('[data-testid^="branch-button-"]').click();
  await expect(page.getByTestId("branch-chip")).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId("message-user").last()).toContainText("branch source");
});

test("share link renders a public read-only page without account data", async ({ page, browser }) => {
  await setup(page, "intelshare");
  await sendMessage(page, "shareable question");
  await expect(page.getByTestId("message-assistant").last()).toContainText("Thoughtful answer.", { timeout: 20000 });

  await page.getByTestId("conversation-menu").click();
  await page.getByTestId("header-share").click();
  await page.getByTestId("share-create").click();
  await expect(page.getByTestId("share-confirm")).toContainText(
    "This link will expose your entire conversation",
  );
  await page.getByTestId("share-confirm-mint").click();
  const link = page.getByTestId("share-link");
  await expect(link).toBeVisible({ timeout: 10000 });
  const url = (await link.textContent()) ?? "";
  expect(url).toContain("/share/");

  // Fresh, unauthenticated context: no cookies, no tokens.
  const context = await browser.newContext();
  const publicPage = await context.newPage();
  await publicPage.goto(url);
  await expect(publicPage.getByTestId("public-share-page")).toBeVisible();
  await expect(publicPage.getByTestId("public-share-title")).toBeVisible();
  await expect(publicPage.getByTestId("public-message-user").first()).toContainText("shareable question");
  await expect(publicPage.getByTestId("public-message-assistant").first()).toContainText("Thoughtful answer.");
  const body = await publicPage.content();
  expect(body).not.toContain("pw-intelshare");
  await context.close();

  // Disabling revokes public access.
  await page.getByTestId("share-disable").click();
  const revoked = await browser.newContext();
  const revokedPage = await revoked.newPage();
  await revokedPage.goto(url);
  await expect(revokedPage.getByTestId("public-share-error")).toBeVisible({ timeout: 10000 });
  await revoked.close();
});

test("conversation exports download real files in every format", async ({ page }) => {
  await setup(page, "intelexport");
  await sendMessage(page, "export me");
  await expect(page.getByTestId("message-assistant").last()).toContainText("Thoughtful answer.", { timeout: 20000 });

  for (const [testId, extension] of [
    ["export-md", "md"],
    ["export-json", "json"],
    ["export-pdf", "pdf"],
  ] as const) {
    await page.getByTestId("conversation-menu").click();
    const downloadPromise = page.waitForEvent("download");
    await page.getByTestId(testId).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename().endsWith(`.${extension}`)).toBeTruthy();
  }
});

test("analytics surfaces the conversation-intelligence widgets", async ({ page }) => {
  await setup(page, "intelwidgets");
  await sendMessage(page, "widget data");
  await expect(page.getByTestId("message-assistant").last()).toContainText("Thoughtful answer.", { timeout: 20000 });

  await page.goto("/analytics");
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("analytics-widgets")).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId("widget-regenerations")).toBeVisible();
  await expect(page.getByTestId("widget-branches")).toBeVisible();
  await expect(page.getByTestId("widget-shares")).toBeVisible();
  await expect(page.getByTestId("widget-exports")).toBeVisible();
});
