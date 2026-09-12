// Scenario 9: provider/model switching routes to the selected pair.
import { expect, test } from "@playwright/test";
import { startMockLLM } from "./mock-server";
import { API, apiCreateModel, apiCreateProvider, selectProviderModel, sendMessage } from "./helpers";

test.beforeAll(async () => {
  await startMockLLM();
});

test("switch provider and model, both routes answer", async ({ page, request }) => {
  const stamp = Date.now();
  const a = await apiCreateProvider(`pw-sprov-a-${stamp}`);
  const ma = await apiCreateModel(a.id, `pw-smodel-a-${stamp}`);
  const b = await apiCreateProvider(`pw-sprov-b-${stamp}`);
  const mb = await apiCreateModel(b.id, `pw-smodel-b-${stamp}`);

  await page.goto("/");
  await selectProviderModel(page, a.id, ma.id);
  await sendMessage(page, `route a ${stamp}`);
  await expect(page.getByTestId("message-assistant").last()).toContainText("Hello from mock", { timeout: 20000 });

  await page.getByTestId("new-chat").click();
  await selectProviderModel(page, b.id, mb.id);
  await sendMessage(page, `route b ${stamp}`);
  await expect(page.getByTestId("message-assistant").last()).toContainText("Hello from mock", { timeout: 20000 });

  // Each conversation is bound to the provider/model active when it was created.
  const convA = await (await request.get(`${API}/api/v1/conversations?search=${encodeURIComponent(`route a ${stamp}`)}`)).json();
  const convB = await (await request.get(`${API}/api/v1/conversations?search=${encodeURIComponent(`route b ${stamp}`)}`)).json();
  expect(convA[0].model_id).toBe(ma.id);
  expect(convB[0].model_id).toBe(mb.id);
});
