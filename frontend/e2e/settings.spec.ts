// Scenario 7: conversation settings — switch provider/model, verify routing + details.
import { expect, test } from "@playwright/test";
import { startMockLLM } from "./mock-server";
import { API, apiCreateModel, apiCreateProvider, selectProviderModel, sendMessage, apiLoginAs } from "./helpers";

test.beforeAll(async () => {
  await startMockLLM();
});

test("change provider and model in chat settings", async ({ page, request }) => {
  await apiLoginAs(page, "settings");
  const stamp = Date.now();
  const a = await apiCreateProvider(page.request, `pw-sprov-a-${stamp}`);
  const ma = await apiCreateModel(page.request, a.id, `pw-smodel-a-${stamp}`);
  const b = await apiCreateProvider(page.request, `pw-sprov-b-${stamp}`);
  const mb = await apiCreateModel(page.request, b.id, `pw-smodel-b-${stamp}`);

  await page.goto("/");
  await selectProviderModel(page, a.id, ma.id);

  // Composer selector shows the selected model (panel Model card was removed).
  await expect(page.getByTestId("model-selector")).toContainText(`pw-smodel-a-${stamp}`, { timeout: 10000 });
  await sendMessage(page, `route alpha ${stamp}`);
  await expect(page.getByTestId("message-assistant").last()).toContainText("Hello from mock", { timeout: 20000 });

  // Switch pair mid-session: new chat routes to B.
  const beforeNewChat = page.url();
  await page.getByTestId("new-chat").click();
  await expect(page).not.toHaveURL(beforeNewChat);
  await selectProviderModel(page, b.id, mb.id);
  await expect(page.getByTestId("model-selector")).toContainText(`pw-smodel-b-${stamp}`, { timeout: 10000 });
  await sendMessage(page, `route bravo ${stamp}`);
  await expect(page.getByTestId("message-assistant").last()).toContainText("Hello from mock", { timeout: 20000 });

  // Identify conversations by their exact user prompt (search ranks loosely).
  const conversationFor = async (text: string) => {
    const list = await (await page.request.get(`${API}/api/v1/conversations`)).json();
    for (const conv of list) {
      const detail = await (await page.request.get(`${API}/api/v1/conversations/${conv.id}`)).json();
      if ((detail.messages ?? []).some((m: { role: string; content: string }) => m.role === "user" && m.content === text)) {
        return detail;
      }
    }
    return null;
  };
  const convA = await conversationFor(`route alpha ${stamp}`);
  const convB = await conversationFor(`route bravo ${stamp}`);
  expect(convA?.model_id).toBe(ma.id);
  expect(convB?.model_id).toBe(mb.id);
});
