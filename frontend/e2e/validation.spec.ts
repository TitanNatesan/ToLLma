// Validate checks credentials only: no discovery, no registration.
import { expect, test } from "@playwright/test";
import { apiCreateProvider, apiLoginAs } from "./helpers";
import { startMockLLM } from "./mock-server";

test.beforeAll(async () => {
  await startMockLLM();
});

test("validate stores status and registers nothing", async ({ page }) => {
  await apiLoginAs(page, "validation");
  const name = `pw-val-${Date.now()}`;
  const { id: providerId } = await apiCreateProvider(page.request, name);

  await page.goto("/providers");
  await page.locator("section[aria-label='Provider list']").getByText(name).click();
  const detail = page.getByTestId("provider-detail");

  await detail.getByTestId(`validate-${providerId}`).click();
  await expect(detail.getByText("Valid").first()).toBeVisible({ timeout: 20000 });
  await expect(detail.getByText(/checked /)).toBeVisible();

  // Validation alone discovers/registers nothing.
  await expect(detail.getByTestId("discovery-stats")).toContainText(/Available Models:\s*0/);
  await expect(detail.getByTestId("discovery-stats")).toContainText(/Registered Models:\s*0/);

  await page.reload();
  await page.locator("section[aria-label='Provider list']").getByText(name).click();
  await expect(page.getByTestId("provider-detail").getByText("Valid").first()).toBeVisible();
});
