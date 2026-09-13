// Provider registration wizard: mapping, edit drawer, bulk edit, summary, sync.
import { expect, test } from "@playwright/test";
import { API, MOCK_URL } from "./helpers";
import { startMockLLM } from "./mock-server";

test.beforeAll(async () => {
  await startMockLLM();
});

test("wizard maps, edits, bulk-updates and registers with match stats", async ({ page, request }) => {
  const name = `pw-wiz-${Date.now()}`;
  await page.goto("/providers");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByTestId("add-provider").click();
  await page.getByTestId("provider-name").fill(name);
  await page.getByTestId("provider-type").selectOption("CUSTOM");
  await page.getByTestId("wiz-next").click();
  await page.getByTestId("cred-base_url").fill(MOCK_URL);
  await page.getByTestId("wiz-next").click();
  await page.getByTestId("wiz-validate").click();
  await expect(page.getByTestId("wiz-validation-result")).toContainText("Validation successful", { timeout: 20000 });
  await page.getByTestId("wiz-next").click();
  await expect(page.getByTestId("wizard-step-4")).toBeVisible({ timeout: 20000 });

  // Mapping ran: mock ids are unknown to the repository.
  await expect(page.getByTestId("wiz-selection-count")).toContainText("2 of 2");
  await expect(page.getByTestId("wiz-match-mock-disc-a")).toContainText("fallback");

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

  // Bulk edit applies output price to both selected models.
  await page.getByTestId("wiz-bulk-out").fill("5");
  await page.getByTestId("wiz-bulk-apply").click();
  await expect(page.getByTestId("wiz-model-mock-disc-b")).toContainText("out $5/1M");

  // Summary shows match statistics, then registration persists everything.
  await page.getByTestId("wiz-next").click();
  await expect(page.getByTestId("wizard-step-5")).toBeVisible();
  await expect(page.getByTestId("wiz-summary-matches")).toContainText("Unknown models: 2");
  await page.getByTestId("wiz-register").click();
  await expect(page.getByTestId("provider-detail")).toContainText(name, { timeout: 15000 });

  const providers = await (await request.get(`${API}/api/v1/providers`)).json();
  const provider = providers.find((p: { name: string }) => p.name === name);
  const models = await (await request.get(`${API}/api/v1/models`, { params: { provider_id: provider.id } })).json();
  expect(models).toHaveLength(2);
  const renamed = models.find((m: { model_id: string }) => m.model_id === "mock-disc-a");
  expect(renamed.name).toBe("Disc A Renamed");
  expect(renamed.metadata.repository_match.match_type).toBe("fallback");
  expect(models.every((m: { output_price: string }) => parseFloat(m.output_price) === 5)).toBe(true);
});

test("provider sync-models and model resync buttons", async ({ page, request }) => {
  const providers = await (await request.get(`${API}/api/v1/providers`)).json();
  const provider = providers.find((p: { name: string }) => p.name.startsWith("pw-wiz-"));
  expect(provider).toBeDefined();

  await page.goto("/providers");
  await page.locator("section[aria-label='Provider list']").getByText(provider.name).click();
  const detail = page.getByTestId("provider-detail");
  await detail.getByTestId(`sync-models-${provider.id}`).click();
  await expect(detail.getByTestId(`sync-models-${provider.id}`)).toContainText("Sync models", { timeout: 30000 });

  // Import a repository-linked model, then resync it from the drawer.
  await page.getByTestId("add-model").click();
  await page.getByTestId("madd-repo-search").fill("gpt-4o");
  await page.getByTestId("madd-repo-import").click();
  await expect(page.getByTestId("madd-repo-key")).toContainText("openai/gpt-4o", { timeout: 15000 });
  await page.getByTestId("madd-save").click();
  await page.getByTestId(/^model-row-/).filter({ hasText: "gpt-4o" }).first().click();
  const drawer = page.getByTestId("model-detail-drawer");
  await expect(drawer).toBeVisible();
  await drawer.getByTestId("model-sync").click();
  await expect(page.getByText(/Already in sync|Synced \d+ fields? from repository/)).toBeVisible({ timeout: 15000 });
});
