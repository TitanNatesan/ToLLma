// Generation lifecycle: cancel persistence, refresh recovery, avatar removal.
import { expect, test, type Page } from "@playwright/test";
import { startMockLLM } from "./mock-server";
import { API, apiCreateModel, apiCreateProvider, apiLoginAs, selectProviderModel, sendMessage } from "./helpers";

test.beforeAll(async () => {
  await startMockLLM();
});

async function setupSlowChat(page: Page, tag: string) {
  await apiLoginAs(page, tag);
  const stamp = Date.now();
  // NOTE: page.request (the page user's cookies), not the bare request fixture.
  const p = await apiCreateProvider(page.request, `pw-genprov-${stamp}`);
  // model_id becomes mock-<name>: contains "slow" so the mock paces chunks.
  const m = await apiCreateModel(page.request, p.id, `slowpoke-${stamp}`);
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await selectProviderModel(page, p.id, m.id);
  return { stamp };
}

async function activeConversationId(page: Page): Promise<string> {
  const convs = await page.request.get(`${API}/api/v1/conversations`);
  const list = await convs.json();
  return list[0].id as string;
}

test("stop midway persists partial answer as cancelled", async ({ page }) => {
  await setupSlowChat(page, "genstop");
  await sendMessage(page, "tell me a long story");
  const assistant = page.getByTestId("message-assistant").last();
  await expect(assistant).toContainText("slow-word-2", { timeout: 15000 });

  await expect(page.getByTestId("stop-button")).toContainText("Stop Generating");
  await page.getByTestId("stop-button").click();
  // Backend cancels, persists partial, UI settles on the Stopped state.
  await expect(page.locator("[data-testid^='stopped-']").first()).toBeVisible({ timeout: 20000 });

  const convId = await activeConversationId(page);
  const conv = await (await page.request.get(`${API}/api/v1/conversations/${convId}`)).json();
  const lastAssistant = [...conv.messages].reverse().find((m) => m.role === "assistant");
  expect(lastAssistant.status).toBe("cancelled");
  expect(lastAssistant.content).toContain("slow-word-2");
  expect(lastAssistant.content).not.toContain("slow-word-20");

  // Reload: partial answer survives with its Stopped badge.
  await page.reload();
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("message-assistant").last()).toContainText("slow-word-2");
  await expect(page.locator("[data-testid^='stopped-']").first()).toBeVisible({ timeout: 10000 });
});

test("refresh mid-generation reattaches and completes", async ({ page }) => {
  await setupSlowChat(page, "genreattach");
  await sendMessage(page, "count slowly for me");
  await expect(page.getByTestId("message-assistant").last()).toContainText("slow-word-2", {
    timeout: 15000,
  });

  // Refresh while the backend is still generating: stream must resume.
  await page.reload();
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("message-assistant").last()).toContainText("slow-word-20", {
    timeout: 25000,
  });

  const convId = await activeConversationId(page);
  const conv = await (await page.request.get(`${API}/api/v1/conversations/${convId}`)).json();
  const lastAssistant = [...conv.messages].reverse().find((m) => m.role === "assistant");
  expect(lastAssistant.status).toBe("completed");
  expect(lastAssistant.content).toContain("slow-word-20");
});

test("navigate away and back restores conversation", async ({ page }) => {
  await setupSlowChat(page, "gennav");
  await sendMessage(page, "say something slow");
  await expect(page.getByTestId("message-assistant").last()).toContainText("slow-word-20", {
    timeout: 25000,
  });
  await page.goto("/providers");
  await expect(page).toHaveURL(/\/providers/);
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("message-assistant").last()).toContainText("slow-word-20");
});

test("user messages have no avatar, assistant keeps its icon", async ({ page }) => {
  await setupSlowChat(page, "genavatar");
  await sendMessage(page, "avatar check");
  const user = page.getByTestId("message-user").last();
  await expect(user).toContainText("avatar check");
  await expect(user.locator(".rounded-full")).toHaveCount(0);
  await expect(page.getByTestId("message-assistant").last()).toContainText("slow-word-20", {
    timeout: 25000,
  });
  await expect(page.getByTestId("message-assistant").last().locator(".rounded-full").first()).toBeVisible();
});
