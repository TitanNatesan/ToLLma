// Scenario 5: history ordering + loading across reloads.
import { expect, test } from "@playwright/test";
import { startMockLLM } from "./mock-server";
import { apiCreateModel, apiCreateProvider, selectProviderModel, sendMessage } from "./helpers";

test.beforeAll(async () => {
  await startMockLLM();
});

test("multiple conversations order by recency and reload", async ({ page }) => {
  const stamp = Date.now();
  const { id: providerId } = await apiCreateProvider(`pw-hprov-${stamp}`);
  const { id: modelId } = await apiCreateModel(providerId, `pw-hmodel-${stamp}`);
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
  const sidebar = page.getByRole("complementary");
  const items = sidebar.locator("li");
  await expect(items.first()).toContainText(second.slice(0, 20));

  // Reload -> history intact, newest still first, and it loads on click.
  await page.reload();
  await expect(page.getByRole("complementary").locator("li").first()).toContainText(second.slice(0, 20));
  await page.getByRole("complementary").locator("li").first().getByRole("button").first().click();
  await expect(page.getByTestId("message-user").last()).toContainText(second);
});
