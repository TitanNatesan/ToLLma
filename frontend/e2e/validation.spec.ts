// Scenario 2: wizard validation is stored and displayed.
import { expect, test } from "@playwright/test";
import { MOCK_URL, wizardRegister } from "./helpers";
import { startMockLLM } from "./mock-server";

test.beforeAll(async () => {
  await startMockLLM();
});

test("wizard validation persists across reload", async ({ page }) => {
  const name = `pw-val-${Date.now()}`;
  await wizardRegister(page, { name, type: "CUSTOM", baseUrl: MOCK_URL });

  // Status is stored server-side, not just client state.
  const detail = page.getByTestId("provider-detail");
  await expect(detail.getByText("Valid").first()).toBeVisible({ timeout: 20000 });
  await expect(detail.getByText(/checked /)).toBeVisible();

  await page.reload();
  await page.locator("section[aria-label='Provider list']").getByText(name).click();
  await expect(page.getByTestId("provider-detail").getByText("Valid").first()).toBeVisible();
});
