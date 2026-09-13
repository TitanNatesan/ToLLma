// Scenario 1: wizard registration + persistence (nothing saved before step 5).
import { expect, test } from "@playwright/test";
import { API, MOCK_URL, wizardRegister } from "./helpers";
import { startMockLLM } from "./mock-server";

test.beforeAll(async () => {
  await startMockLLM();
});

test("wizard registers only on finish, then persists", async ({ page, request }) => {
  const name = `pw-prov-${Date.now()}`;
  await page.goto("/providers");
  await page.getByTestId("add-provider").click();
  await page.getByTestId("provider-name").fill(name);
  await page.getByTestId("provider-type").selectOption("CUSTOM");
  // Abandon at step 1: nothing may be persisted.
  await page.keyboard.press("Escape");
  const list = await (await request.get(`${API}/api/v1/providers`)).json();
  expect(list.some((p: { name: string }) => p.name === name)).toBe(false);

  await wizardRegister(page, { name, type: "CUSTOM", baseUrl: MOCK_URL });

  // Detail view opens for the new provider (registration auto-selects it).
  const detail = page.getByTestId("provider-detail");
  await expect(detail).toContainText(name);

  // Only two provider actions exist: Validate + Refresh models.
  await expect(detail.getByRole("button", { name: "Validate" })).toBeVisible();
  await expect(detail.getByRole("button", { name: "Refresh models" })).toBeVisible();
  await expect(detail.getByRole("button", { name: "Catalog Import" })).toHaveCount(0);
  await expect(detail.getByRole("button", { name: "Sync models" })).toHaveCount(0);

  // Reload -> persists (database, not just client state).
  await page.reload();
  await expect(page.locator("section[aria-label='Provider list']").getByText(name)).toBeVisible();
});
