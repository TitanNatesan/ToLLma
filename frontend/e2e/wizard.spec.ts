// Provider registration wizard: mapping, edit drawer, bulk edit, summary.
import { expect, test } from "@playwright/test";
import { API, MOCK_URL, apiLoginAs } from "./helpers";
import { startMockLLM } from "./mock-server";

test.beforeAll(async () => {
  await startMockLLM();
});

test("wizard maps, edits and registers with match stats", async ({ page, request }) => {
  await apiLoginAs(page, "wizard");
  const name = `pw-wiz-${Date.now()}`;
  await page.goto("/providers");
  // Reset only the wizard draft (the modal reads it on open). Clearing all
  // storage or reloading here drops the session the app is still bootstrapping.
  await page.evaluate(() => {
    localStorage.removeItem("tollma-wizard-draft");
    localStorage.removeItem("tollma_provider_draft");
  });
  await page.getByTestId("add-provider").click();
  await page.getByTestId("provider-name").fill(name);
  await page.getByTestId("provider-type").selectOption("CUSTOM");
  await page.getByTestId("wiz-next").click();
  await page.getByTestId("cred-base_url").fill(MOCK_URL);
  await page.getByTestId("wiz-validate").click();
  await expect(page.getByTestId("wiz-validation-result")).toContainText("Validation successful", { timeout: 20000 });
  await page.getByTestId("wiz-next").click();
  await expect(page.getByTestId("wizard-step-4")).toBeVisible({ timeout: 20000 });

  // Mapping ran: mock ids are unknown to the repository.
  await expect(page.getByTestId("wiz-selection-count")).toContainText("2 of 2");
  // Both mock ids matched as fallback (no repository entry).
  await page.getByTestId("wiz-match-filter").selectOption("fallback");
  await expect(page.getByTestId("wiz-model-mock-disc-a")).toBeVisible();
  await expect(page.getByTestId("wiz-model-mock-disc-b")).toBeVisible();
  await page.getByTestId("wiz-match-filter").selectOption("ALL");

  // Search narrows the list.
  await page.getByTestId("wiz-model-search").fill("disc-b");
  await expect(page.getByTestId("wiz-model-mock-disc-a")).not.toBeVisible();
  await page.getByTestId("wiz-model-search").fill("");

  // Per-model edit drawer.
  await page.getByTestId("wiz-edit-mock-disc-a").click();
  await expect(page.getByTestId("wiz-edit-drawer")).toBeVisible();
  await page.getByTestId("madd-name").fill("Disc A Renamed");
  await page.getByTestId("madd-output-price").fill("11");
  await page.getByTestId("madd-save").click();
  await expect(page.getByTestId("wiz-model-mock-disc-a")).toContainText("Disc A Renamed");

  // Summary shows registered models, then registration persists everything.
  await page.getByTestId("wiz-next").click();
  await expect(page.getByTestId("wizard-step-5")).toBeVisible();
  await expect(page.getByTestId("wiz-finish-models-list")).toBeVisible();
  await page.getByTestId("wiz-register").click();
  await expect(page.getByTestId("provider-detail")).toContainText(name, { timeout: 15000 });

  const providers = await (await page.request.get(`${API}/api/v1/providers`)).json();
  const provider = providers.find((p: { name: string }) => p.name === name);
  const models = await (await page.request.get(`${API}/api/v1/models`, { params: { provider_id: provider.id } })).json();
  expect(models).toHaveLength(2);
  const renamed = models.find((m: { model_id: string }) => m.model_id === "mock-disc-a");
  expect(renamed.name).toBe("Disc A Renamed");
  expect(renamed.metadata.repository_match.match_type).toBe("fallback");
  expect(parseFloat(renamed.output_price)).toBe(11);
  const untouched = models.find((m: { model_id: string }) => m.model_id === "mock-disc-b");
  expect(untouched.name).toBe("mock-disc-b");
});
