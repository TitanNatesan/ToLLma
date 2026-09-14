// Scenarios 6 + 7: rename persistence, delete removal (+ DB state via API).
import { expect, test, type Page } from "@playwright/test";
import { startMockLLM } from "./mock-server";
import { API, apiCreateModel, apiCreateProvider, selectProviderModel, sendMessage, apiLoginAs } from "./helpers";

test.beforeAll(async () => {
  await startMockLLM();
});

async function createChat(page: Page, stamp: number) {
  const { id: providerId } = await apiCreateProvider(page.request, `pw-rprov-${stamp}`);
  const { id: modelId } = await apiCreateModel(page.request, providerId, `pw-rmodel-${stamp}`);
  await page.goto("/");
  await selectProviderModel(page, providerId, modelId);
  await sendMessage(page, `rename me ${stamp}`);
  await expect(page.getByTestId("message-assistant").last()).toContainText("Hello from mock", { timeout: 20000 });
}

test("rename persists across reload", async ({ page }) => {
  await apiLoginAs(page, "rename");
  const stamp = Date.now();
  await createChat(page, stamp);
  const renamed = `renamed ${stamp}`;

  const sidebar = page.getByTestId("left-sidebar");
  const item = sidebar.locator("[data-testid^='conversation-item-']", { hasText: `rename me ${stamp}` });
  const row = item.locator("..");
  await row.hover();
  await row.getByTitle("Rename", { exact: true }).click();
  await page.getByLabel("Conversation title").fill(renamed);
  await page.getByLabel("Conversation title").press("Enter");
  await expect(sidebar.getByText(renamed)).toBeVisible();

  await page.reload();
  await expect(sidebar.getByText(renamed)).toBeVisible();
});

test("delete removes conversation and database row", async ({ page, request }) => {
  await apiLoginAs(page, "delete");
  const stamp = Date.now() + 1;
  await createChat(page, stamp);

  const sidebar = page.getByTestId("left-sidebar");
  const item = sidebar.locator("[data-testid^='conversation-item-']", { hasText: `rename me ${stamp}` });
  const row = item.locator("..");
  await row.hover();
  await row.getByTitle("Delete", { exact: true }).click();
  await expect(item).toHaveCount(0);

  await page.reload();
  await expect(sidebar.getByText(`rename me ${stamp}`)).toHaveCount(0);

  // Database state: conversation is gone from the API.
  const list = await (await page.request.get(`${API}/api/v1/conversations?search=rename%20me%20${stamp}`)).json();
  expect(list).toEqual([]);
});
