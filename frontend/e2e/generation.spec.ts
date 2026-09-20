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

test("refresh never duplicates content: exactly one assistant row, exact text", async ({ page }) => {
  await setupSlowChat(page, "gendup");
  await sendMessage(page, "exact content probe");
  await expect(page.getByTestId("message-assistant").last()).toContainText("slow-word-5", {
    timeout: 15000,
  });
  await page.reload();
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("message-assistant").last()).toContainText("slow-word-20", {
    timeout: 25000,
  });
  await page.waitForTimeout(1000);
  // Exactly one assistant bubble in the UI...
  await expect(page.getByTestId("message-assistant")).toHaveCount(1);
  await expect(page.getByTestId("message-user")).toHaveCount(1);
  // ...and exactly one assistant row with byte-exact content in the DB.
  const convId = await activeConversationId(page);
  const conv = await (await page.request.get(`${API}/api/v1/conversations/${convId}`)).json();
  const assistants = conv.messages.filter((m: { role: string }) => m.role === "assistant");
  expect(assistants).toHaveLength(1);
  const expected = Array.from({ length: 20 }, (_, i) => `slow-word-${i + 1}`).join(" ") + " ";
  expect(assistants[0].content).toBe(expected);
  expect(assistants[0].status).toBe("completed");
});

test("double-clicked regenerate adopts instead of duplicating", async ({ page }) => {
  await setupSlowChat(page, "genregen");
  await sendMessage(page, "regen race probe");
  await expect(page.getByTestId("message-assistant").last()).toContainText("slow-word-20", {
    timeout: 25000,
  });
  // Two rapid regenerates: the second 409-adopts the first, no wedge, no dup.
  const regen = page.locator("[data-testid^='regenerate-button-']").last();
  await regen.click({ timeout: 10000 });
  await regen.click({ timeout: 10000 }).catch(() => {});
  await expect(page.getByTestId("message-assistant").last()).toContainText("slow-word-20", {
    timeout: 30000,
  });
  await page.waitForTimeout(1000);
  await expect(page.getByTestId("message-user")).toHaveCount(2);
  await expect(page.getByTestId("message-assistant")).toHaveCount(2);
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Chat failed" })).toHaveCount(0);
  const convId = await activeConversationId(page);
  const conv = await (await page.request.get(`${API}/api/v1/conversations/${convId}`)).json();
  expect(conv.messages.filter((m: { role: string }) => m.role === "assistant")).toHaveLength(2);
  expect(conv.messages.filter((m: { role: string }) => m.role === "user")).toHaveLength(2);
});

test("first-token timing with instant provider", async ({ page }) => {
  await apiLoginAs(page, "gentiming");
  const stamp = Date.now();
  const p = await apiCreateProvider(page.request, `pw-gentime-${stamp}`);
  const m = await apiCreateModel(page.request, p.id, `instant-${stamp}`);
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await selectProviderModel(page, p.id, m.id);
  const t0 = Date.now();
  await sendMessage(page, "timing probe");
  await expect(page.getByTestId("message-assistant").last()).toContainText("Hello from mock", {
    timeout: 20000,
  });
  const firstTokenMs = Date.now() - t0;
  console.log(`[TIMING] send-click to first rendered token: ${firstTokenMs}ms`);
  expect(firstTokenMs).toBeLessThan(15000);
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

test("reasoning model shows collapsible Thinking pill, preserved on refresh", async ({ page }) => {
  await apiLoginAs(page, "genthink");
  const stamp = Date.now();
  const p = await apiCreateProvider(page.request, `pw-genthink-${stamp}`);
  const m = await apiCreateModel(page.request, p.id, `thinker-${stamp}`);
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await selectProviderModel(page, p.id, m.id);
  await sendMessage(page, "think step by step");
  const assistant = page.getByTestId("message-assistant").last();
  // Live streaming: the pill appears with the first reasoning delta and the
  // answer has not arrived yet (mock paces the answer ~900ms behind).
  const pill = assistant.getByTestId("thinking-block");
  await expect(pill.getByRole("button", { name: /Thinking/ })).toBeVisible({ timeout: 5000 });
  await expect(assistant).not.toContainText("Thoughtful answer.");
  // Completion: same pill persists, same Thinking UI DeepSeek uses.
  await expect(assistant).toContainText("Thoughtful answer.", { timeout: 20000 });
  await expect(pill).toContainText("4 words");
  await pill.getByRole("button", { name: /Thinking/ }).click();
  await expect(pill).toContainText("Considering the options carefully.");
  // Refresh: persisted <think> span restores the pill.
  await page.reload();
  await page.waitForLoadState("networkidle");
  const restored = page.getByTestId("message-assistant").last().getByTestId("thinking-block");
  await expect(restored.getByRole("button", { name: /Thinking/ })).toBeVisible({ timeout: 10000 });
});
