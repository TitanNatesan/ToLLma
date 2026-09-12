// Scenarios 3 + 4: conversation creation, sidebar update, streamed chat, persistence.
import { expect, test } from "@playwright/test";
import { startMockLLM } from "./mock-server";
import { apiCreateModel, apiCreateProvider, selectProviderModel, sendMessage } from "./helpers";

test.beforeAll(async () => {
  await startMockLLM();
});

test("chat flow streams, persists, survives reload", async ({ page }) => {
  const stamp = Date.now();
  const { id: providerId } = await apiCreateProvider(`pw-cprov-${stamp}`);
  const { id: modelId } = await apiCreateModel(providerId, `pw-cmodel-${stamp}`);
  const text = `hello chat ${stamp}`;

  await page.goto("/");
  await selectProviderModel(page, providerId, modelId);
  await sendMessage(page, text);

  // Streamed assistant response renders (markdown from mock).
  const assistant = page.getByTestId("message-assistant").last();
  await expect(assistant).toContainText("Hello from mock", { timeout: 20000 });

  // Sidebar picked up the new conversation.
  const sidebar = page.getByRole("complementary");
  await expect(sidebar.getByText(text.slice(0, 20)).first()).toBeVisible();

  // Reload -> conversation + both messages persist.
  await page.reload();
  await selectProviderModel(page, providerId, modelId);
  await expect(page.getByTestId("message-user").last()).toContainText(text);
  await expect(page.getByTestId("message-assistant").last()).toContainText("Hello from mock", { timeout: 20000 });
});
