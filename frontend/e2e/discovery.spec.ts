// Scenarios 3 + 4: wizard model selection + manual model creation.
import { expect, test } from "@playwright/test";
import { MOCK_URL, wizardRegister } from "./helpers";
import { startMockLLM } from "./mock-server";

test.beforeAll(async () => {
  await startMockLLM();
});

test("wizard registers selected models, then add one manually", async ({ page }) => {
  const name = `pw-disc-${Date.now()}`;
  // Register only mock-disc-a through the wizard (mock offers a + b).
  await wizardRegister(page, { name, type: "CUSTOM", baseUrl: MOCK_URL, onlyModelIds: ["mock-disc-a"] });

  const section = page.locator("section[aria-label='Provider details']");
  await expect(section.getByText("mock-disc-a").first()).toBeVisible();
  await expect(section.getByText("mock-disc-b")).not.toBeVisible();

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

  // Reload -> wizard + manual models persist.
  await page.reload();
  await page.locator("section[aria-label='Provider list']").getByText(name).click();
  const reloaded = page.locator("section[aria-label='Provider details']");
  await expect(reloaded.getByText("mock-disc-a").first()).toBeVisible();
  await expect(reloaded.getByText(manual).first()).toBeVisible();
  await expect(reloaded.getByText("in $3.000000/1M").first()).toBeVisible();
});
