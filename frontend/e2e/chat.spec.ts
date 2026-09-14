// Scenario 5: streamed chat flow + usage/cost display + persistence.
import { expect, test } from "@playwright/test";
import { startMockLLM } from "./mock-server";
import { API, apiCreateModel, apiCreateProvider, selectProviderModel, sendMessage, apiLoginAs } from "./helpers";

test.beforeAll(async () => {
  await startMockLLM();
});

test("chat flow streams, tracks usage, survives reload", async ({ page, request }) => {
  await apiLoginAs(page, "chat");
  const stamp = Date.now();
  const { id: providerId } = await apiCreateProvider(page.request, `pw-cprov-${stamp}`);
  const { id: modelId } = await apiCreateModel(page.request, providerId, `pw-cmodel-${stamp}`, "2", "8");
  const text = `hello chat ${stamp}`;

  await page.goto("/");
  await selectProviderModel(page, providerId, modelId);
  await sendMessage(page, text);

  const assistant = page.getByTestId("message-assistant").last();
  await expect(assistant).toContainText("Hello from mock", { timeout: 20000 });

  // Intelligence panel shows live conversation usage (mock reports 8 in / 6 out).
  const panel = page.getByTestId("right-sidebar");
  await expect(panel.getByTestId("usage-total")).toContainText("14 tok", { timeout: 10000 });
  await expect(panel.getByTestId("usage-prompt")).toContainText("8");
  await expect(panel.getByTestId("usage-completion")).toContainText("6");

  // Sidebar picked up the new conversation.
  const sidebar = page.getByTestId("left-sidebar");
  await expect(sidebar.getByText(text.slice(0, 20)).first()).toBeVisible();


  // Reload -> conversation + both messages persist.
  await page.reload();
  await selectProviderModel(page, providerId, modelId);
  await expect(page.getByTestId("message-user").last()).toContainText(text);
  await expect(page.getByTestId("message-assistant").last()).toContainText("Hello from mock", { timeout: 20000 });

  // API totals match: cost = 8*2/1e6 + 6*8/1e6 = 0.000064.
  const list = await (await page.request.get(`${API}/api/v1/conversations?search=${encodeURIComponent(text)}`)).json();
  const usage = await (await page.request.get(`${API}/api/v1/conversations/${list[0].id}/usage`)).json();
  expect(usage.total_tokens).toBe(14);
  expect(Math.abs(parseFloat(usage.total_cost) - 0.000064)).toBeLessThan(1e-9);
});
