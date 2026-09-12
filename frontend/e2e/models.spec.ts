// Scenario 2: model registration, search/filter, persistence.
import { expect, test } from "@playwright/test";
import { startMockLLM } from "./mock-server";
import { apiCreateProvider } from "./helpers";

test.beforeAll(async () => {
  await startMockLLM();
});

test("create + search + persist model", async ({ page }) => {
  const stamp = Date.now();
  const { id: providerId } = await apiCreateProvider(`pw-mprov-${stamp}`);
  const name = `pw-model-${stamp}`;

  await page.goto("/models");
  await page.getByTestId("add-model").click();
  await page.getByTestId("model-provider").selectOption(providerId);
  await page.getByTestId("model-model-id").fill(`mock-${name}`);
  await page.getByTestId("model-name").fill(name);
  await page.getByTestId("model-input-price").fill("2");
  await page.getByTestId("model-output-price").fill("8");
  await page.getByTestId("save-model").click();

  await expect(page.locator("main").getByText(name).first()).toBeVisible();

  // Pricing + capability badges render.
  await expect(page.locator("main").getByText("in $2.000000/1M").first()).toBeVisible();

  // Search narrows to this model.
  await page.getByTestId("model-search").fill(name);
  await expect(page.locator("main").getByText(name).first()).toBeVisible();

  // Reload -> persists.
  await page.reload();
  await page.getByTestId("model-search").fill(name);
  await expect(page.locator("main").getByText(name).first()).toBeVisible();
});
