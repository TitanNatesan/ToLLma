// Scenario 8: full stack restart preserves providers, models, conversations.
import { execSync } from "node:child_process";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { startMockLLM } from "./mock-server";
import { API, apiCreateModel, apiCreateProvider } from "./helpers";

test.setTimeout(240000);

test.beforeAll(async () => {
  await startMockLLM();
});

async function waitFor(url: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  for (;;) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* retry */
    }
    if (Date.now() - start > timeoutMs) throw new Error(`timeout waiting for ${url}`);
    await new Promise((r) => setTimeout(r, 2000));
  }
}

test("restart docker stack, providers + models + conversations persist", async ({ page, request }) => {
  const stamp = Date.now();
  const { id: providerId } = await apiCreateProvider(`pw-xprov-${stamp}`);
  const { id: modelId } = await apiCreateModel(providerId, `pw-xmodel-${stamp}`);
  const chat = await (
    await request.post(`${API}/api/v1/gateway/chat`, {
      data: { provider_id: providerId, model_id: modelId, message: `survive restart ${stamp}` },
    })
  ).json();
  expect(chat.content).toContain("Hello");

  execSync("docker compose restart", {
    cwd: path.resolve(__dirname, "../.."),
    timeout: 180000,
  });
  await waitFor("http://localhost:8000/health", 120000);
  await waitFor("http://localhost:3000/", 120000);

  // Conversation UI + API show the pre-restart data.
  await page.goto("/");
  await expect(page.getByRole("complementary").getByRole("button", { name: `survive restart ${stamp}` })).toBeVisible({ timeout: 60000 });
  const conv = await (await request.get(`${API}/api/v1/conversations/${chat.conversation_id}`)).json();
  expect(conv.messages).toHaveLength(2);

  // Provider + model persist with validation status intact.
  await page.goto("/providers");
  await page.locator("section[aria-label='Provider list']").getByText(`pw-xprov-${stamp}`).click();
  await expect(page.locator("section[aria-label='Provider details']").getByText(`pw-xmodel-${stamp}`).first()).toBeVisible({ timeout: 30000 });
  const providers = await (await request.get(`${API}/api/v1/providers`)).json();
  expect(providers.some((p: { id: string }) => p.id === providerId)).toBe(true);
});
