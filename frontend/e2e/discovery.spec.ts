// Scenarios 3 + 4: automatic model discovery + manual model creation.
import { expect, test } from "@playwright/test";
import { MOCK_URL } from "./helpers";
import { startMockLLM } from "./mock-server";

test.beforeAll(async () => {
  await startMockLLM();
});

test("discover models then add one manually", async ({ page }) => {
  const name = `pw-disc-${Date.now()}`;
  await page.goto("/providers");
  await page.getByTestId("add-provider").click();
  await page.getByTestId("provider-name").fill(name);
  await page.getByTestId("provider-type").selectOption("CUSTOM");
  await page.getByTestId("cred-base_url").fill(MOCK_URL);
  await page.getByTestId("save-provider").click();

  // Save auto-discovers from the mock's /models endpoint.
  const detail = page.getByTestId("provider-detail");
  const section = page.locator("section[aria-label='Provider details']");
  await expect(detail).toContainText(name, { timeout: 15000 });
  await expect(page.locator("[data-testid^='discover-result']")).toContainText("2 found, 2 added", { timeout: 20000 });
  await expect(section.getByText("mock-disc-a").first()).toBeVisible();
  await expect(section.getByText("mock-disc-b").first()).toBeVisible();

  // Manual creation with full fields.
  const manual = `pw-manual-${Date.now()}`;
  await page.getByTestId("add-model").click();
  await page.getByTestId("madd-name").fill(manual);
  await page.getByTestId("madd-model-id").fill(`mock-${manual}`);
  await page.getByTestId("madd-input-price").fill("3");
  await page.getByTestId("madd-output-price").fill("9");
  await page.getByTestId("madd-context").fill("128000");
  await page.getByTestId("madd-cap-supports_vision").check();
  await page.getByTestId("madd-save").click();
  await expect(section.getByText(manual).first()).toBeVisible();

  // Reload -> discovered + manual models persist.
  await page.reload();
  await page.locator("section[aria-label='Provider list']").getByText(name).click();
  const reloaded = page.locator("section[aria-label='Provider details']");
  await expect(reloaded.getByText("mock-disc-a").first()).toBeVisible();
  await expect(reloaded.getByText(manual).first()).toBeVisible();
  await expect(reloaded.getByText("in $3.000000/1M").first()).toBeVisible();
});
