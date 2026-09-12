// Scenario 1: provider creation + persistence (detail view included).
import { expect, test } from "@playwright/test";
import { MOCK_URL } from "./helpers";
import { startMockLLM } from "./mock-server";

test.beforeAll(async () => {
  await startMockLLM();
});

test("create + persist provider", async ({ page }) => {
  const name = `pw-prov-${Date.now()}`;
  await page.goto("/providers");
  await page.getByTestId("add-provider").click();
  await page.getByTestId("provider-name").fill(name);
  await page.getByTestId("provider-type").selectOption("CUSTOM");
  await page.getByTestId("cred-base_url").fill(MOCK_URL);
  await page.getByTestId("save-provider").click();

  // Detail view opens for the new provider (save auto-selects it).
  await expect(page.getByTestId("provider-detail")).toContainText(name, { timeout: 15000 });

  // Reload -> persists (database, not just client state).
  await page.reload();
  await expect(page.locator("section[aria-label='Provider list']").getByText(name)).toBeVisible();
});
