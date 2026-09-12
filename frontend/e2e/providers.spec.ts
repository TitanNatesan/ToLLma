// Scenario 1: provider registration, validation, persistence.
import { expect, test } from "@playwright/test";
import { MOCK_URL } from "./helpers";
import { startMockLLM } from "./mock-server";

test.beforeAll(async () => {
  await startMockLLM();
});

test("create + validate + persist provider", async ({ page }) => {
  const name = `pw-prov-${Date.now()}`;
  await page.goto("/providers");
  await page.getByTestId("add-provider").click();
  await page.getByTestId("provider-name").fill(name);
  await page.getByTestId("provider-type").selectOption("CUSTOM");
  await page.getByTestId("cred-base_url").fill(MOCK_URL);
  await page.getByTestId("save-provider").click();

  const card = page.locator("main").getByText(name);
  await expect(card).toBeVisible();

  // Validate credentials against the mock server.
  const validateBtn = page.locator("main >> [data-testid^='validate-']").first();
  await validateBtn.click();
  await expect(page.getByText("✓ Valid").first()).toBeVisible({ timeout: 15000 });

  // Reload -> persists (database, not just client state).
  await page.reload();
  await expect(page.locator("main").getByText(name)).toBeVisible();
});
