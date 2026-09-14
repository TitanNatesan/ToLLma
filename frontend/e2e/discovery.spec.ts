// Refresh discovers into Available (registers nothing); Register moves Available -> Registered.
import { expect, test } from "@playwright/test";
import { API, MOCK_URL, apiCreateProvider, apiLoginAs } from "./helpers";
import { startMockLLM } from "./mock-server";

test.beforeAll(async () => {
  await startMockLLM();
});

test("refresh discovers, register moves model to registered", async ({ page, request }) => {
  await apiLoginAs(page, "disc");
  const name = `pw-disc-${Date.now()}`;
  const { id: providerId } = await apiCreateProvider(page.request, name);

  await page.goto("/providers");
  await page.locator("section[aria-label='Provider list']").getByText(name).click();
  const section = page.locator("section[aria-label='Provider details']");
  const detail = section.getByTestId("provider-detail");

  // Before refresh: nothing discovered, nothing registered.
  await expect(detail.getByTestId("discovery-stats")).toContainText(/Available Models:\s*0/);
  await expect(section.getByTestId("no-available-models")).toBeVisible();
  await expect(section.getByTestId("no-registered-models")).toBeVisible();

  // Refresh queries the provider and caches — it registers nothing.
  await detail.getByTestId(`discover-${providerId}`).click();
  await expect(detail.getByTestId(`discover-result-${providerId}`)).toContainText("2 found, 2 available", { timeout: 20000 });
  await expect(section.getByTestId("available-row-mock-disc-a")).toBeVisible();
  await expect(section.getByTestId("available-row-mock-disc-b")).toBeVisible();
  await expect(section.getByTestId("avail-match-mock-disc-a")).toContainText("Unmatched");
  await expect(detail.getByTestId("discovery-stats")).toContainText(/Available Models:\s*2/);
  await expect(detail.getByTestId("discovery-stats")).toContainText(/Registered Models:\s*0/);
  let models = await (await page.request.get(`${API}/api/v1/models`, { params: { provider_id: providerId } })).json();
  expect(models).toHaveLength(0);

  // Available search narrows the list (hidden count grows).
  await section.getByTestId("available-search").fill("disc-b");
  await expect(section.getByTestId("available-row-mock-disc-a")).not.toBeVisible();
  await expect(detail.getByTestId("discovery-stats")).toContainText(/Hidden Models:\s*1/);
  await section.getByTestId("available-search").fill("");

  // View Details tours provider info + repository match, then registers.
  await section.getByTestId("available-details-mock-disc-a").click();
  await expect(page.getByTestId("register-drawer")).toBeVisible();
  await expect(page.getByTestId("reg-step-0")).toContainText("mock-disc-a");
  await page.getByTestId("reg-next").click();
  await expect(page.getByTestId("reg-match-badge")).toContainText("No repository match");
  await page.getByTestId("reg-next").click();
  await expect(page.getByTestId("reg-step-2")).toBeVisible();
  await page.getByTestId("madd-save").click();

  // Model moves panels without a page refresh, with a highlight.
  await expect(section.getByTestId("available-row-mock-disc-a")).not.toBeVisible();
  const row = section.getByTestId(/^model-row-/).filter({ hasText: "mock-disc-a" }).first();
  await expect(row).toBeVisible();
  await expect(row).toContainText("Just registered");
  await expect(detail.getByTestId("discovery-stats")).toContainText(/Available Models:\s*1/);
  await expect(detail.getByTestId("discovery-stats")).toContainText(/Registered Models:\s*1/);
  models = await (await page.request.get(`${API}/api/v1/models`, { params: { provider_id: providerId } })).json();
  expect(models).toHaveLength(1);

  // Reload -> panels persist (server-side cache + registry).
  await page.reload();
  await page.locator("section[aria-label='Provider list']").getByText(name).click();
  const reloaded = page.getByTestId("provider-detail");
  await expect(section.getByTestId("available-row-mock-disc-b")).toBeVisible();
  await expect(section.getByTestId(/^model-row-/).filter({ hasText: "mock-disc-a" }).first()).toBeVisible();
  await expect(reloaded.getByTestId("discovery-stats")).toContainText(/Last Discovery:\s*just now/);
});
