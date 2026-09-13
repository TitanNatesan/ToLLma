// Scenario 7: conversation settings — switch provider/model, verify routing + details.
import { expect, test } from "@playwright/test";
import { startMockLLM } from "./mock-server";
import { API, apiCreateModel, apiCreateProvider, selectProviderModel, sendMessage } from "./helpers";

test.beforeAll(async () => {
  await startMockLLM();
});

test("change provider and model in chat settings", async ({ page, request }) => {
  const stamp = Date.now();
  const a = await apiCreateProvider(`pw-sprov-a-${stamp}`);
  const ma = await apiCreateModel(a.id, `pw-smodel-a-${stamp}`);
  const b = await apiCreateProvider(`pw-sprov-b-${stamp}`);
  const mb = await apiCreateModel(b.id, `pw-smodel-b-${stamp}`);

  await page.goto("/");
  // The intelligence panel is now the right sidebar (data-testid="right-sidebar")
  const panel = page.getByTestId("right-sidebar");
  await selectProviderModel(page, a.id, ma.id);

  // Intelligence panel shows the selected model's details (model name visible).
  await expect(panel.getByTestId("model-details-name")).toContainText(`pw-smodel-a-${stamp}`, { timeout: 10000 });
  await sendMessage(page, `route a ${stamp}`);
  await expect(page.getByTestId("message-assistant").last()).toContainText("Hello from mock", { timeout: 20000 });

  // Switch pair mid-session: new chat routes to B.
  await page.getByTestId("new-chat").click();
  await selectProviderModel(page, b.id, mb.id);
  await expect(panel.getByTestId("model-details-name")).toContainText(`pw-smodel-b-${stamp}`, { timeout: 10000 });
  await sendMessage(page, `route b ${stamp}`);
  await expect(page.getByTestId("message-assistant").last()).toContainText("Hello from mock", { timeout: 20000 });

  const convA = await (await request.get(`${API}/api/v1/conversations?search=${encodeURIComponent(`route a ${stamp}`)}`)).json();
  const convB = await (await request.get(`${API}/api/v1/conversations?search=${encodeURIComponent(`route b ${stamp}`)}`)).json();
  expect(convA[0].model_id).toBe(ma.id);
  expect(convB[0].model_id).toBe(mb.id);
});
