// Scenario 2: credential validation status is stored and displayed.
import { expect, test } from "@playwright/test";
import { API, MOCK_URL } from "./helpers";
import { startMockLLM } from "./mock-server";

test.beforeAll(async () => {
  await startMockLLM();
});

test("validation status persists across reload", async ({ page, request }) => {
  const name = `pw-val-${Date.now()}`;
  await page.goto("/providers");
  await page.getByTestId("add-provider").click();
  await page.getByTestId("provider-name").fill(name);
  await page.getByTestId("provider-type").selectOption("CUSTOM");
  await page.getByTestId("cred-base_url").fill(MOCK_URL);
  await page.getByTestId("save-provider").click();

  // Save auto-validates against the mock: stored status renders in the detail view.
  const detail = page.getByTestId("provider-detail");
  await expect(detail.getByText("Valid").first()).toBeVisible({ timeout: 20000 });
  await expect(detail.getByText(/checked /)).toBeVisible();

  // Status is stored server-side, not just client state.
  await page.reload();
  await page.locator("section[aria-label='Provider list']").getByText(name).click();
  await expect(page.getByTestId("provider-detail").getByText("Valid").first()).toBeVisible();

  const list = await (await request.get(`${API}/api/v1/providers`)).json();
  const stored = list.find((p: { name: string }) => p.name === name);
  expect(stored.validation_status).toBe("valid");
  expect(stored.last_validated_at).not.toBeNull();
});
