// Model Intelligence end-to-end: register-drawer repository assist, chat usage/cost, analytics, sync.
import { expect, test } from "@playwright/test";
import { API, apiCreateModel, apiCreateProvider, selectProviderModel, sendMessage, apiLoginAs, apiSignupRequest } from "./helpers";
import { startMockLLM } from "./mock-server";

test.beforeAll(async () => {
  await startMockLLM();
});

test("register drawer auto-populates from the repository", async ({ page, request }) => {
  await apiLoginAs(page, "intel");
  const stamp = Date.now();
  const { id: providerId } = await apiCreateProvider(page.request, `pw-intel-prov-${stamp}`);

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
  // Drawer closes only after the POST resolves: persistence is guaranteed past this line.
  await expect(page.getByTestId("register-drawer")).not.toBeVisible({ timeout: 15000 });

  // Data persistence: stored with repository link + snapshot of original values.
  const models = await (await page.request.get(`${API}/api/v1/models`, { params: { provider_id: providerId } })).json();
  const created = models.find((m: { model_id: string }) => m.model_id === "gpt-4o");
  expect(created).toBeDefined();
  expect(created.repository_model_key).toBe("openai/gpt-4o");
  expect(created.metadata.repository_snapshot).toBeDefined();
});

test("chat shows per-message usage/cost and conversation analytics", async ({ page }) => {
  await apiLoginAs(page, "intelchat");
  const stamp = Date.now();
  const { id: providerId } = await apiCreateProvider(page.request, `pw-chat-prov-${stamp}`);
  const { id: modelId } = await apiCreateModel(page.request, providerId, `pw-chat-model-${stamp}`, "2", "8");

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
  test.setTimeout(240_000); // live source fetch + 4k-row merge takes minutes
  await apiSignupRequest(request, "intelrepo");
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

test("model hero card shows name, endpoint badge, caps, and context usage", async ({ page }) => {
  await apiLoginAs(page, "intelhero");
  const stamp = Date.now();
  const { id: providerId } = await apiCreateProvider(page.request, `pw-hero-prov-${stamp}`);
  const { id: modelId } = await apiCreateModel(page.request, providerId, `pw-hero-model-${stamp}`, "2", "8", {
    context_window: 128000,
    supports_reasoning: true,
    supports_streaming: true,
    supports_tool_calling: true,
    supports_vision: true,
  });

  await page.goto("/");
  await selectProviderModel(page, providerId, modelId);

  // Hero card: model name + provider, endpoint badge moved here from the header.
  const hero = page.getByTestId("intelligence-model");
  await expect(hero).toBeVisible();
  await expect(hero).toContainText(`pw-hero-model-${stamp}`);
  await expect(hero).toContainText(`pw-hero-prov-${stamp}`);
  await expect(hero).toContainText("Chat Completions");
  // Capability chips for the flags set at creation, plus the thinking-levels line.
  const caps = page.getByTestId("intelligence-caps");
  await expect(caps).toBeVisible();
  await expect(caps).toContainText("Reasoning");
  await expect(caps).toContainText("Tools");
  await expect(caps).toContainText("Streaming");
  await expect(caps).toContainText("Vision");
  await expect(hero).toContainText("Thinking:");

  // Context-usage progress bar inside the conversation section (model has a window).
  const panel = page.getByTestId("right-sidebar");
  const usage = panel.getByTestId("intelligence-context-usage");
  await expect(usage).toBeVisible();
  await expect(usage.getByRole("progressbar")).toBeVisible();
  await expect(usage).toContainText("context used");
});
