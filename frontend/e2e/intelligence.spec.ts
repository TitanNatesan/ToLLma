// Model Intelligence end-to-end: register-drawer repository assist, chat usage/cost, analytics, sync.
import { expect, test } from "@playwright/test";
import { API, apiCreateModel, apiCreateProvider, selectProviderModel, sendMessage } from "./helpers";
import { startMockLLM } from "./mock-server";

test.beforeAll(async () => {
  await startMockLLM();
});

test("register drawer auto-populates from the repository", async ({ page, request }) => {
  const stamp = Date.now();
  const { id: providerId } = await apiCreateProvider(`pw-intel-prov-${stamp}`);

  await page.goto("/providers");
  await page.locator("section[aria-label='Provider list']").getByText(`pw-intel-prov-${stamp}`).click();
  const section = page.locator("section[aria-label='Provider details']");
  const detail = section.getByTestId("provider-detail");
  await detail.getByTestId(`discover-${providerId}`).click();
  await expect(section.getByTestId("available-row-mock-disc-a")).toBeVisible({ timeout: 20000 });

  // Register drawer is prefilled from the discovery cache; repository search
  // swaps in canonical pricing/limits for a different model id.
  await section.getByTestId("register-mock-disc-a").click();
  await expect(page.getByTestId("register-drawer")).toBeVisible();
  await page.getByTestId("madd-repo-search").fill("gpt-4o");
  await page.getByTestId("madd-repo-import").click();
  // Auto-populated from the repository (prices converted to per-1M, limits filled).
  await expect(page.getByTestId("madd-repo-key")).toContainText("openai/gpt-4o");
  const inputPrice = await page.getByTestId("madd-input-price").inputValue();
  expect(parseFloat(inputPrice)).toBeGreaterThan(0);
  const context = await page.getByTestId("madd-context").inputValue();
  expect(parseInt(context, 10)).toBeGreaterThan(0);
  await page.getByTestId("madd-save").click();

  // Data persistence: stored with repository link + snapshot of original values.
  const models = await (await request.get(`${API}/api/v1/models`, { params: { provider_id: providerId } })).json();
  const created = models.find((m: { model_id: string }) => m.model_id === "gpt-4o");
  expect(created).toBeDefined();
  expect(created.repository_model_key).toBe("openai/gpt-4o");
  expect(created.metadata.repository_snapshot).toBeDefined();
});

test("chat shows per-message usage/cost and conversation analytics", async ({ page }) => {
  const stamp = Date.now();
  const { id: providerId } = await apiCreateProvider(`pw-chat-prov-${stamp}`);
  const { id: modelId } = await apiCreateModel(providerId, `pw-chat-model-${stamp}`, "2", "8");

  await page.goto("/");
  await selectProviderModel(page, providerId, modelId);
  await sendMessage(page, `intelligence check ${stamp}`);
  const assistant = page.getByTestId("message-assistant").last();
  await expect(assistant.getByTestId("message-usage")).toContainText("tok", { timeout: 30000 });
  // Mock usage: 8 prompt + 6 completion at $2/$8 per 1M.
  await expect(assistant.getByTestId("message-cost")).toBeVisible();
  await expect(assistant.getByTestId("message-model")).toContainText(`pw-chat-model-${stamp}`);

  // Conversation analytics: totals + provider/model breakdowns.
  await expect(page.getByTestId("usage-summary")).toBeVisible();
  await expect(page.getByTestId("usage-cost")).not.toHaveText("$0");
  await expect(page.getByTestId("usage-by-provider")).toContainText(`pw-chat-prov-${stamp}`);
  await expect(page.getByTestId("usage-by-model")).toContainText(`pw-chat-model-${stamp}`);
});

test("repository search, filters, and manual sync", async ({ request }) => {
  const search = await (await request.get(`${API}/api/v1/model-repository/models`, { params: { search: "gpt-4o", page_size: 3 } })).json();
  expect(search.total).toBeGreaterThan(0);

  const before = await (await request.get(`${API}/api/v1/model-repository/sync-history`, { params: { limit: 1 } })).json();
  const sync = await (await request.post(`${API}/api/v1/model-repository/sync`, { timeout: 180000 })).json();
  expect(sync.status).toBe("done");
  expect(sync.errors_count).toBe(0);
  const after = await (await request.get(`${API}/api/v1/model-repository/sync-history`, { params: { limit: 1 } })).json();
  expect(after[0].id).toBe(sync.id);
  expect(after.length).toBeGreaterThanOrEqual(before.length);
});
