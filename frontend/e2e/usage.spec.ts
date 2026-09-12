// Scenario 8: token usage + cost calculation after a streamed chat.
import { expect, test } from "@playwright/test";
import { startMockLLM } from "./mock-server";
import { API, apiCreateModel, apiCreateProvider, selectProviderModel, sendMessage } from "./helpers";

test.beforeAll(async () => {
  await startMockLLM();
});

test("usage and cost tracked per conversation", async ({ page, request }) => {
  const stamp = Date.now();
  const { id: providerId } = await apiCreateProvider(`pw-uprov-${stamp}`);
  // input $2/1M, output $8/1M; mock reports 8 prompt / 6 completion tokens.
  const { id: modelId } = await apiCreateModel(providerId, `pw-umodel-${stamp}`, "2", "8");
  const text = `usage check ${stamp}`;

  await page.goto("/");
  await selectProviderModel(page, providerId, modelId);
  await sendMessage(page, text);
  await expect(page.getByTestId("message-assistant").last()).toContainText("Hello from mock", { timeout: 20000 });

  // UI shows the running totals.
  await expect(page.getByTestId("usage-summary")).toContainText("14 tok", { timeout: 10000 });

  // API totals match the mock's reported usage; cost = 8*2/1e6 + 6*8/1e6 = 0.000064.
  const list = await (await request.get(`${API}/api/v1/conversations?search=${encodeURIComponent(text)}`)).json();
  expect(list).toHaveLength(1);
  const usage = await (await request.get(`${API}/api/v1/conversations/${list[0].id}/usage`)).json();
  expect(usage.prompt_tokens).toBe(8);
  expect(usage.completion_tokens).toBe(6);
  expect(usage.total_tokens).toBe(14);
  expect(Math.abs(parseFloat(usage.total_cost) - 0.000064)).toBeLessThan(1e-9);
});
