// Scenario 5: history ordering + loading across reloads.
import { expect, test } from "@playwright/test";
import { startMockLLM } from "./mock-server";
import { apiCreateModel, apiCreateProvider, selectProviderModel, sendMessage, apiLoginAs } from "./helpers";

test.beforeAll(async () => {
  await startMockLLM();
});

test("multiple conversations order by recency and reload", async ({ page }) => {
  await apiLoginAs(page, "hist");
  const stamp = Date.now();
  const { id: providerId } = await apiCreateProvider(page.request, `pw-hprov-${stamp}`);
  const { id: modelId } = await apiCreateModel(page.request, providerId, `pw-hmodel-${stamp}`);
  const first = `first conv ${stamp}`;
  const second = `second conv ${stamp}`;

  await page.goto("/");
  await selectProviderModel(page, providerId, modelId);
  await sendMessage(page, first);
  await expect(page.getByTestId("message-assistant").last()).toContainText("Hello from mock", { timeout: 20000 });

  await page.getByTestId("new-chat").click();
  await sendMessage(page, second);
  await expect(page.getByTestId("message-assistant").last()).toContainText("Hello from mock", { timeout: 20000 });

  // Most recent conversation sorts first in the sidebar.
  const sidebar = page.getByTestId("left-sidebar");
  const items = sidebar.locator("[data-testid^='conversation-item-']");
  await expect(items.first()).toContainText(second.slice(0, 20));

  // Reload -> history intact, newest still first, and it loads on click.
  await page.reload();
  await expect(sidebar.locator("[data-testid^='conversation-item-']").first()).toContainText(second.slice(0, 20));
  await sidebar.locator("[data-testid^='conversation-item-']").first().click();
  await expect(page.getByTestId("message-user").last()).toContainText(second);
});
