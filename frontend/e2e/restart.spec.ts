// Scenario 10: full stack restart preserves all data.
import { execSync } from "node:child_process";
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

test("restart docker stack, data persists", async ({ page, request }) => {
  const stamp = Date.now();
  const { id: providerId } = await apiCreateProvider(`pw-xprov-${stamp}`);
  await apiCreateModel(providerId, `pw-xmodel-${stamp}`);
  const chat = await (
    await request.post(`${API}/api/v1/gateway/chat`, {
      data: { provider_id: providerId, model_id: (await apiCreateModel(providerId, `pw-xmodel2-${stamp}`)).id, message: `survive restart ${stamp}` },
    })
  ).json();
  expect(chat.content).toContain("Hello");

  execSync("docker compose restart", {
    cwd: "/home/ond/Projects/ToLLms",
    timeout: 180000,
  });
  await waitFor("http://localhost:8000/health", 120000);
  await waitFor("http://localhost:3000/", 120000);

  // UI + API show the pre-restart data.
  await page.goto("/");
  await expect(page.getByRole("complementary").getByRole("button", { name: `survive restart ${stamp}` })).toBeVisible({ timeout: 60000 });
  const conv = await (await request.get(`${API}/api/v1/conversations/${chat.conversation_id}`)).json();
  expect(conv.messages).toHaveLength(2);
});
